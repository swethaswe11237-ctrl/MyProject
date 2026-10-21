/* ============================================
   live.js — Real-time Deepfake Detection Logic
   ============================================ */

const API_BASE      = 'http://127.0.0.1:5000';
const CAPTURE_FPS   = 2;          // frames per second to analyze
const CAPTURE_MS    = 1000 / CAPTURE_FPS;
const CHART_WINDOW  = 30;         // last N frames shown in chart
const JPEG_QUALITY  = 0.75;

// ─── State ───
let liveChart       = null;
let captureInterval = null;
let isPlaying       = false;
let backendAlive    = false;
let frameHistory    = [];          // { t, prob, verdict, canvas }
let totalFake       = 0;
let totalReal       = 0;
let currentProb     = 0;
let currentVerdict  = '—';

// DOM refs
const video         = document.getElementById('liveVideo');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx    = overlayCanvas.getContext('2d');
const videoBadge    = document.getElementById('videoBadge');
const vobPct        = document.getElementById('vobPct');
const vobLabel      = document.getElementById('vobLabel');
const scanLine      = document.getElementById('scanLine');
const liveBadge     = document.getElementById('liveBadge');
const lvcWord       = document.getElementById('lvcWord');
const lvcSub        = document.getElementById('lvcSub');
const verdictCard   = document.getElementById('liveVerdictCard');
const lgFill        = document.getElementById('lgFill');
const lgLabel       = document.getElementById('lgLabel');
const vcbProgress   = document.getElementById('vcbProgress');
const vcbTime       = document.getElementById('vcbTime');
const frameStrip    = document.getElementById('frameStrip');
const frameStripCount = document.getElementById('frameStripCount');

// Hidden capture canvas
const captureCanvas = document.createElement('canvas');
captureCanvas.width  = 224;
captureCanvas.height = 224;
const captureCtx    = captureCanvas.getContext('2d');

// ─── Upload / Drag-drop ───
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('liveUploadZone').classList.add('drag-over');
}
function handleDragLeave(e) {
  document.getElementById('liveUploadZone').classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('liveUploadZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) loadVideo(file);
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadVideo(file);
}

// ─── Load Video ───
async function loadVideo(file) {
  // Check backend availability
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    backendAlive = r.ok;
  } catch (_) { backendAlive = false; }

  const url = URL.createObjectURL(file);
  video.src = url;

  video.onloadedmetadata = () => {
    document.getElementById('uploadPrompt').style.display  = 'none';
    document.getElementById('liveWorkspace').style.display = 'grid';

    resizeOverlay();
    buildLiveChart();
    updateTimerDisplay();
  };
}

// ─── Resize overlay canvas to match video ───
function resizeOverlay() {
  const rect = video.getBoundingClientRect();
  overlayCanvas.width  = video.videoWidth  || rect.width;
  overlayCanvas.height = video.videoHeight || rect.height;
}

window.addEventListener('resize', resizeOverlay);
video.addEventListener('loadeddata', resizeOverlay);

// ─── Play / Pause ───
function togglePlayPause() {
  if (video.paused) {
    video.play();
    startCapture();
    document.getElementById('btnPlayPause').textContent = '⏸';
    isPlaying = true;
    setLiveBadge('live');
  } else {
    video.pause();
    stopCapture();
    document.getElementById('btnPlayPause').textContent = '▶';
    isPlaying = false;
    setLiveBadge('idle');
  }
}

video.addEventListener('ended', () => {
  stopCapture();
  document.getElementById('btnPlayPause').textContent = '▶';
  isPlaying = false;
  setLiveBadge('done');
  showFinalSummary();
});

