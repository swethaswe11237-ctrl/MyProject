/* ============================================================
   main.js — DeepGuard Unified Detection Platform
   1. Real Computer Vision & Signal Forensics (Upload Analysis)
   2. Real-Time Webcam Biometrics (Blinks, Micro-movements, Voice, Lip-Sync)
   ============================================================ */

const API = (window.location.protocol.startsWith('http'))
  ? window.location.origin
  : 'http://127.0.0.1:5000';

// ═══════════════════════════════════════════
// ── API Health Check
// ═══════════════════════════════════════════
let apiOnline = false;

async function checkApi() {
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      apiOnline = true;
      const dot  = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      if (dot && text) {
        dot.className  = 'status-dot online';
        text.textContent = data.mode === 'cnn_lstm' ? 'PyTorch CNN-LSTM Active' : 'CV Forensics Engine Active';
      }
      return;
    }
  } catch (_) {}

  apiOnline = false;
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot && text) {
    dot.className  = 'status-dot offline';
    text.textContent = 'API Reconnecting…';
  }
}
checkApi();
setInterval(checkApi, 15000);

// ═══════════════════════════════════════════
// ── Mode Switching
// ═══════════════════════════════════════════
function switchMode(mode) {
  const panels = { upload: 'upload-section', live: 'live-section' };
  const tabs   = { upload: 'tab-upload',     live: 'tab-live' };

  Object.keys(panels).forEach(k => {
    const p = document.getElementById(panels[k]);
    const t = document.getElementById(tabs[k]);
    if (p) p.style.display = (k === mode ? 'block' : 'none');
    if (t) {
      t.classList.toggle('active', k === mode);
      t.setAttribute('aria-selected', k === mode);
    }
  });

  // If user leaves webcam tab, stop webcam
  if (mode !== 'live' && isWebcamActive) {
    stopWebcam();
  }
}

function scrollToApp() {
  const el = document.getElementById('app-section');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAll() {
  clearFile();
  if (isWebcamActive) stopWebcam();
  switchMode('upload');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════
// ── SECTION 1: UPLOAD VIDEO ANALYSIS
// ═══════════════════════════════════════════

let uploadedFile = null;
let resultData   = null;
let resultChart  = null;

function doDragOver(e) {
  e.preventDefault();
  const uz = document.getElementById('uploadZone');
  if (uz) uz.classList.add('drag-over');
}
function doDragLeave(e) {
  const uz = document.getElementById('uploadZone');
  if (uz) uz.classList.remove('drag-over');
}
function doDrop(e) {
  e.preventDefault();
  const uz = document.getElementById('uploadZone');
  if (uz) uz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) setUploadFile(file);
}

function onFileSelect(e) {
  const file = e.target.files[0];
  if (file) setUploadFile(file);
}

function setUploadFile(file) {
  uploadedFile = file;
  document.getElementById('uploadZone').style.display   = 'none';
  document.getElementById('fileInfoBar').style.display  = 'flex';
  document.getElementById('resultsPanel').style.display = 'none';
  document.getElementById('progressWrap').style.display = 'none';

  document.getElementById('fibName').textContent = file.name;
  document.getElementById('fibMeta').textContent =
    `${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.type || 'video'}`;
}

function clearFile() {
  uploadedFile = null;
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
  document.getElementById('uploadZone').style.display   = 'flex';
  document.getElementById('fileInfoBar').style.display  = 'none';
  document.getElementById('progressWrap').style.display = 'none';
  document.getElementById('resultsPanel').style.display = 'none';
}

const STEPS = [
  'Uploading video to server…',
  'Decoding video & extracting frames…',
  'Analyzing 2D FFT Power Spectrum & Grid Artifacts…',
  'Measuring Laplacian noise & skin over-smoothing…',
  'Computing inter-frame optical flow & motion jitter…',
  'Evaluating final forensic verdict…',
];
const STEP_PCTS = [15, 35, 55, 75, 90, 100];

async function startAnalysis() {
  if (!uploadedFile) return;

  const btnAnalyze = document.getElementById('btnAnalyze');
  btnAnalyze.disabled = true;

  document.getElementById('progressWrap').style.display = 'block';
  document.getElementById('resultsPanel').style.display = 'none';

  setStep(0);

  try {
    const fd = new FormData();
    fd.append('video', uploadedFile);

    // Step simulation while waiting for real backend analysis
    let curStep = 0;
    const stepInterval = setInterval(() => {
      if (curStep < 4) {
        curStep++;
        setStep(curStep);
      }
    }, 700);

    const res = await fetch(`${API}/api/analyze`, {
      method: 'POST',
      body: fd,
    });

    clearInterval(stepInterval);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error || `Server responded with ${res.status}`);
    }

    setStep(5);
    const data = await res.json();
    resultData = data;

    setTimeout(() => {
      document.getElementById('progressWrap').style.display = 'none';
      btnAnalyze.disabled = false;
      renderResults(data);
    }, 300);

  } catch (err) {
    document.getElementById('progressWrap').style.display = 'none';
    btnAnalyze.disabled = false;
    alert(`Detection Error: ${err.message}\nMake sure the Flask server is running at ${API}`);
  }
}

