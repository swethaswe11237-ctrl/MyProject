# Model Weights Directory

Place your trained CNN-LSTM weights here as:

    deepfake_cnnlstm.pth

The predictor will automatically detect this file and switch
from demo mode → real inference mode.

## Training Resources

- FaceForensics++: https://github.com/ondyari/FaceForensics
- DFDC Dataset   : https://dfdc.ai/

## Expected State Dict Keys

The weights must match the `DeepfakeCNNLSTM` architecture defined in
`../cnn_lstm.py`. All layer names should match exactly.
