/* ============================================
   results.js — Results Page Logic
   ============================================ */

// ─── Load Result from sessionStorage ───
const raw = sessionStorage.getItem('deepguard_result');
const result = raw ? JSON.parse(raw) : generateDemoResult();

function generateDemoResult() {
  // Fallback demo when navigating directly to results.html
  const N = 20;
  const isFake = true;
  const frameScores = Array.from({ length: N }, (_, i) => {
    let s = isFake ? 0.62 + Math.random() * 0.3 : 0.08 + Math.random() * 0.2;
    if (isFake && i > 8 && i < 14) s = Math.min(0.99, s + 0.15);
    return +s.toFixed(4);
  });
  const avg = frameScores.reduce((a, b) => a + b, 0) / N;
  return {
    filename    : 'sample_deepfake.mp4',
    size        : 18450000,
    duration    : 14,
    frameCount  : N,
    frameScores,
    avgFakeScore: +avg.toFixed(4),
    fakeFrames  : frameScores.filter(s => s >= 0.5).length,
    realFrames  : frameScores.filter(s => s < 0.5).length,
    verdict     : avg >= 0.5 ? 'FAKE' : 'REAL',
    processTime : '2.3',
    model       : 'EfficientNet-B0 + Bi-LSTM',
    mode        : 'demo',
  };
}

// ─── DOM References ───
const verdictBanner = document.getElementById('verdictBanner');
const verdictWord   = document.getElementById('verdictWord');
const verdictPct    = document.getElementById('verdictPct');
const gaugeFill     = document.getElementById('gaugeFill');
const gaugeLabel    = document.getElementById('gaugeLabel');

// ─── Populate Metadata ───
document.getElementById('resultsFilename').textContent = result.filename;

// ─── Stats ───
document.getElementById('statFrames').textContent     = result.frameCount;
document.getElementById('statFakeFrames').textContent = result.fakeFrames;
document.getElementById('statRealFrames').textContent = result.realFrames;
document.getElementById('statTime').textContent       = result.processTime + 's';

// ─── Verdict ───
const isFake     = result.verdict === 'FAKE';
const fakePct    = Math.round(result.avgFakeScore * 100);
const realPct    = 100 - fakePct;

verdictBanner.classList.add(isFake ? 'fake' : 'real');
verdictWord.classList.add(isFake ? 'fake' : 'real');
verdictWord.textContent = result.verdict;
verdictPct.textContent  = fakePct + '%';

// ─── Gauge Animation ───
// Arc total length for the 220° arc = 2π × 75 × (220/360) ≈ 287.98
// We use stroke-dasharray=235.6 (measured for the svg path)
const ARC_LEN = 235.6;
gaugeFill.classList.add(isFake ? 'fake' : 'real');

setTimeout(() => {
  const offset = ARC_LEN - (ARC_LEN * result.avgFakeScore);
  gaugeFill.style.strokeDashoffset = offset;
}, 200);

// Animate gauge label counter
animateCounter(gaugeLabel, 0, fakePct, 1600, v => v + '%');