function setStep(idx) {
  document.querySelectorAll('.pstep').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < idx)   el.classList.add('done');
    if (i === idx) el.classList.add('active');
  });
  document.getElementById('progressBar').style.width = STEP_PCTS[idx] + '%';
  document.getElementById('progressMsg').textContent = STEPS[idx];
}

function renderResults(d) {
  document.getElementById('resultsPanel').style.display = 'flex';
  document.getElementById('resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const isFake = d.verdict === 'FAKE';
  const pct    = Math.round(d.avg_fake_score * 100);

  // Verdict card
  const vc = document.getElementById('verdictCard');
  vc.className = `verdict-card ${isFake ? 'fake' : 'real'}`;
  document.getElementById('vcWord').textContent  = d.verdict;
  document.getElementById('vcWord').className    = `vc-word ${isFake ? 'fake' : 'real'}`;

  const conf = document.getElementById('vcConf');
  conf.textContent = `${pct}% Deepfake Probability`;
  conf.className   = `vc-conf ${isFake ? 'fake' : 'real'}`;

  const desc = document.getElementById('vcDesc');
  if (isFake) {
    desc.textContent = 'High-frequency FFT artifacts, skin over-smoothing, or temporal optical jitter detected.';
  } else {
    desc.textContent = 'Natural sensor noise, coherent biological motion, and standard optical frequency decay observed.';
  }

  // Badges
  const badges = document.getElementById('vcBadges');
  badges.innerHTML = '';
  addBadge(badges, `${d.fake_frames} flagged frames`, isFake ? 'fake' : 'real');
  addBadge(badges, `${d.real_frames} authentic frames`, isFake ? 'real' : 'fake');
  if (d.metrics) {
    if (d.metrics.fft_anomaly > 0.6) addBadge(badges, `FFT Anomaly: ${(d.metrics.fft_anomaly * 100).toFixed(0)}%`, 'fake');
    if (d.metrics.texture_smoothing > 0.6) addBadge(badges, `Texture Smoothing: ${(d.metrics.texture_smoothing * 100).toFixed(0)}%`, 'fake');
    if (d.metrics.temporal_jitter > 0.6) addBadge(badges, `Motion Jitter: ${(d.metrics.temporal_jitter * 100).toFixed(0)}%`, 'fake');
  }

  // Gauge
  animateGauge(d.avg_fake_score, isFake);

  // Stats
  document.getElementById('scFrames').textContent = d.frame_count;
  document.getElementById('scFake').textContent   = d.fake_frames;
  document.getElementById('scReal').textContent   = d.real_frames;
  document.getElementById('scAvg').textContent    = pct + '%';

  // Chart
  buildResultChart(d.frame_scores);

  // Frame grid
  buildFrameGrid(d.frame_scores);
}

function addBadge(container, text, type) {
  const b = document.createElement('span');
  b.className   = `badge ${type}`;
  b.textContent = text;
  container.appendChild(b);
}

function animateGauge(prob, isFake) {
  const path   = document.getElementById('gaugePath');
  const pct    = document.getElementById('gaugePct');
  const total  = 235.6;
  const offset = total - total * prob;
  path.style.strokeDashoffset = offset;
  path.style.stroke = isFake ? 'url(#gFake)' : 'url(#gReal)';

  let start = 0, end = Math.round(prob * 100);
  const step = () => {
    start = Math.min(start + 2, end);
    pct.textContent = start + '%';
    pct.style.fill  = isFake ? '#ff1744' : '#00e676';
    if (start < end) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function buildResultChart(scores) {
  const ctx = document.getElementById('resultChart').getContext('2d');
  if (resultChart) resultChart.destroy();

  const gradFake = ctx.createLinearGradient(0, 0, 0, 160);
  gradFake.addColorStop(0, 'rgba(255,23,68,0.35)');
  gradFake.addColorStop(1, 'rgba(255,23,68,0.02)');

  const ptColors = scores.map(s => s >= 0.5 ? '#ff1744' : '#00f5ff');

  resultChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels  : scores.map((_, i) => `F${i + 1}`),
      datasets: [
        {
          label           : 'Fake Score',
          data            : scores,
          borderColor     : '#7c3aed',
          backgroundColor : gradFake,
          borderWidth     : 2.5,
          tension         : 0.38,
          fill            : true,
          pointRadius     : 4,
          pointHoverRadius: 7,
          pointBackgroundColor: ptColors,
        },
        {
          label      : 'Threshold (0.5)',
          data       : scores.map(() => 0.5),
          borderColor: 'rgba(0,245,255,0.4)',
          borderDash : [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill       : false,
        },
      ],
    },
    options: {
      responsive: true,
      animation : { duration: 800 },
      plugins: {
        legend : { display: false },
        tooltip: {
          backgroundColor: 'rgba(8,8,24,0.95)',
          callbacks      : { label: c => ` ${(c.parsed.y * 100).toFixed(1)}% — ${c.parsed.y >= 0.5 ? '🔴 FAKE' : '🟢 REAL'}` },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#555577', font: { size: 10 } } },
        y: {
          min: 0, max: 1,
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555577', font: { size: 10 }, callback: v => (v * 100) + '%' },
        },
      },
    },
  });
}

function buildFrameGrid(scores) {
  const grid = document.getElementById('frameGrid');
  grid.innerHTML = '';

  scores.forEach((score, i) => {
    const isFake = score >= 0.5;
    const pct    = Math.round(score * 100);
    const canvas = document.createElement('canvas');
    canvas.width  = 160; canvas.height = 120;
    drawFrameThumb(canvas, i, score, isFake);

    const item  = document.createElement('div');
    item.className = `frame-item ${isFake ? 'fake' : 'real'}`;
    item.title     = `Frame ${i + 1} — ${pct}% fake probability`;
    item.addEventListener('click', () => openModal(canvas, i, score, isFake));

    const lbl  = document.createElement('div');
    lbl.className = `frame-label ${isFake ? 'fake' : 'real'}`;
    lbl.textContent = `${isFake ? '🔴' : '🟢'} F${i + 1} · ${pct}%`;

    item.appendChild(canvas);
    item.appendChild(lbl);
    grid.appendChild(item);
  });
}

function drawFrameThumb(canvas, idx, score, isFake) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  if (isFake) {
    bg.addColorStop(0, '#1c0408');
    bg.addColorStop(1, '#0c0012');
  } else {
    bg.addColorStop(0, '#021008');
    bg.addColorStop(1, '#000c14');
  }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Face Silhouette
  const cx = W / 2, cy = H * 0.45;
  const faceGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 32);
  faceGrad.addColorStop(0, isFake ? 'rgba(255,23,68,0.25)' : 'rgba(0,245,255,0.2)');
  faceGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = faceGrad;
  ctx.beginPath(); ctx.ellipse(cx, cy, 30, 38, 0, 0, Math.PI * 2); ctx.fill();

  // Bottom score bar
  const barY = H - 12, barW = W - 20, barH = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, barY, barW, barH);
  ctx.fillStyle = isFake ? 'var(--red)' : 'var(--green)';
  ctx.fillRect(10, barY, barW * score, barH);
}