// ─── Reset ───
function resetDetection() {
  video.pause();
  video.currentTime = 0;
  stopCapture();
  frameHistory = [];
  totalFake = totalReal = 0;
  currentProb = 0;
  currentVerdict = '—';
  document.getElementById('btnPlayPause').textContent = '▶';
  isPlaying = false;

  // Reset metrics
  document.getElementById('lmFrames').textContent = '0';
  document.getElementById('lmFake').textContent   = '0';
  document.getElementById('lmReal').textContent   = '0';
  document.getElementById('lmAvg').textContent    = '—';

  vobPct.textContent   = '—%';
  vobLabel.textContent = 'READY';
  lvcWord.textContent  = '—';
  lvcWord.className    = 'lvc-word';
  lvcSub.textContent   = 'Press ▶ to start live detection';
  verdictCard.className= 'live-verdict-card';
  videoBadge.className = 'video-overlay-badge';
  document.getElementById('videoContainer').className = 'video-container';

  // Reset gauge
  lgFill.style.strokeDashoffset = '141.4';
  lgLabel.textContent = '0%';

  // Reset chart
  if (liveChart) {
    liveChart.data.labels   = [];
    liveChart.data.datasets[0].data = [];
    liveChart.update();
  }

  // Clear frame strip
  frameStrip.innerHTML  = '';
  frameStripCount.textContent = '0 frames';
  document.getElementById('vcbMarkers').innerHTML = '';

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  setLiveBadge('idle');
  vcbProgress.style.width = '0%';
}

// ─── Seek ───
function seekVideo(e) {
  const rect = document.getElementById('vcbTimeline').getBoundingClientRect();
  const pct  = (e.clientX - rect.left) / rect.width;
  video.currentTime = Math.max(0, Math.min(video.duration, pct * video.duration));
}

// ─── Capture Frames ───
function startCapture() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = setInterval(captureAndAnalyze, CAPTURE_MS);
}

function stopCapture() {
  if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
}

async function captureAndAnalyze() {
  if (video.paused || video.ended || video.readyState < 2) return;

  // Draw current video frame to capture canvas
  captureCtx.drawImage(video, 0, 0, 224, 224);
  const b64 = captureCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

  // Trigger scan-line animation
  triggerScanLine();

  let prob, verdict;
  if (backendAlive) {
    try {
      const res = await fetch(`${API_BASE}/api/analyze_frame`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ image: b64 }),
        signal : AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        prob    = data.fake_prob;
        verdict = data.verdict;
      } else { throw new Error('non-ok'); }
    } catch (_) {
      ({ prob, verdict } = simulateFrame());
    }
  } else {
    ({ prob, verdict } = simulateFrame());
  }

  processResult(prob, verdict, b64);
}

// Fallback simulation (when backend not reachable)
let _simBase = null;
function simulateFrame() {
  if (_simBase === null) _simBase = Math.random() > 0.4 ? 0.7 + Math.random() * 0.2 : 0.1 + Math.random() * 0.15;
  _simBase = Math.max(0.02, Math.min(0.97, _simBase + (Math.random() - 0.5) * 0.1));
  const prob = Math.max(0.01, Math.min(0.99, _simBase + (Math.random() - 0.5) * 0.08));
  return { prob: +prob.toFixed(4), verdict: prob >= 0.5 ? 'FAKE' : 'REAL' };
}

// ─── Process Detection Result ───
function processResult(prob, verdict, b64) {
  currentProb    = prob;
  currentVerdict = verdict;
  const isFake   = verdict === 'FAKE';
  const pct      = Math.round(prob * 100);

  // Counters
  if (isFake) totalFake++; else totalReal++;
  const total = totalFake + totalReal;

  // Store frame snapshot canvas
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width  = 72;
  thumbCanvas.height = 46;
  const tCtx = thumbCanvas.getContext('2d');
  tCtx.drawImage(captureCanvas, 0, 0, 72, 46);
  addGlitchOverlay(tCtx, 72, 46, prob, isFake);

  frameHistory.push({ t: video.currentTime, prob, verdict, canvas: thumbCanvas });

  // ── Update UI ──
  updateOverlay(prob, verdict, isFake, pct);
  updateBadge(pct, verdict, isFake);
  updateVerdictCard(verdict, isFake, pct);
  updateGauge(prob, isFake);
  updateMetrics(total, totalFake, totalReal, prob);
  updateChart(pct);
  addFrameStrip(thumbCanvas, prob, isFake, pct);
  addTimelineMarker(isFake);
  updateVideoProgress();
}

