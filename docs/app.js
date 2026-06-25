const splash = document.getElementById('splash');
splash.addEventListener('animationend', e => {
  if (e.animationName === 'splash-exit') splash.style.display = 'none';
});

const video = document.getElementById('video');
const toggleBtn = document.getElementById('toggleBtn');
const statusPill = document.getElementById('statusPill');
const statusEl = document.getElementById('status');
const flashOverlay = document.getElementById('flashOverlay');
const boltStreak = document.getElementById('boltStreak');
const deltaFill = document.getElementById('deltaFill');

const sensitivitySlider = document.getElementById('sensitivity');
const sensValue = document.getElementById('sensValue');
const preTriggerSlider = document.getElementById('preTrigger');
const preTriggerValue = document.getElementById('preTriggerValue');

const settingsBtn = document.getElementById('settingsBtn');
const settingsSheet = document.getElementById('settingsSheet');
const settingsClose = document.getElementById('settingsClose');
const galleryBtn = document.getElementById('galleryBtn');
const gallerySheet = document.getElementById('gallerySheet');
const backdrop = document.getElementById('backdrop');
const shotBadge = document.getElementById('shotBadge');
const shotCountEl = document.getElementById('shotCount');
const galleryEl = document.getElementById('gallery');
const emptyGallery = document.getElementById('emptyGallery');

const modal = document.getElementById('modal');
const modalImg = document.getElementById('modalImg');
const modalDownload = document.getElementById('modalDownload');
const modalShare = document.getElementById('modalShare');
const modalClose = document.getElementById('modalClose');

const flipCameraBtn = document.getElementById('flipCameraBtn');
const flipLabel = document.getElementById('flipLabel');
const compositeWrap = document.getElementById('compositeWrap');
const compositeImg = document.getElementById('compositeImg');
const compositeDownload = document.getElementById('compositeDownload');
const compositeShare = document.getElementById('compositeShare');

if (!navigator.share) {
  modalShare.style.display = 'none';
  compositeShare.style.display = 'none';
}

const SAMPLE_W = 64;
const SAMPLE_H = 36;
const MAX_CAPTURE_DIM = 960;
const BUFFER_MS = 2000;
const CAPTURE_FPS = 20;
const COOLDOWN_MS = 1200;
const EMA_ALPHA = 0.05;

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = SAMPLE_W;
sampleCanvas.height = SAMPLE_H;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d');

let facingMode = 'environment';

// Restore saved settings
sensitivitySlider.value = localStorage.getItem('bk_sens') ?? 5;
preTriggerSlider.value  = localStorage.getItem('bk_pre')  ?? 250;
sensValue.textContent       = sensitivitySlider.value;
preTriggerValue.textContent = preTriggerSlider.value + ' ms';

// Composite canvas (screen blend — stacks all lightning bolts)
const compositeCanvas = document.createElement('canvas');
const compositeCtx = compositeCanvas.getContext('2d');
let compositeReady = false;

let stream = null;
let running = false;
let rafId = null;
let baseline = null;
let lastCaptureTime = 0;
let lastTriggerTime = -Infinity;
let buffer = [];
let shotCount = 0;

function sensitivityToThreshold(sens) {
  // 1 (unempfindlich) -> 40, 10 (sehr empfindlich) -> 6
  return 40 - (sens - 1) * (34 / 9);
}

sensitivitySlider.addEventListener('input', () => {
  sensValue.textContent = sensitivitySlider.value;
  localStorage.setItem('bk_sens', sensitivitySlider.value);
});

preTriggerSlider.addEventListener('input', () => {
  preTriggerValue.textContent = preTriggerSlider.value + ' ms';
  localStorage.setItem('bk_pre', preTriggerSlider.value);
});

toggleBtn.addEventListener('click', () => {
  if (running) {
    stopCamera();
  } else {
    startCamera();
  }
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  } catch (err) {
    setStatus('Zugriff fehlgeschlagen: ' + err.message, 'triggered');
    return;
  }

  video.srcObject = stream;
  await video.play();

  baseline = null;
  buffer = [];
  lastTriggerTime = -Infinity;
  running = true;
  document.body.classList.add('running');
  toggleBtn.setAttribute('aria-label', 'Kamera stoppen');
  setStatus('Überwache...', 'active');
  rafId = requestAnimationFrame(loop);
}

function stopCamera() {
  running = false;
  document.body.classList.remove('running');
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  toggleBtn.setAttribute('aria-label', 'Kamera starten');
  setStatus('Bereit', '');
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusPill.className = 'status-pill' + (cls ? ' ' + cls : '');
}

function getBrightness() {
  sampleCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  const data = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return sum / (SAMPLE_W * SAMPLE_H);
}