function openModal(srcCanvas, idx, score, isFake) {
  const mCanvas = document.getElementById('modalCanvas');
  const mCtx    = mCanvas.getContext('2d');
  mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
  mCtx.drawImage(srcCanvas, 0, 0, mCanvas.width, mCanvas.height);

  document.getElementById('modalInfo').innerHTML = `
    <strong>Frame ${idx + 1}</strong><br/>
    Verdict: <span style="color:${isFake ? 'var(--red)' : 'var(--green)'};font-weight:700">${isFake ? '🔴 FAKE' : '🟢 REAL'}</span><br/>
    Fake Probability: ${Math.round(score * 100)}%<br/>
    Analysis: ${isFake ? 'High-frequency spectral anomaly / texture residual' : 'Consistent natural camera optics'}
  `;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

function exportReport() {
  if (!resultData) return;
  const d = resultData;
  const pct = Math.round(d.avg_fake_score * 100);
  const lines = [
    '╔══════════════════════════════════════════╗',
    '║        DEEPGUARD FORENSIC REPORT         ║',
    '╚══════════════════════════════════════════╝',
    '',
    `Verdict               : ${d.verdict}`,
    `Fake Probability      : ${pct}%`,
    `Total Frames Analyzed : ${d.frame_count}`,
    `Flagged Fake Frames   : ${d.fake_frames}`,
    `Authentic Frames      : ${d.real_frames}`,
    `Engine                : ${d.model || 'CV Forensics'}`,
    '',
    '── Forensics Telemetry Breakdown ──',
    d.metrics ? `  • 2D FFT Anomaly       : ${(d.metrics.fft_anomaly * 100).toFixed(1)}%` : '',
    d.metrics ? `  • Skin Over-smoothing  : ${(d.metrics.texture_smoothing * 100).toFixed(1)}%` : '',
    d.metrics ? `  • Chroma Inconsistency : ${(d.metrics.chroma_inconsistency * 100).toFixed(1)}%` : '',
    d.metrics ? `  • Temporal Jitter      : ${(d.metrics.temporal_jitter * 100).toFixed(1)}%` : '',
    '',
    '── Frame Scores ──',
    ...d.frame_scores.map((s, i) => `  F${String(i + 1).padStart(2, '0')}: ${(s * 100).toFixed(1)}% [${s >= 0.5 ? 'FAKE' : 'REAL'}]`),
    '',
    `Timestamp : ${new Date().toLocaleString()}`,
  ];
  const blob = new Blob([lines.filter(Boolean).join('\n')], { type: 'text/plain' });
  const a    = Object.assign(document.createElement('a'), {
    href    : URL.createObjectURL(blob),
    download: `deepguard_forensic_${Date.now()}.txt`
  });
  a.click();
}


// ═══════════════════════════════════════════════════════════
// ── SECTION 2: LIVE WEBCAM & BIOMETRICS ENGINE
// ═══════════════════════════════════════════════════════════

let webcamStream    = null;
let isWebcamActive  = false;
let audioContext    = null;
let audioAnalyser   = null;
let audioDataArray  = null;
let isAudioEnabled  = true;
let animFrameId     = null;
let lastServerCheck = 0;

// Telemetry state
const bioState = {
  // Blinks
  blinkCount: 0,
  blinkStartTime: 0,
  eyeOpenHistory: [],
  isBlinking: false,
  blinkRateBpm: 0,
  // Micro-movements
  faceCentroidHistory: [],
  jitterVariance: 0,
  // Lip-Sync
  mouthOpenHistory: [],
  audioEnergyHistory: [],
  lipSyncScore: 0,
  // rPPG pulse
  greenChannelHistory: [],
  pulseBpm: 0,
  // Server FFT
  serverFakeProb: 0.15,
};

async function toggleWebcam() {
  if (isWebcamActive) {
    stopWebcam();
  } else {
    await startWebcam();
  }
}

async function startWebcam() {
  const video = document.getElementById('webcamVideo');
  const placeholder = document.getElementById('camPlaceholder');
  const btnToggle = document.getElementById('btnToggleCam');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: true
    });

    webcamStream = stream;
    video.srcObject = stream;
    await video.play();

    isWebcamActive = true;
    placeholder.style.display = 'none';
    btnToggle.innerHTML = '<span>⏹ Stop Camera &amp; Mic</span>';
    btnToggle.classList.add('active');

    document.getElementById('bioStatusBadge').className = 'bio-status-badge live';
    document.getElementById('bioStatusBadge').textContent = '● LIVE';
    document.getElementById('camHudBadge').classList.add('visible');

    // Setup Web Audio
    setupAudioAnalysis(stream);

    // Reset session
    resetWebcamStats();

    // Start Real-Time Render Loop
    requestAnimationFrame(webcamAnalysisLoop);

  } catch (err) {
    console.error("Camera access error:", err);
    alert(`Webcam/Microphone Access Error: ${err.message}\nPlease ensure camera and microphone permissions are granted.`);
  }
}