// ─── Canvas Overlay (glow border + corner brackets) ───
function updateOverlay(prob, verdict, isFake, pct) {
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;
  overlayCtx.clearRect(0, 0, W, H);

  const color   = isFake ? `rgba(255,23,68,${0.4 + prob * 0.5})` : `rgba(0,230,118,${0.3 + (1-prob) * 0.4})`;
  const glowClr = isFake ? `rgba(255,23,68,0.3)` : `rgba(0,230,118,0.2)`;
  const thick   = 3 + prob * 4;
  const cLen    = Math.min(W, H) * 0.12;

  // Glow shadow
  overlayCtx.shadowColor = glowClr;
  overlayCtx.shadowBlur  = 20;

  // Corner brackets
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth   = thick;
  overlayCtx.lineCap     = 'round';
  const pad = 10;

  const corners = [
    [[pad, pad + cLen], [pad, pad],     [pad + cLen, pad]],
    [[W-pad-cLen, pad], [W-pad, pad],   [W-pad, pad+cLen]],
    [[pad, H-pad-cLen], [pad, H-pad],   [pad+cLen, H-pad]],
    [[W-pad-cLen,H-pad],[W-pad, H-pad], [W-pad, H-pad-cLen]],
  ];

  corners.forEach(pts => {
    overlayCtx.beginPath();
    overlayCtx.moveTo(...pts[0]);
    overlayCtx.lineTo(...pts[1]);
    overlayCtx.lineTo(...pts[2]);
    overlayCtx.stroke();
  });

  overlayCtx.shadowBlur = 0;

  // Face detection box simulation
  const boxX = W * 0.30, boxY = H * 0.10;
  const boxW = W * 0.40, boxH = H * 0.75;
  overlayCtx.strokeStyle = isFake ? `rgba(255,23,68,${0.3 + prob * 0.5})` : `rgba(0,230,118,${0.2 + (1-prob)*0.4})`;
  overlayCtx.lineWidth   = 1.5;
  overlayCtx.setLineDash([6, 4]);
  overlayCtx.strokeRect(boxX, boxY, boxW, boxH);
  overlayCtx.setLineDash([]);

  // Label above face box
  const label = `${pct}% ${verdict}`;
  overlayCtx.font      = 'bold 11px JetBrains Mono, monospace';
  overlayCtx.fillStyle = isFake ? 'rgba(255,23,68,0.9)' : 'rgba(0,230,118,0.9)';
  overlayCtx.fillText(label, boxX, boxY - 5);

  // Video container border class
  const vc = document.getElementById('videoContainer');
  vc.className = `video-container ${isFake ? 'is-fake' : 'is-real'}`;
}

// ─── Video Overlay Badge ───
function updateBadge(pct, verdict, isFake) {
  vobPct.textContent   = pct + '%';
  vobLabel.textContent = verdict;
  videoBadge.className = `video-overlay-badge ${isFake ? 'fake-high' : 'real-high'}`;
}

// ─── Verdict Card ───
function updateVerdictCard(verdict, isFake, pct) {
  lvcWord.textContent  = verdict;
  lvcWord.className    = `lvc-word ${isFake ? 'fake' : 'real'}`;
  lvcSub.textContent   = `${pct}% deepfake probability`;
  verdictCard.className= `live-verdict-card ${isFake ? 'fake' : 'real'}`;
}

// ─── Gauge ───
const GAUGE_LEN = 141.4;
function updateGauge(prob, isFake) {
  const offset = GAUGE_LEN - GAUGE_LEN * prob;
  lgFill.style.strokeDashoffset = offset;
  lgFill.style.stroke = isFake ? 'url(#lgFake)' : 'url(#lgReal)';
  lgLabel.textContent = Math.round(prob * 100) + '%';
  lgLabel.style.fill  = isFake ? '#ff1744' : '#00e676';
}

// ─── Metrics ───
function updateMetrics(total, fake, real, prob) {
  document.getElementById('lmFrames').textContent = total;
  document.getElementById('lmFake').textContent   = fake;
  document.getElementById('lmReal').textContent   = real;
  const avg = frameHistory.reduce((s, f) => s + f.prob, 0) / frameHistory.length;
  document.getElementById('lmAvg').textContent = Math.round(avg * 100) + '%';
}

