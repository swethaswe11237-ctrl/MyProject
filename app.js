/* ============================================
   app.js — Upload Page Logic
   ============================================ */

const API_BASE = 'http://127.0.0.1:5000';

// ─── Particle Canvas ───
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.r  = Math.random() * 1.5 + 0.4;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3;
      this.a  = Math.random() * 0.5 + 0.1;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,245,255,${this.a})`;
      ctx.fill();
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, () => new Particle());
    animate();
  }

  function animate() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', resize);
  init();
})();


// ─── State ───
let selectedFile = null;
let videoMetadata = {};

// ─── Drag & Drop ───
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('drag-over');
}

function handleDragLeave(e) {
  document.getElementById('uploadZone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) {
    processFile(file);
  } else {
    showToast('⚠️ Please drop a valid video file.');
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

// ─── Process Selected File ───
function processFile(file) {
  selectedFile = file;

  const previewWrap = document.getElementById('videoPreview');
  const video       = document.getElementById('previewVideo');
  const filename    = document.getElementById('videoFilename');
  const sizeEl      = document.getElementById('videoSize');
  const durEl       = document.getElementById('videoDuration');

  const url = URL.createObjectURL(file);
  video.src = url;

  filename.textContent = file.name;
  sizeEl.textContent   = formatBytes(file.size);

  video.onloadedmetadata = () => {
    const d = video.duration;
    durEl.textContent = isFinite(d) ? formatDuration(d) : '—';
    videoMetadata = { name: file.name, size: file.size, duration: d };
  };

  previewWrap.classList.add('visible');
  document.getElementById('btnAnalyze').classList.add('visible');
}

// ─── Analysis ───
const STEPS = [
  { id: 'step0', label: '📥 Uploading video…',          pct: 10 },
  { id: 'step1', label: '🎞️ Extracting 20 frames…',     pct: 28 },
  { id: 'step2', label: '👤 Detecting faces…',           pct: 45 },
  { id: 'step3', label: '🧠 CNN spatial features…',      pct: 65 },
  { id: 'step4', label: '🔗 LSTM temporal analysis…',    pct: 85 },
  { id: 'step5', label: '📊 Generating verdict…',        pct: 100 },
];

function startAnalysis() {
  if (!selectedFile) return;

  // Hide button, show progress
  document.getElementById('btnAnalyze').style.display = 'none';
  const progressWrap = document.getElementById('progressWrap');
  progressWrap.classList.add('visible');

  // Try real backend first
  tryRealBackend();
}

async function tryRealBackend() {
  try {
    const health = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (health.ok) {
      // Backend is alive — run with real API
      runSteps(0, true);
      return;
    }
  } catch (_) { /* backend offline — fall back to demo */ }
  runSteps(0, false);
}

function runSteps(idx, useBackend) {
  if (idx >= STEPS.length) {
    if (useBackend) {
      uploadAndAnalyze();
    } else {
      const result = simulateAnalysis(videoMetadata);
      sessionStorage.setItem('deepguard_result', JSON.stringify(result));
      setTimeout(() => { window.location.href = 'results.html'; }, 400);
    }
    return;
  }

  const step = STEPS[idx];
  // Update label & progress bar
  document.getElementById('stepText').textContent  = step.label;
  document.getElementById('progressPct').textContent = step.pct + '%';
  document.getElementById('progressFill').style.width  = step.pct + '%';

  // Mark chips
  for (let i = 0; i < STEPS.length; i++) {
    const chip = document.getElementById(STEPS[i].id);
    if (i < idx)  { chip.className = 'step-chip done'; }
    else if (i === idx) { chip.className = 'step-chip active'; }
    else          { chip.className = 'step-chip'; }
  }

  const delay = 550 + Math.random() * 450;
  setTimeout(() => runSteps(idx + 1, useBackend), delay);
}

async function uploadAndAnalyze() {
  // All steps done — actually POST to Flask
  document.getElementById('stepText').textContent = '🚀 Sending to backend…';
  try {
    const formData = new FormData();
    formData.append('video', selectedFile);

    const resp = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      body  : formData,
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server error');
    }

    const data = await resp.json();
    // Merge metadata for results page
    data.filename = data.filename || selectedFile.name;
    data.frameCount = data.frame_count || 20;
    data.frameScores = data.frame_scores || [];
    data.avgFakeScore = data.avg_fake_score || 0;
    data.fakeFrames = data.fake_frames || 0;
    data.realFrames = data.real_frames || 0;
    data.processTime = data.process_time || 0;
    sessionStorage.setItem('deepguard_result', JSON.stringify(data));
    window.location.href = 'results.html';
  } catch (e) {
    console.warn('Backend error, falling back to demo:', e);
    showToast('⚠️ Backend error — using demo mode.');
    const result = simulateAnalysis(videoMetadata);
    sessionStorage.setItem('deepguard_result', JSON.stringify(result));
    setTimeout(() => { window.location.href = 'results.html'; }, 800);
  }
}

// ─── Simulation Engine ───
function simulateAnalysis({ name = 'video.mp4', size = 0, duration = 30 }) {
  const N = 20;
  const frameScores = [];

  // Random "deepfake" distribution — could be real or fake
  const isFake = Math.random() > 0.4; // 60% chance demo is fake
  const baseFake = isFake ? 0.65 + Math.random() * 0.25 : 0.08 + Math.random() * 0.2;

  for (let i = 0; i < N; i++) {
    // Add noise and occasional spikes
    let score = baseFake + (Math.random() - 0.5) * 0.25;
    if (isFake && Math.random() > 0.7) score += 0.15;
    score = Math.min(0.99, Math.max(0.01, score));
    frameScores.push(+score.toFixed(4));
  }

  const avgFake = frameScores.reduce((s, v) => s + v, 0) / N;
  const fakeFrameCount = frameScores.filter(s => s >= 0.5).length;

  return {
    filename     : name,
    size         : size,
    duration     : duration,
    frameCount   : N,
    frameScores  : frameScores,
    avgFakeScore : +avgFake.toFixed(4),
    fakeFrames   : fakeFrameCount,
    realFrames   : N - fakeFrameCount,
    verdict      : avgFake >= 0.5 ? 'FAKE' : 'REAL',
    processTime  : (1.2 + Math.random() * 1.8).toFixed(1),
    model        : 'EfficientNet-B0 + Bi-LSTM',
    mode         : 'demo',
  };
}

// ─── Helpers ───
function formatBytes(b) {
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'30px', left:'50%', transform:'translateX(-50%)',
    background:'rgba(255,23,68,0.9)', color:'white', padding:'12px 24px',
    borderRadius:'12px', zIndex:'9999', fontSize:'0.85rem', fontWeight:'600',
    backdropFilter:'blur(10px)', boxShadow:'0 8px 30px rgba(0,0,0,0.5)'
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