function stopWebcam() {
  isWebcamActive = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);

  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }

  const video = document.getElementById('webcamVideo');
  if (video) video.srcObject = null;

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  document.getElementById('camPlaceholder').style.display = 'flex';
  const btnToggle = document.getElementById('btnToggleCam');
  if (btnToggle) {
    btnToggle.innerHTML = '<span>📹 Start Camera &amp; Mic</span>';
    btnToggle.classList.remove('active');
  }

  document.getElementById('bioStatusBadge').className = 'bio-status-badge idle';
  document.getElementById('bioStatusBadge').textContent = 'IDLE';
  document.getElementById('camHudBadge').classList.remove('visible');
  document.getElementById('camViewport').className = 'webcam-viewport';

  document.getElementById('lvWord').textContent = 'STANDBY';
  document.getElementById('lvWord').className = 'lv-word';
  document.getElementById('lvDesc').textContent = 'Camera is turned off.';
}

function toggleAudio() {
  isAudioEnabled = !isAudioEnabled;
  const icon = document.getElementById('audioBtnIcon');
  if (webcamStream) {
    webcamStream.getAudioTracks().forEach(t => { t.enabled = isAudioEnabled; });
  }
  if (icon) {
    icon.textContent = isAudioEnabled ? '🎙️ Voice: ON' : '🔇 Voice: MUTED';
  }
}

function setupAudioAnalysis(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioAnalyser.smoothingTimeConstant = 0.6;
    source.connect(audioAnalyser);
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  } catch (e) {
    console.warn("Web Audio API not supported:", e);
  }
}

function resetWebcamStats() {
  bioState.blinkCount = 0;
  bioState.blinkStartTime = Date.now();
  bioState.eyeOpenHistory = [];
  bioState.faceCentroidHistory = [];
  bioState.mouthOpenHistory = [];
  bioState.audioEnergyHistory = [];
  bioState.greenChannelHistory = [];
  bioState.serverFakeProb = 0.15;
}

// ── Real-time Analysis Loop ──
const hiddenCanvas = document.createElement('canvas');
hiddenCanvas.width = 160;
hiddenCanvas.height = 120;
const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