// ─── Timeline Chart ───
function buildChart() {
  const labels = result.frameScores.map((_, i) => `F${i + 1}`);
  const ctx    = document.getElementById('timelineChart').getContext('2d');

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, 'rgba(255,23,68,0.35)');
  grad.addColorStop(1, 'rgba(255,23,68,0.02)');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label       : 'Deepfake Probability',
          data        : result.frameScores,
          borderColor : '#ff1744',
          backgroundColor: grad,
          borderWidth : 2.5,
          tension     : 0.4,
          fill        : true,
          pointBackgroundColor : result.frameScores.map(s => s >= 0.5 ? '#ff1744' : '#00f5ff'),
          pointBorderColor     : 'rgba(255,255,255,0.3)',
          pointRadius          : 5,
          pointHoverRadius     : 8,
        },
        {
          label       : 'Decision Threshold (0.5)',
          data        : Array(result.frameScores.length).fill(0.5),
          borderColor : 'rgba(0,245,255,0.5)',
          borderDash  : [6, 4],
          borderWidth : 1.5,
          pointRadius : 0,
          fill        : false,
        },
      ],
    },
    options: {
      responsive  : true,
      animation   : { duration: 1200, easing: 'easeInOutQuart' },
      plugins     : {
        legend : {
          display    : true,
          labels     : { color: '#8888aa', font: { family: 'Inter', size: 12 }, boxWidth: 14 },
        },
        tooltip: {
          backgroundColor : 'rgba(8,8,24,0.95)',
          borderColor     : 'rgba(0,245,255,0.2)',
          borderWidth     : 1,
          titleColor      : '#f0f0ff',
          bodyColor       : '#8888aa',
          padding         : 12,
          callbacks       : {
            label: ctx => {
              const v = ctx.parsed.y;
              return ` ${(v * 100).toFixed(1)}% ${v >= 0.5 ? '🔴 FAKE' : '🟢 REAL'}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid  : { color: 'rgba(255,255,255,0.05)' },
          ticks : { color: '#555577', font: { size: 11 } },
        },
        y: {
          min   : 0, max: 1,
          grid  : { color: 'rgba(255,255,255,0.05)' },
          ticks : {
            color    : '#555577',
            font     : { size: 11 },
            callback : v => (v * 100) + '%',
          },
        },
      },
    },
  });
}

buildChart();

// ─── Frames Grid ───
function buildFrameGrid() {
  const grid = document.getElementById('framesGrid');
  grid.innerHTML = '';

  result.frameScores.forEach((score, i) => {
    const isFakeFrame = score >= 0.5;
    const pct = Math.round(score * 100);

    const item = document.createElement('div');
    item.className   = `frame-item ${isFakeFrame ? 'high-fake' : 'low-fake'}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `Frame ${i + 1}: ${pct}% fake probability`);
    item.title = `Frame ${i + 1} — ${pct}% fake probability`;

    // Placeholder visual representing the frame (gradient canvas)
    const canvas = document.createElement('canvas');
    canvas.width  = 160;
    canvas.height = 90;
    canvas.className = 'frame-img';
    canvas.setAttribute('aria-hidden', 'true');
    renderFramePlaceholder(canvas, i, score, isFakeFrame);

    // Score badge
    const badge = document.createElement('div');
    badge.className = `frame-badge ${isFakeFrame ? 'fake' : 'real'}`;
    badge.textContent = pct + '%';
    badge.setAttribute('aria-hidden', 'true');

    // Score bar
    const barWrap = document.createElement('div');
    barWrap.className = 'frame-score-bar';
    const barFill = document.createElement('div');
    barFill.className = `frame-score-fill ${isFakeFrame ? 'high' : 'low'}`;
    barFill.style.width = '0%';
    barWrap.appendChild(barFill);

    item.appendChild(canvas);
    item.appendChild(badge);
    item.appendChild(barWrap);
    grid.appendChild(item);

    // Animate bar fill
    setTimeout(() => { barFill.style.width = pct + '%'; }, 300 + i * 60);

    // Click to see frame detail
    item.addEventListener('click', () => showFrameDetail(i, score));
  });
}

function renderFramePlaceholder(canvas, frameIdx, score, isFakeFrame) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  if (isFakeFrame) {
    bg.addColorStop(0, '#1a0a12');
    bg.addColorStop(1, '#200820');
  } else {
    bg.addColorStop(0, '#04100f');
    bg.addColorStop(1, '#081418');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Fake scanlines
  ctx.strokeStyle = isFakeFrame ? 'rgba(255,23,68,0.06)' : 'rgba(0,245,255,0.04)';
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Face silhouette oval
  ctx.save();
  const faceGrad = ctx.createRadialGradient(W/2, H*0.4, 2, W/2, H*0.4, 28);
  faceGrad.addColorStop(0, isFakeFrame ? 'rgba(255,80,100,0.35)' : 'rgba(0,230,118,0.2)');
  faceGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = faceGrad;
  ctx.beginPath();
  ctx.ellipse(W/2, H*0.42, 22, 28, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Frame number label
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText(`F${frameIdx + 1}`, 7, 15);

  // Glitch artifacts if fake
  if (isFakeFrame && score > 0.7) {
    const slices = Math.floor(score * 4);
    for (let s = 0; s < slices; s++) {
      const sy = Math.random() * H;
      const sh = Math.random() * 4 + 1;
      const ox = (Math.random() - 0.5) * 10;
      const imageData = ctx.getImageData(0, sy, W, sh);
      ctx.putImageData(imageData, ox, sy);
    }
    ctx.fillStyle = 'rgba(255,23,68,0.08)';
    ctx.fillRect(0, 0, W, H);
  }

  // Noise overlay
  const noiseData = ctx.createImageData(W, H);
  for (let j = 0; j < noiseData.data.length; j += 4) {
    const v = Math.random() * 18;
    noiseData.data[j]   = v;
    noiseData.data[j+1] = v;
    noiseData.data[j+2] = v;
    noiseData.data[j+3] = 20;
  }
  ctx.putImageData(noiseData, 0, 0);
}

buildFrameGrid();

// ─── Frame Detail Tooltip ───
function showFrameDetail(idx, score) {
  const existing = document.getElementById('frameDetailPopup');
  if (existing) existing.remove();

  const pct = Math.round(score * 100);
  const isFk = score >= 0.5;
  const popup = document.createElement('div');
  popup.id = 'frameDetailPopup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', `Frame ${idx+1} details`);
  popup.innerHTML = `
    <div style="
      position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000;
      display:flex; align-items:center; justify-content:center;
      backdrop-filter:blur(6px); animation:fadeIn 0.2s ease;
    " onclick="this.parentElement.remove()">
      <div style="
        background:#0d0d22; border:1px solid ${isFk?'rgba(255,23,68,0.35)':'rgba(0,245,255,0.25)'};
        border-radius:20px; padding:32px 36px; max-width:380px; width:90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        animation:fadeInUp 0.3s ease;
      " onclick="event.stopPropagation()">
        <h3 style="font-family:Space Grotesk,sans-serif; font-size:1.3rem; margin-bottom:6px;">
          Frame ${idx + 1} Details
        </h3>
        <p style="color:var(--text-muted); font-size:0.8rem; margin-bottom:20px;">CNN-LSTM per-frame analysis</p>
        <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
          <span style="color:var(--text-secondary);">Fake Probability</span>
          <strong style="color:${isFk?'var(--red)':'var(--green)'}; font-size:1.2rem;">${pct}%</strong>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden; margin-bottom:20px;">
          <div style="height:100%; width:${pct}%; background:${isFk?'var(--red)':'var(--green)'}; border-radius:99px; transition:width 0.6s ease;"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px;">
          <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:12px;">
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">VERDICT</div>
            <div style="font-weight:700; color:${isFk?'var(--red)':'var(--green)'};">${isFk?'FAKE':'REAL'}</div>
          </div>
          <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:12px;">
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">FRAME INDEX</div>
            <div style="font-weight:700; color:var(--cyan);">${idx + 1} / ${result.frameCount}</div>
          </div>
        </div>
        <button onclick="document.getElementById('frameDetailPopup').remove()"
          style="width:100%; padding:11px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
          border-radius:10px; color:var(--text-secondary); cursor:pointer; font-size:0.85rem; transition:all 0.2s;"
          onmouseover="this.style.background='rgba(255,255,255,0.1)'"
          onmouseout="this.style.background='rgba(255,255,255,0.06)'">
          Close
        </button>
      </div>
    </div>`;
  document.body.appendChild(popup);
}

// ─── Export Report ───
function exportReport() {
  const lines = [
    '╔══════════════════════════════════════════╗',
    '║        DEEPGUARD ANALYSIS REPORT         ║',
    '║       CNN-LSTM Deepfake Detection        ║',
    '╚══════════════════════════════════════════╝',
    '',
    `File          : ${result.filename}`,
    `Verdict       : ${result.verdict}`,
    `Fake Prob     : ${Math.round(result.avgFakeScore * 100)}%`,
    `Frames        : ${result.frameCount} total`,
    `Fake Frames   : ${result.fakeFrames}`,
    `Real Frames   : ${result.realFrames}`,
    `Process Time  : ${result.processTime}s`,
    `Model         : ${result.model}`,
    `Mode          : ${result.mode.toUpperCase()}`,
    '',
    '──────────────────────────────────────────',
    'PER-FRAME CONFIDENCE SCORES',
    '──────────────────────────────────────────',
    ...result.frameScores.map((s, i) => {
      const pct  = Math.round(s * 100);
      const verdict = s >= 0.5 ? '[FAKE]' : '[REAL]';
      const bar  = '█'.repeat(Math.round(pct / 5));
      return `  F${String(i+1).padStart(2,'0')}  ${verdict}  ${String(pct).padStart(3)}%  ${bar}`;
    }),
    '',
    '──────────────────────────────────────────',
    'ARCHITECTURE',
    '──────────────────────────────────────────',
    '  Input        → Frame Extractor (N=20)',
    '  Frames       → OpenCV Face Detector',
    '  Faces        → EfficientNet-B0 [CNN]',
    '  Features     → Bi-LSTM ×2 [Temporal]',
    '  LSTM Out     → Dropout(0.5) → FC(2)',
    '  FC Out       → Softmax → REAL/FAKE',
    '',
    `Report generated: ${new Date().toLocaleString()}`,
    'DeepGuard © 2024 — CNN-LSTM Deepfake Detection',
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `deepguard_report_${Date.now()}.txt`;
  a.click();
}

// ─── Animated Counter ───
function animateCounter(el, from, to, duration, formatter = v => v) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(Math.round(from + (to - from) * ease));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
