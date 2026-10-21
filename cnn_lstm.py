"""
CNN-LSTM Deepfake Detection Model
Architecture: EfficientNet-B0 (CNN) + Bidirectional LSTM
"""

import torch
import torch.nn as nn
import torchvision.models as models


class CNNFeatureExtractor(nn.Module):
    """
    EfficientNet-B0 backbone for spatial feature extraction.
    Extracts a 1280-dimensional feature vector per frame.
    """

    def __init__(self, pretrained: bool = True, freeze_backbone: bool = True):
        super().__init__()
        # Load EfficientNet-B0
        efficientnet = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        )
        # Remove final classifier head — keep feature layers
        self.backbone = nn.Sequential(*list(efficientnet.children())[:-1])
        self.feature_dim = 1280  # EfficientNet-B0 output channels

        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [B, C, H, W] — batch of face images
        Returns:
            features: [B, 1280] — spatial feature vectors
        """
        features = self.backbone(x)           # [B, 1280, 1, 1]
        return features.view(features.size(0), -1)  # [B, 1280]


class DeepfakeCNNLSTM(nn.Module):
    """
    Full CNN-LSTM deepfake detection model.

    Pipeline:
        Input frames [B, T, C, H, W]
          → CNN per frame → [B, T, 1280]
          → Bi-LSTM       → [B, hidden*2]
          → Dropout + FC  → [B, 2]
          → Softmax       → (p_real, p_fake)
    """

    def __init__(
        self,
        num_frames    : int  = 20,
        cnn_feature_dim: int = 1280,
        lstm_hidden   : int  = 256,
        lstm_layers   : int  = 2,
        dropout       : float = 0.5,
        num_classes   : int  = 2,
        pretrained    : bool  = True,
        freeze_cnn    : bool  = True,
    ):
        super().__init__()
        self.num_frames     = num_frames
        self.cnn_feature_dim = cnn_feature_dim
        self.lstm_hidden    = lstm_hidden

        # CNN backbone
        self.cnn = CNNFeatureExtractor(pretrained=pretrained, freeze_backbone=freeze_cnn)

        # Optional projection to reduce LSTM input size
        self.projection = nn.Sequential(
            nn.Linear(cnn_feature_dim, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
        )

        # Bidirectional LSTM
        self.lstm = nn.LSTM(
            input_size   = 512,
            hidden_size  = lstm_hidden,
            num_layers   = lstm_layers,
            batch_first  = True,
            bidirectional= True,
            dropout      = dropout if lstm_layers > 1 else 0.0,
        )

        # Classification head
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(lstm_hidden * 2, 128),  # ×2 for bidirectional
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

        self.softmax = nn.Softmax(dim=1)

    def forward(self, x: torch.Tensor) -> dict:
        """
        Args:
            x: [B, T, C, H, W]  — B=batch, T=frames, C=3, H=W=224
        Returns:
            dict with:
                'logits'     : [B, 2]
                'probs'      : [B, 2]   — (p_real, p_fake)
                'frame_feats': [B, T, 512]
        """
        B, T, C, H, W = x.shape

        # Reshape to process all frames at once through CNN
        x_flat = x.view(B * T, C, H, W)         # [B*T, C, H, W]
        cnn_out = self.cnn(x_flat)               # [B*T, 1280]
        cnn_out = self.projection(cnn_out)       # [B*T, 512]

        # Reshape back to sequence
        frame_feats = cnn_out.view(B, T, 512)   # [B, T, 512]

        # LSTM over frame sequence
        lstm_out, (h_n, _) = self.lstm(frame_feats)  # lstm_out: [B, T, H*2]

        # Use last hidden state from both directions
        # h_n: [num_layers*2, B, H]  — take top layer
        h_fwd = h_n[-2]   # [B, H]  — last forward  hidden
        h_bwd = h_n[-1]   # [B, H]  — last backward hidden
        h_cat = torch.cat([h_fwd, h_bwd], dim=1)  # [B, H*2]

        logits = self.classifier(h_cat)          # [B, 2]
        probs  = self.softmax(logits)            # [B, 2]

        return {
            'logits'     : logits,
            'probs'      : probs,
            'frame_feats': frame_feats,
        }

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        """Convenience: returns fake probability [B,] in [0,1]."""
        with torch.no_grad():
            out = self.forward(x)
        return out['probs'][:, 1]  # p_fake


def build_model(pretrained=True, freeze_cnn=True) -> DeepfakeCNNLSTM:
    """Factory function to build the model with default hyperparameters."""
    return DeepfakeCNNLSTM(
        num_frames     = 20,
        cnn_feature_dim= 1280,
        lstm_hidden    = 256,
        lstm_layers    = 2,
        dropout        = 0.5,
        num_classes    = 2,
        pretrained     = pretrained,
        freeze_cnn     = freeze_cnn,
    )


def model_summary(model: DeepfakeCNNLSTM) -> dict:
    """Returns a dict summary of model parameter counts."""
    total  = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return {
        'total_params'    : total,
        'trainable_params': trainable,
        'frozen_params'   : total - trainable,
    }


if __name__ == '__main__':
    # Quick sanity check
    model = build_model(pretrained=False)
    dummy = torch.randn(2, 20, 3, 224, 224)  # 2 videos, 20 frames each
    out   = model(dummy)
    print('Logits shape :', out['logits'].shape)     # [2, 2]
    print('Probs  shape :', out['probs'].shape)      # [2, 2]
    print('Frame feats  :', out['frame_feats'].shape) # [2, 20, 512]
    summary = model_summary(model)
    print(f"Total params : {summary['total_params']:,}")
    print(f"Trainable    : {summary['trainable_params']:,}")