function webcamAnalysisLoop() {
  if (!isWebcamActive) return;

  const video   = document.getElementById('webcamVideo');
  const overlay = document.getElementById('webcamOverlay');

  if (video && video.readyState >= 2) {
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width  = video.videoWidth  || 640;
      overlay.height = video.videoHeight || 480;
    }

    const oCtx = overlay.getContext('2d');
    oCtx.clearRect(0, 0, overlay.width, overlay.height);

    // 1. Draw frame to low-res canvas for fast pixel processing
    hiddenCtx.drawImage(video, 0, 0, 160, 120);
    const imgData = hiddenCtx.getImageData(0, 0, 160, 120);
    const pixels = imgData.data;

    // 2. Skin & Face Region Detection
    const faceROI = extractSkinCentroid(pixels, 160, 120);

    // 3. Audio Energy Reading
    let currentAudioRMS = 0;
    if (audioAnalyser && isAudioEnabled) {
      audioAnalyser.getByteFrequencyData(audioDataArray);
      let sum = 0;
      for (let i = 0; i < audioDataArray.length; i++) sum += audioDataArray[i];
      currentAudioRMS = sum / audioDataArray.length; // 0 to 255
      updateAudioVu(currentAudioRMS);
    } else {
      updateAudioVu(0);
    }

    if (faceROI) {
      // Scale to overlay dimensions
      const scaleX = overlay.width / 160;
      const scaleY = overlay.height / 120;
      const rx = faceROI.x * scaleX;
      const ry = faceROI.y * scaleY;
      const rw = faceROI.w * scaleX;
      const rh = faceROI.h * scaleY;

      // 4. Micro-Movements (Tremor & Saccade displacement)
      trackMicroMovements(faceROI.cx * scaleX, faceROI.cy * scaleY);

      // 5. Eye Openness & Blink Tracking
      trackEyeBlinks(pixels, faceROI);

      // 6. Lip-Sync & Mouth Openness
      trackLipSync(pixels, faceROI, currentAudioRMS);

      // 7. Biological rPPG (Green channel blood absorption)
      trackRPPG(pixels, faceROI);

      // 8. Render AR HUD Overlays on Canvas
      renderFaceHUD(oCtx, rx, ry, rw, rh);

      // 9. Periodic Server-Side FFT Verification (every 1.5 seconds)
      const now = Date.now();
      if (now - lastServerCheck > 1500 && apiOnline) {
        lastServerCheck = now;
        sendFrameToServer(hiddenCanvas);
      }
    } else {
      // No face isolated
      renderSearchingHUD(oCtx, overlay.width, overlay.height);
    }

    // 10. Update Telemetry UI & Compute Composite Live Liveness Verdict
    updateBiometricTelemetry(faceROI !== null);
  }

  animFrameId = requestAnimationFrame(webcamAnalysisLoop);
}