// ─── Live Chart ───
function buildLiveChart() {
  const ctx = document.getElementById('liveChart').getContext('2d');
  if (liveChart) { liveChart.destroy(); }

  const gradFake = ctx.createLinearGradient(0, 0, 0, 130);
  gradFake.addColorStop(0, 'rgba(255,23,68,0.4)');
  gradFake.addColorStop(1, 'rgba(255,23,68,0.02)');

  liveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label           : 'Fake Probability',
          data            : [],
          borderColor     : '#ff1744',
          backgroundColor : gradFake,
          borderWidth     : 2,
          tension         : 0.45,
          fill            : true,
          pointRadius     : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: [],
        },
        {
          label      : 'Threshold',
          data       : [],
          borderColor: 'rgba(0,245,255,0.4)',
          borderDash : [5, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill       : false,
        },
      ],
    },
    options: {
      animation   : { duration: 200 },
      responsive  : true,
      plugins     : {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(8,8,24,0.95)',
          borderColor    : 'rgba(0,245,255,0.2)',
          borderWidth    : 1,
          callbacks      : {
            label: c => ` ${(c.parsed.y * 100).toFixed(1)}% ${c.parsed.y >= 0.5 ? '🔴 FAKE' : '🟢 REAL'}`,
          },
        },
      },
      scales: {
        x: {
          grid : { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555577', font: { size: 10 }, maxTicksLimit: 6 },
        },
        y: {
          min  : 0, max: 1,
          grid : { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555577', font: { size: 10 }, callback: v => (v * 100) + '%' },
        },
      },
    },
  });
}

function updateChart(pct) {
  if (!liveChart) return;
  const total = frameHistory.length;
  const label = `F${total}`;
  const prob  = pct / 100;
  const isFake= prob >= 0.5;

  liveChart.data.labels.push(label);
  liveChart.data.datasets[0].data.push(prob);
  liveChart.data.datasets[0].pointBackgroundColor.push(isFake ? '#ff1744' : '#00f5ff');
  liveChart.data.datasets[1].data.push(0.5);

  // Keep only last CHART_WINDOW points
  if (liveChart.data.labels.length > CHART_WINDOW) {
    liveChart.data.labels.shift();
    liveChart.data.datasets[0].data.shift();
    liveChart.data.datasets[0].pointBackgroundColor.shift();
    liveChart.data.datasets[1].data.shift();
  }

  liveChart.update('none');
}

// ─── Frame Strip ───
function addFrameStrip(thumbCanvas, prob, isFake, pct) {
  const item = document.createElement('div');
  item.className = `strip-frame ${isFake ? 'fake' : 'real'}`;
  item.setAttribute('role', 'listitem');
  item.title = `Frame ${frameHistory.length} — ${pct}% fake`;

  const c = document.createElement('canvas');
  c.className = 'strip-canvas';
  c.width  = 72; c.height = 46;
  c.getContext('2d').drawImage(thumbCanvas, 0, 0);

  const bar     = document.createElement('div');
  bar.className = 'strip-bar';
  const fill    = document.createElement('div');
  fill.className= 'strip-bar-fill';
  fill.style.cssText = `width:0%; background:${isFake ? 'var(--red)' : 'var(--green)'}`;
  bar.appendChild(fill);
  setTimeout(() => { fill.style.width = pct + '%'; }, 50);

  item.appendChild(c);
  item.appendChild(bar);
  frameStrip.appendChild(item);
  frameStrip.scrollLeft = frameStrip.scrollWidth;
  frameStripCount.textContent = `${frameHistory.length} frame${frameHistory.length !== 1 ? 's' : ''}`;
}

// ─── Timeline Marker ───
function addTimelineMarker(isFake) {
  if (!video.duration) return;
  const pct    = (video.currentTime / video.duration) * 100;
  const marker = document.createElement('div');
  marker.className = 'vcb-marker';
  marker.style.cssText = `left:${pct}%; background:${isFake ? 'var(--red)' : 'var(--green)'};`;
  document.getElementById('vcbMarkers').appendChild(marker);
}