function captureFrame(time) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const scale = Math.min(1, MAX_CAPTURE_DIM / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  if (captureCanvas.width !== w || captureCanvas.height !== h) {
    captureCanvas.width = w;
    captureCanvas.height = h;
  }

  captureCtx.drawImage(video, 0, 0, w, h);
  const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
  buffer.push({ time, dataUrl });
  while (buffer.length && time - buffer[0].time > BUFFER_MS) {
    buffer.shift();
  }
}

function pickFrameBefore(targetTime) {
  if (!buffer.length) return null;
  let closest = buffer[0];
  let minDiff = Math.abs(buffer[0].time - targetTime);
  for (const f of buffer) {
    const diff = Math.abs(f.time - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = f;
    }
  }
  return closest;
}

function onLightningDetected(now) {
  lastTriggerTime = now;
  const preTriggerMs = Number(preTriggerSlider.value);
  const frame = pickFrameBefore(now - preTriggerMs);
  if (!frame) return;

  addToGallery(frame.dataUrl);
  addToComposite(frame.dataUrl);
  playShutterSound();
  triggerFlashFeedback();
}

function playShutterSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.045);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch(e) {}
}

function addToComposite(dataUrl) {
  const img = new Image();
  img.onload = () => {
    if (!compositeReady) {
      compositeCanvas.width  = img.naturalWidth;
      compositeCanvas.height = img.naturalHeight;
      compositeCtx.fillStyle = '#000';
      compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
      compositeReady = true;
    }
    compositeCtx.globalCompositeOperation = 'screen';
    compositeCtx.drawImage(img, 0, 0, compositeCanvas.width, compositeCanvas.height);
    const url = compositeCanvas.toDataURL('image/jpeg', 0.92);
    compositeImg.src = url;
    compositeDownload.href = url;
    compositeWrap.hidden = false;
  };
  img.src = dataUrl;
}

async function shareDataUrl(dataUrl, filename) {
  if (!navigator.share) return;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Blitzkamera', text: 'Aufgenommen mit Blitzkamera von AppReich' });
    }
  } catch(e) {}
}

function triggerFlashFeedback() {
  setStatus('Blitz erkannt!', 'triggered');

  flashOverlay.classList.remove('flash');
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add('flash');

  boltStreak.classList.remove('flash');
  void boltStreak.offsetWidth;
  boltStreak.classList.add('flash');

  setTimeout(() => {
    if (running) setStatus('Überwache...', 'active');
  }, 1000);
}

function addToGallery(dataUrl) {
  shotCount += 1;
  shotCountEl.textContent = shotCount;
  shotBadge.textContent = shotCount;
  shotBadge.hidden = false;
  emptyGallery.style.display = 'none';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Blitzfoto ' + new Date().toLocaleTimeString();
  img.addEventListener('click', () => openModal(dataUrl));
  galleryEl.prepend(img);
}

function openModal(dataUrl) {
  modalImg.src = dataUrl;
  modalDownload.href = dataUrl;
  modalDownload.download = 'blitz-' + Date.now() + '.jpg';
  modal.classList.add('open');
}

modalClose.addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});
modalShare.addEventListener('click', () => shareDataUrl(modalImg.src, 'blitz-' + Date.now() + '.jpg'));

compositeImg.addEventListener('click', () => openModal(compositeImg.src));
compositeShare.addEventListener('click', () => shareDataUrl(compositeImg.src, 'blitz-komposit.jpg'));

flipCameraBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  flipLabel.textContent = facingMode === 'environment' ? 'Frontkamera' : 'Rückkamera';
  if (running) { stopCamera(); await startCamera(); }
  closeSheets();
});

function openSheet(sheet) {
  sheet.classList.add('open');
  backdrop.classList.add('open');
}

function closeSheets() {
  settingsSheet.classList.remove('open');
  gallerySheet.classList.remove('open');
  backdrop.classList.remove('open');
}

settingsBtn.addEventListener('click', () => openSheet(settingsSheet));
galleryBtn.addEventListener('click', () => openSheet(gallerySheet));
settingsClose.addEventListener('click', closeSheets);
backdrop.addEventListener('click', closeSheets);

function loop(now) {
  if (!running) return;

  const brightness = getBrightness();
  if (baseline === null) baseline = brightness;

  const delta = brightness - baseline;
  const threshold = sensitivityToThreshold(Number(sensitivitySlider.value));

  deltaFill.style.width = Math.min(100, Math.max(0, (delta / threshold) * 100)) + '%';

  if (now - lastCaptureTime >= 1000 / CAPTURE_FPS) {
    captureFrame(now);
    lastCaptureTime = now;
  }

  if (delta > threshold && now - lastTriggerTime > COOLDOWN_MS) {
    onLightningDetected(now);
  }

  baseline += (brightness - baseline) * EMA_ALPHA;

  rafId = requestAnimationFrame(loop);
}