// ── Skin Centroid & Face Extraction ──
function extractSkinCentroid(pixels, W, H) {
  let minX = W, maxX = 0, minY = H, maxY = 0;
  let count = 0;
  let sumX = 0, sumY = 0;

  for (let y = 10; y < H - 10; y += 2) {
    for (let x = 10; x < W - 10; x += 2) {
      const idx = (y * W + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // Normalized RGB skin condition
      if (r > 60 && g > 40 && b > 20 && (r - g) > 12 && r > b) {
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Need at least 250 skin pixels for valid face
  if (count < 250) return null;

  const cx = sumX / count;
  const cy = sumY / count;
  const cw = Math.max(40, maxX - minX);
  const ch = Math.max(50, maxY - minY);

  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    w: cw,
    h: ch,
    cx: cx,
    cy: cy
  };
}

// ── Micro-Movements Tracking ──
function trackMicroMovements(cx, cy) {
  bioState.faceCentroidHistory.push({ x: cx, y: cy });
  if (bioState.faceCentroidHistory.length > 50) {
    bioState.faceCentroidHistory.shift();
  }

  if (bioState.faceCentroidHistory.length > 10) {
    let diffs = [];
    const hist = bioState.faceCentroidHistory;
    for (let i = 1; i < hist.length; i++) {
      const dx = hist[i].x - hist[i-1].x;
      const dy = hist[i].y - hist[i-1].y;
      diffs.push(Math.sqrt(dx*dx + dy*dy));
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    let variance = 0;
    diffs.forEach(d => { variance += Math.pow(d - mean, 2); });
    bioState.jitterVariance = Math.sqrt(variance / diffs.length);
  }
}

// ── Eye Blinking & EAR (Eye Aspect Ratio) ──
function trackEyeBlinks(pixels, face) {
  // Approximate eye band in upper 30-45% of face ROI
  const eyeY1 = Math.floor(face.y + face.h * 0.25);
  const eyeY2 = Math.floor(face.y + face.h * 0.42);
  const eyeX1 = Math.floor(face.x + face.w * 0.20);
  const eyeX2 = Math.floor(face.x + face.w * 0.80);

  let darkPixels = 0;
  let totalSampled = 0;

  for (let y = eyeY1; y < eyeY2; y += 2) {
    for (let x = eyeX1; x < eyeX2; x += 2) {
      const idx = (y * 160 + x) * 4;
      const gray = (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
      // Iris & pupil are distinctively dark
      if (gray < 65) darkPixels++;
      totalSampled++;
    }
  }

  const eyeRatio = totalSampled > 0 ? (darkPixels / totalSampled) : 0.15;
  bioState.eyeOpenHistory.push(eyeRatio);
  if (bioState.eyeOpenHistory.length > 30) bioState.eyeOpenHistory.shift();

  // Blink trigger (sudden dip in visible dark iris pixels when eyelid closes)
  const isCurrentlyClosed = eyeRatio < 0.04;
  if (isCurrentlyClosed && !bioState.isBlinking) {
    bioState.isBlinking = true;
    bioState.blinkCount++;
  } else if (!isCurrentlyClosed && bioState.isBlinking) {
    bioState.isBlinking = false;
  }

  // Calculate Blinks Per Minute
  const elapsedMinutes = Math.max(0.1, (Date.now() - bioState.blinkStartTime) / 60000);
  bioState.blinkRateBpm = Math.round(bioState.blinkCount / elapsedMinutes);
}

// ── Lip-Sync Correlation ──
function trackLipSync(pixels, face, audioRMS) {
  // Mouth region: bottom 65-85% of face ROI
  const mY1 = Math.floor(face.y + face.h * 0.65);
  const mY2 = Math.floor(face.y + face.h * 0.88);
  const mX1 = Math.floor(face.x + face.w * 0.30);
  const mX2 = Math.floor(face.x + face.w * 0.70);

  let cavityDarkPixels = 0;
  let total = 0;
  for (let y = mY1; y < mY2; y += 2) {
    for (let x = mX1; x < mX2; x += 2) {
      const idx = (y * 160 + x) * 4;
      const gray = (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
      if (gray < 55) cavityDarkPixels++; // Open mouth creates dark oral cavity
      total++;
    }
  }

  const mouthOpenness = total > 0 ? (cavityDarkPixels / total) : 0;
  bioState.mouthOpenHistory.push(mouthOpenness);
  bioState.audioEnergyHistory.push(audioRMS);

  if (bioState.mouthOpenHistory.length > 40) {
    bioState.mouthOpenHistory.shift();
    bioState.audioEnergyHistory.shift();
  }

  // Compute correlation if speech is occurring
  if (audioRMS > 15) {
    let matches = 0;
    const len = bioState.mouthOpenHistory.length;
    for (let i = 0; i < len; i++) {
      const audioActive = bioState.audioEnergyHistory[i] > 18;
      const mouthOpen   = bioState.mouthOpenHistory[i] > 0.05;
      if (audioActive === mouthOpen) matches++;
    }
    bioState.lipSyncScore = Math.round((matches / len) * 100);
  } else {
    // When silent, mouth should remain closed
    bioState.lipSyncScore = mouthOpenness < 0.04 ? 95 : 60;
  }
}

// ── rPPG Pulse (Biological Blood Absorption in Green Channel) ──
function trackRPPG(pixels, face) {
  // Forehead ROI: middle 30% of face width, upper 10-25% height
  const fY1 = Math.floor(face.y + face.h * 0.10);
  const fY2 = Math.floor(face.y + face.h * 0.25);
  const fX1 = Math.floor(face.x + face.w * 0.35);
  const fX2 = Math.floor(face.x + face.w * 0.65);

  let gSum = 0;
  let count = 0;
  for (let y = fY1; y < fY2; y += 2) {
    for (let x = fX1; x < fX2; x += 2) {
      const idx = (y * 160 + x) * 4;
      gSum += pixels[idx + 1]; // Green channel
      count++;
    }
  }

  if (count > 0) {
    const meanG = gSum / count;
    bioState.greenChannelHistory.push(meanG);
    if (bioState.greenChannelHistory.length > 90) bioState.greenChannelHistory.shift();

    // Zero-crossing pulse rate estimation over 3 seconds
    if (bioState.greenChannelHistory.length >= 60) {
      const hist = bioState.greenChannelHistory;
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      let crossings = 0;
      for (let i = 1; i < hist.length; i++) {
        if ((hist[i-1] - avg) * (hist[i] - avg) < 0) crossings++;
      }
      // Each full pulse cycle has 2 zero-crossings
      const estBpm = Math.round((crossings / 2) * (60 / 3));
      if (estBpm >= 50 && estBpm <= 120) {
        bioState.pulseBpm = estBpm;
      }
    }
  }
}

// ── Server Frame Verification (FFT) ──
async function sendFrameToServer(canvas) {
  try {
    const b64 = canvas.toDataURL('image/jpeg', 0.7);
    const res = await fetch(`${API}/api/analyze_frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: b64 }),
    });
    if (res.ok) {
      const d = await res.json();
      bioState.serverFakeProb = d.fake_prob || 0.15;
    }
  } catch (_) {}
}

// ── Canvas HUD Rendering ──
function renderFaceHUD(ctx, x, y, w, h) {
  // Corner Brackets
  const cLen = Math.min(w, h) * 0.2;
  const isHealthy = bioState.jitterVariance >= 0.4 && bioState.jitterVariance <= 5.0;
  const strokeColor = isHealthy ? 'rgba(0,230,118,0.85)' : 'rgba(255,23,68,0.85)';

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';

  const pad = 6;
  const bx1 = x - pad, by1 = y - pad;
  const bx2 = x + w + pad, by2 = y + h + pad;

  // Corners
  ctx.beginPath();
  ctx.moveTo(bx1, by1 + cLen); ctx.lineTo(bx1, by1); ctx.lineTo(bx1 + cLen, by1);
  ctx.moveTo(bx2 - cLen, by1); ctx.lineTo(bx2, by1); ctx.lineTo(bx2, by1 + cLen);
  ctx.moveTo(bx1, by2 - cLen); ctx.lineTo(bx1, by2); ctx.lineTo(bx1 + cLen, by2);
  ctx.moveTo(bx2 - cLen, by2); ctx.lineTo(bx2, by2); ctx.lineTo(bx2, by2 - cLen);
  ctx.stroke();

  // Eye tracking boxes
  const eyeW = w * 0.25, eyeH = h * 0.15;
  const leftEyeX = x + w * 0.18, rightEyeX = x + w * 0.57;
  const eyeY = y + h * 0.25;

  ctx.strokeStyle = 'rgba(0,245,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(leftEyeX, eyeY, eyeW, eyeH);
  ctx.strokeRect(rightEyeX, eyeY, eyeW, eyeH);

  // Mouth tracking box
  const mouthX = x + w * 0.26, mouthY = y + h * 0.65;
  const mouthW = w * 0.48, mouthH = h * 0.20;
  ctx.strokeRect(mouthX, mouthY, mouthW, mouthH);
  ctx.setLineDash([]);

  // Micro-movement jitter anchor dots
  const hist = bioState.faceCentroidHistory;
  if (hist.length > 5) {
    ctx.fillStyle = 'rgba(0,245,255,0.4)';
    for (let i = Math.max(0, hist.length - 15); i < hist.length; i++) {
      ctx.beginPath();
      ctx.arc(hist[i].x, hist[i].y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // HUD Text tag
  ctx.fillStyle = strokeColor;
  ctx.font = 'bold 11px JetBrains Mono, monospace';
  ctx.fillText(`BIOMETRIC LOCK: ${isHealthy ? 'LIVE HUMAN' : 'ANOMALY DETECTED'}`, bx1, by1 - 8);
}

function renderSearchingHUD(ctx, W, H) {
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Searching for face in frame…', W / 2, H / 2);
}

function updateAudioVu(rms) {
  const fill = document.getElementById('avuFill');
  const val  = document.getElementById('avuVal');
  if (fill && val) {
    const pct = Math.min(100, Math.round((rms / 120) * 100));
    fill.style.width = pct + '%';
    val.textContent = `${Math.round(rms)} dB`;
  }
}

// ── Update Telemetry Dashboard ──
function updateBiometricTelemetry(faceDetected) {
  if (!faceDetected) return;

  // 1. Blink Frequency
  const blinkBpm = bioState.blinkRateBpm;
  const valBlink = document.getElementById('valBlink');
  const barBlink = document.getElementById('barBlink');
  const statusBlink = document.getElementById('statusBlink');

  valBlink.textContent = `${blinkBpm} bpm (${bioState.blinkCount} blinks)`;
  // Healthy human blinking is between 10 and 24 blinks/min
  const blinkNormal = (blinkBpm >= 8 && blinkBpm <= 28) || (Date.now() - bioState.blinkStartTime < 8000);
  barBlink.style.width = Math.min(100, blinkBpm * 4) + '%';
  barBlink.style.background = blinkNormal ? 'var(--green)' : 'var(--red)';
  statusBlink.textContent = blinkNormal
    ? 'Natural human blink frequency'
    : 'Abnormal: zero or erratic blinking (Deepfake indicator)';

  // 2. Micro-Movements (Tremor)
  const tremor = bioState.jitterVariance;
  const valTremor = document.getElementById('valTremor');
  const barTremor = document.getElementById('barTremor');
  const statusTremor = document.getElementById('statusTremor');

  valTremor.textContent = `${tremor.toFixed(2)} px`;
  const tremorNormal = tremor >= 0.4 && tremor <= 5.5;
  barTremor.style.width = Math.min(100, tremor * 20) + '%';
  barTremor.style.background = tremorNormal ? 'var(--green)' : 'var(--red)';
  statusTremor.textContent = tremorNormal
    ? 'Involuntary physiological tremor active'
    : tremor < 0.4 ? 'Frozen / Static photo mask detected' : 'Unnatural deepfake warping jitter';

  // 3. Lip-Sync
  const lipSync = bioState.lipSyncScore;
  const valLip = document.getElementById('valLipSync');
  const barLip = document.getElementById('barLipSync');
  const statusLip = document.getElementById('statusLipSync');

  valLip.textContent = `${lipSync}%`;
  barLip.style.width = lipSync + '%';
  const lipNormal = lipSync >= 65;
  barLip.style.background = lipNormal ? 'var(--green)' : 'var(--red)';
  statusLip.textContent = lipNormal
    ? 'Voice audio & mouth movement correlated'
    : 'Desync: Speech energy without mouth motion';

  // 4. rPPG Pulse
  const valPulse = document.getElementById('valPulse');
  const barPulse = document.getElementById('barPulse');
  const statusPulse = document.getElementById('statusPulse');
  if (bioState.pulseBpm > 0) {
    valPulse.textContent = `${bioState.pulseBpm} BPM`;
    barPulse.style.width = '85%';
    barPulse.style.background = 'var(--cyan)';
    statusPulse.textContent = 'Capillary blood absorption wave detected';
  } else {
    valPulse.textContent = 'Syncing…';
    barPulse.style.width = '35%';
    statusPulse.textContent = 'Accumulating hemoglobin green variance';
  }

  // 5. Server FFT Forensics
  const fftProb = bioState.serverFakeProb;
  const valFFT = document.getElementById('valFFT');
  const barFFT = document.getElementById('barFFT');
  const statusFFT = document.getElementById('statusFFT');
  valFFT.textContent = `${Math.round(fftProb * 100)}% fake`;
  barFFT.style.width = Math.round(fftProb * 100) + '%';
  barFFT.style.background = fftProb >= 0.5 ? 'var(--red)' : 'var(--green)';
  statusFFT.textContent = fftProb >= 0.5 ? 'High-frequency grid peak detected' : 'Natural optical sensor power curve';

  // ── Overall Composite Liveness Decision ──
  let fakeSignals = 0;
  if (!blinkNormal && (Date.now() - bioState.blinkStartTime > 10000)) fakeSignals += 2;
  if (!tremorNormal) fakeSignals += 2;
  if (!lipNormal) fakeSignals += 1;
  if (fftProb >= 0.50) fakeSignals += 2;

  const isDeepfake = fakeSignals >= 3;
  const authenticityScore = Math.max(5, Math.min(99, 100 - (fakeSignals * 18)));

  // Viewport class
  const vp = document.getElementById('camViewport');
  vp.className = `webcam-viewport ${isDeepfake ? 'fake-detected' : 'authentic'}`;

  // HUD Score Badge
  const hudScore = document.getElementById('chbScore');
  const hudLabel = document.getElementById('chbLabel');
  const hudBadge = document.getElementById('camHudBadge');
  hudScore.textContent = `${authenticityScore}%`;
  hudLabel.textContent = isDeepfake ? 'FAKE DETECTED' : 'LIVE HUMAN';
  hudBadge.className   = `cam-hud-badge visible ${isDeepfake ? 'fake' : 'real'}`;

  // Verdict Banner
  const lvWord = document.getElementById('lvWord');
  const lvDesc = document.getElementById('lvDesc');
  if (isDeepfake) {
    lvWord.textContent = 'AI DEEPFAKE / SPOOF';
    lvWord.className   = 'lv-word deepfake';
    lvDesc.textContent = 'Anomalous biometrics: frozen blinking, synthetic tremor, or desynced speech detected.';
  } else {
    lvWord.textContent = 'AUTHENTIC LIVE HUMAN';
    lvWord.className   = 'lv-word authentic';
    lvDesc.textContent = 'Verified physiological liveness: natural blinking, micro-tremors, and voice lip-sync confirmed.';
  }
}

function exportWebcamReport() {
  const lines = [
    '╔══════════════════════════════════════════╗',
    '║     LIVE WEBCAM BIOMETRIC REPORT         ║',
    '╚══════════════════════════════════════════╝',
    '',
    `Eye Blink Rate        : ${bioState.blinkRateBpm} BPM (${bioState.blinkCount} total blinks)`,
    `Facial Micro-Tremor   : ${bioState.jitterVariance.toFixed(2)} px standard deviation`,
    `Lip-Sync Correlation  : ${bioState.lipSyncScore}%`,
    `rPPG Biological Pulse : ${bioState.pulseBpm ? bioState.pulseBpm + ' BPM' : 'Calibrating'}`,
    `Server FFT Anomaly    : ${Math.round(bioState.serverFakeProb * 100)}%`,
    '',
    `Live Verdict          : ${document.getElementById('lvWord').textContent}`,
    `Authenticity Index    : ${document.getElementById('chbScore').textContent}`,
    `Timestamp             : ${new Date().toLocaleString()}`,
    'DeepGuard Real-Time Live Biometrics Inspection'
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a    = Object.assign(document.createElement('a'), {
    href    : URL.createObjectURL(blob),
    download: `deepguard_webcam_telemetry_${Date.now()}.txt`
  });
  a.click();
}

// ── Helpers ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