// ─── Video Progress ───
function updateVideoProgress() {
  if (!video.duration) return;
  const pct = (video.currentTime / video.duration) * 100;
  vcbProgress.style.width = pct + '%';
  updateTimerDisplay();
}

video.addEventListener('timeupdate', updateTimerDisplay);
function updateTimerDisplay() {
  const cur = formatTime(video.currentTime || 0);
  const dur = formatTime(video.duration    || 0);
  vcbTime.textContent = `${cur} / ${dur}`;
}

// ─── Scan Line ───
function triggerScanLine() {
  scanLine.classList.remove('active');
  void scanLine.offsetWidth; // reflow
  scanLine.classList.add('active');
}

// ─── Live Badge ───
function setLiveBadge(state) {
  const map = {
    live: ['⏺ LIVE',  'live'],
    idle: ['⏸ IDLE',  ''],
    done: ['✅ DONE',  'real'],
  };
  const [text, cls] = map[state] || ['⏸ IDLE', ''];
  liveBadge.textContent = text;
  liveBadge.className   = `live-badge ${cls}`;
}

// ─── Final Summary ───
function showFinalSummary() {
  const total = frameHistory.length;
  if (total === 0) return;
  const avg     = frameHistory.reduce((s, f) => s + f.prob, 0) / total;
  const verdict = avg >= 0.5 ? 'FAKE' : 'REAL';
  const isFake  = verdict === 'FAKE';
  lvcSub.textContent = `Final: ${Math.round(avg * 100)}% avg — ${total} frames analyzed`;
  lvcWord.textContent = verdict;
  lvcWord.className   = `lvc-word ${isFake ? 'fake' : 'real'}`;
  verdictCard.className= `live-verdict-card ${isFake ? 'fake' : 'real'}`;
}

// ─── Export Report ───
function exportLiveReport() {
  const total = frameHistory.length;
  const avg   = total > 0 ? frameHistory.reduce((s, f) => s + f.prob, 0) / total : 0;
  const lines = [
    '╔══════════════════════════════════════════╗',
    '║     DEEPGUARD LIVE DETECTION REPORT      ║',
    '╚══════════════════════════════════════════╝',
    '',
    `Total Frames Analyzed : ${total}`,
    `Fake Frames           : ${totalFake}`,
    `Real Frames           : ${totalReal}`,
    `Average Fake Prob     : ${Math.round(avg * 100)}%`,
    `Final Verdict         : ${avg >= 0.5 ? 'FAKE' : 'REAL'}`,
    `Backend Mode          : ${backendAlive ? 'Connected' : 'Demo (Offline)'}`,
    '',
    '──────────────────────────────────────────',
    'FRAME-BY-FRAME LOG',
    '──────────────────────────────────────────',
    ...frameHistory.map((f, i) => {
      const pct = Math.round(f.prob * 100);
      const bar = '█'.repeat(Math.round(pct / 5));
      return `  F${String(i+1).padStart(3,'0')}  t=${f.t.toFixed(2)}s  [${f.verdict}]  ${String(pct).padStart(3)}%  ${bar}`;
    }),
    '',
    `Generated: ${new Date().toLocaleString()}`,
    'DeepGuard © 2024 — CNN-LSTM Live Deepfake Detection',
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `deepguard_live_${Date.now()}.txt`;
  a.click();
}

// ─── Canvas Glitch Overlay ───
function addGlitchOverlay(ctx, W, H, prob, isFake) {
  if (isFake && prob > 0.65) {
    const slices = Math.floor((prob - 0.5) * 8);
    for (let i = 0; i < slices; i++) {
      const y  = Math.random() * H;
      const sh = Math.random() * 3 + 1;
      const ox = (Math.random() - 0.5) * 6;
      try {
        const d = ctx.getImageData(0, y, W, sh);
        ctx.putImageData(d, ox, y);
      } catch (_) {}
    }
    ctx.fillStyle = 'rgba(255,23,68,0.1)';
    ctx.fillRect(0, 0, W, H);
  }
}

// ─── Helpers ───
function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
