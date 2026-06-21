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
const modalClose = document.getElementById('modalClose');

const SAMPLE_W = 64;
const SAMPLE_H = 36;
const CAPTURE_W = 960;
const CAPTURE_H = 540;
const BUFFER_MS = 2000;
const CAPTURE_FPS = 20;
const COOLDOWN_MS = 1200;
const EMA_ALPHA = 0.05;

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = SAMPLE_W;
sampleCanvas.height = SAMPLE_H;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

const captureCanvas = document.createElement('canvas');
captureCanvas.width = CAPTURE_W;
captureCanvas.height = CAPTURE_H;
const captureCtx = captureCanvas.getContext('2d');

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
});

preTriggerSlider.addEventListener('input', () => {
  preTriggerValue.textContent = preTriggerSlider.value + ' ms';
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
        facingMode: 'environment',
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
  captureCtx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
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
  triggerFlashFeedback();
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
