// ── DOM REFERENCES ──────────────────────────────────────────────────────────

const audio       = document.getElementById('audio');
const fileInput   = document.getElementById('fileInput');
const fileZone    = document.getElementById('fileZone');
const playBtn     = document.getElementById('playBtn');
const playIcon    = document.getElementById('playIcon');
const skipBackBtn = document.getElementById('skipBackBtn');
const skipFwdBtn  = document.getElementById('skipFwdBtn');
const volSlider   = document.getElementById('volSlider');
const volVal      = document.getElementById('volVal');
const volSvg      = document.getElementById('volSvg');
const muteIcon    = document.getElementById('muteIcon');
const muteBtn     = document.getElementById('muteBtn');
const muteBtnIcon = document.getElementById('muteBtnIcon');
const loopBtn     = document.getElementById('loopBtn');
const seekWrap    = document.getElementById('seekWrap');
const seekFill    = document.getElementById('seekFill');
const seekThumb   = document.getElementById('seekThumb');
const seekRow     = document.getElementById('seekRow');
const currentTimeEl = document.getElementById('currentTime');
const durationEl  = document.getElementById('duration');
const trackInfo   = document.getElementById('trackInfo');
const trackName   = document.getElementById('trackName');
const trackMeta   = document.getElementById('trackMeta');
const vizWrap     = document.getElementById('vizWrap');
const statusMsg   = document.getElementById('statusMsg');
const removeBtn   = document.getElementById('removeBtn');

// ── STATE ────────────────────────────────────────────────────────────────────

let isMuted    = false;
let prevVol    = 0.8;    // remembers the volume before mute so we can restore it
let animFrameId = null;  // handle for cancelAnimationFrame
let fileLoaded = false;

// Web Audio API nodes — initialised lazily on first play
let audioCtx = null;
let analyser  = null;
let source    = null;

// Filled with frequency data on every animation frame (Web Audio API)
let dataArray = null;

// References to the 40 visualiser bar elements
let vizBars = [];

// ── SVG ICON PATHS ───────────────────────────────────────────────────────────

// These d= paths are swapped in and out to change button icons without replacing elements
const PLAY_PATH    = 'M8 5v14l11-7z';
const PAUSE_PATH   = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const VOL_ON_PATH  = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM18.5 12c0 2.93-1.67 5.47-4.1 6.77l1.43 1.43C18.94 18.68 21 15.55 21 12s-2.06-6.68-5.17-8.2l-1.43 1.43C16.83 6.53 18.5 9.07 18.5 12z';
const VOL_OFF_PATH = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';

// ── HELPERS ──────────────────────────────────────────────────────────────────

// Converts a raw number of seconds into a m:ss display string
function fmtTime(s) {
  if (isNaN(s) || s < 0) return '0:00';
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Updates the status bar at the bottom of the card
// type can be 'ok' (green) or 'err' (red) — empty string resets colour
function setStatus(msg, type = '') {
  statusMsg.textContent = msg;
  statusMsg.className   = type;
}

// Swaps the play button's SVG path to match the current playback state
function setPlayIcon(isPlaying) {
  playIcon.setAttribute('d', isPlaying ? PAUSE_PATH : PLAY_PATH);
}

// ── WEB AUDIO API — VISUALISER SETUP ────────────────────────────────────────

// Builds 40 <div> elements inside the visualiser container.
// Their heights are driven by the AnalyserNode in drawViz().
function setupViz() {
  vizWrap.innerHTML = '';
  vizBars = [];
  for (let i = 0; i < 40; i++) {
    const bar = document.createElement('div');
    bar.className = 'viz-bar';
    vizWrap.appendChild(bar);
    vizBars.push(bar);
  }
}

// WEB AUDIO API — creates the audio processing graph.
// Called once on first play so the browser's autoplay policy is satisfied
// (AudioContext must be created inside a user gesture).
//
//  <audio> element
//       │
//  MediaElementSourceNode   ← bridges the HTML element into the Web Audio graph
//       │
//  AnalyserNode             ← reads frequency data without modifying the signal
//       │
//  AudioContext.destination ← the speakers
function initAudioContext() {
  if (audioCtx) return; // only initialise once

  // WEB AUDIO API — AudioContext is the engine that drives all audio processing
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // WEB AUDIO API — AnalyserNode performs a Fast Fourier Transform on the audio signal.
  // fftSize determines frequency resolution; frequencyBinCount = fftSize / 2 = 64 buckets
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  // WEB AUDIO API — wraps the existing <audio> element as a node in the graph
  source = audioCtx.createMediaElementSource(audio);

  // WEB AUDIO API — connect the graph: source → analyser → speakers
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// WEB AUDIO API — reads live frequency data and maps it to the visualiser bars.
// Runs on every animation frame while audio is playing.
function drawViz() {
  if (!analyser) return;
  animFrameId = requestAnimationFrame(drawViz);

  // WEB AUDIO API — fills dataArray with amplitude values (0–255) for each frequency bucket
  analyser.getByteFrequencyData(dataArray);

  const step = Math.floor(dataArray.length / vizBars.length);
  for (let i = 0; i < vizBars.length; i++) {
    const val = dataArray[i * step] || 0;
    const pct = Math.max(6, (val / 255) * 100); // minimum 6% so bars are always visible
    vizBars[i].style.height = pct + '%';
    vizBars[i].classList.toggle('active', val > 60); // accent colour above amplitude threshold
  }
}

// ── FILE LOADING ─────────────────────────────────────────────────────────────

function loadFile(file) {
  if (!file || !file.type.startsWith('audio/')) {
    setStatus('Invalid file — please choose an audio file', 'err');
    return;
  }

  // Create a temporary object URL so the <audio> element can read the local file
  const url = URL.createObjectURL(file);
  audio.src = url;
  audio.load();

  // Strip the file extension for display
  trackName.textContent = file.name.replace(/\.[^.]+$/, '');
  trackMeta.textContent = 'LOADING...';

  // Reveal the track info, visualiser, and seek bar; hide the drop zone
  trackInfo.classList.add('visible');
  vizWrap.classList.add('visible');
  seekRow.classList.add('visible');
  fileZone.style.display = 'none';
  setupViz();

  // Once the browser has read the audio metadata (duration, format etc.), unlock controls
  audio.onloadedmetadata = () => {
    durationEl.textContent = fmtTime(audio.duration);
    const kb = (file.size / 1024).toFixed(0);
    trackMeta.textContent = `${fmtTime(audio.duration)}  ·  ${file.type.split('/')[1].toUpperCase()}  ·  ${kb} KB`;
    playBtn.disabled    = false;
    skipBackBtn.disabled = false;
    skipFwdBtn.disabled  = false;
    fileLoaded = true;
    setStatus('File loaded — press Space or click Play', 'ok');
  };

  audio.onerror = () => setStatus('Could not load audio file', 'err');
}

// Load via the file picker
fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

// Load via drag and drop
fileZone.addEventListener('dragover',  e => { e.preventDefault(); fileZone.classList.add('drag-over'); });
fileZone.addEventListener('dragleave', () => fileZone.classList.remove('drag-over'));
fileZone.addEventListener('drop', e => {
  e.preventDefault();
  fileZone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

// ── REMOVE AUDIO ─────────────────────────────────────────────────────────────

// Resets the entire player back to its initial empty state
function removeAudio() {
  audio.pause();
  audio.src = '';
  cancelAnimationFrame(animFrameId);

  fileLoaded = false;
  fileZone.style.display = '';
  trackInfo.classList.remove('visible');
  vizWrap.classList.remove('visible');
  seekRow.classList.remove('visible');

  seekFill.style.width   = '0%';
  seekThumb.style.left   = '0%';
  currentTimeEl.textContent = '0:00';
  durationEl.textContent    = '0:00';

  playBtn.disabled     = true;
  skipBackBtn.disabled = true;
  skipFwdBtn.disabled  = true;
  setPlayIcon(false);

  // Reset the file input so the same file can be re-added if needed
  fileInput.value = '';
  vizBars = [];
  vizWrap.innerHTML = '';
  setStatus('— No file loaded —');
}

removeBtn.addEventListener('click', removeAudio);

// ── PLAY / PAUSE ─────────────────────────────────────────────────────────────

function togglePlay() {
  if (!fileLoaded) return;

  // If the AudioContext was suspended (browser autoplay policy), resume it
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  if (audio.paused) {
    initAudioContext(); // set up the Web Audio graph on first play
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audio.play();
    setPlayIcon(true);
    drawViz(); // start the visualiser animation loop
    setStatus('Playing');
  } else {
    audio.pause();
    setPlayIcon(false);
    cancelAnimationFrame(animFrameId); // stop the visualiser loop
    setStatus('Paused');
  }
}

playBtn.addEventListener('click', togglePlay);

// Keep the icon in sync with the audio element's actual state
// (covers cases like the track ending naturally or being paused externally)
audio.addEventListener('play',  () => setPlayIcon(true));
audio.addEventListener('pause', () => setPlayIcon(false));

audio.addEventListener('ended', () => {
  setPlayIcon(false);
  cancelAnimationFrame(animFrameId);
  if (!audio.loop) setStatus('Playback ended');
});

// ── SKIP FORWARD / BACKWARD ───────────────────────────────────────────────────

skipBackBtn.addEventListener('click', () => {
  audio.currentTime = Math.max(0, audio.currentTime - 10);
  setStatus('−10 seconds');
});

skipFwdBtn.addEventListener('click', () => {
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
  setStatus('+10 seconds');
});

// ── SEEK BAR ─────────────────────────────────────────────────────────────────

// Click anywhere on the track to jump to that position
seekWrap.addEventListener('click', e => {
  if (!fileLoaded) return;
  const rect = seekWrap.getBoundingClientRect();
  const pct  = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

// Click-and-drag scrubbing
let dragging = false;
seekWrap.addEventListener('mousedown', () => { if (fileLoaded) dragging = true; });
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const rect = seekWrap.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
});
document.addEventListener('mouseup', () => { dragging = false; });

// Update the seek bar fill and elapsed time as the audio plays
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  seekFill.style.width   = pct + '%';
  seekThumb.style.left   = pct + '%';
  currentTimeEl.textContent = fmtTime(audio.currentTime);
});

// ── VOLUME ───────────────────────────────────────────────────────────────────

audio.volume = 0.8; // default volume on page load

volSlider.addEventListener('input', () => {
  const v      = volSlider.value / 100;
  audio.volume = v;
  volVal.textContent = volSlider.value + '%';
  isMuted = v === 0;
  updateVolIcon();
  if (!isMuted) prevVol = v; // save last non-zero volume for mute restore
});

// Switches the speaker icon between the "on" and "off" SVG paths
function updateVolIcon() {
  const path = (isMuted || audio.volume === 0) ? VOL_OFF_PATH : VOL_ON_PATH;
  volSvg.querySelector('path').setAttribute('d', path);
  muteBtnIcon.setAttribute('d', path);
  muteBtn.classList.toggle('active', isMuted);
}

// ── MUTE / UNMUTE ─────────────────────────────────────────────────────────────

function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    prevVol = audio.volume;   // store volume before silencing
    audio.volume = 0;
    volSlider.value    = 0;
    volVal.textContent = '0%';
  } else {
    audio.volume = prevVol;   // restore the saved volume
    volSlider.value    = Math.round(prevVol * 100);
    volVal.textContent = Math.round(prevVol * 100) + '%';
  }
  updateVolIcon();
  setStatus(isMuted ? 'Muted' : 'Unmuted');
}

muteIcon.addEventListener('click', toggleMute);
muteBtn.addEventListener('click',  toggleMute);

// ── LOOP ─────────────────────────────────────────────────────────────────────

loopBtn.addEventListener('click', () => {
  audio.loop = !audio.loop;
  loopBtn.classList.toggle('active', audio.loop);
  setStatus(audio.loop ? 'Loop enabled' : 'Loop disabled');
});

// ── PLAYBACK SPEED ────────────────────────────────────────────────────────────

document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sp = parseFloat(btn.dataset.speed);
    audio.playbackRate = sp; // 1.0 is normal speed; 0.5 is half, 2.0 is double
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setStatus(`Playback speed: ${sp}×`);
  });
});

// ── KEYBOARD CONTROLS ─────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Don't intercept keys when the user is typing in a form field
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

  switch (e.key) {
    case ' ':
      e.preventDefault(); // prevent the page from scrolling on spacebar
      if (fileLoaded) togglePlay();
      break;
    case 'j': case 'J':
      if (fileLoaded) { audio.currentTime = Math.max(0, audio.currentTime - 10); setStatus('−10 seconds'); }
      break;
    case 'l': case 'L':
      if (fileLoaded) { audio.currentTime = Math.min(audio.duration, audio.currentTime + 10); setStatus('+10 seconds'); }
      break;
    case 'm': case 'M':
      if (fileLoaded) toggleMute();
      break;
    case 'r': case 'R':
      if (fileLoaded) loopBtn.click();
      break;
    case 'ArrowUp':
      e.preventDefault();
      volSlider.value = Math.min(100, parseInt(volSlider.value) + 5);
      volSlider.dispatchEvent(new Event('input'));
      break;
    case 'ArrowDown':
      e.preventDefault();
      volSlider.value = Math.max(0, parseInt(volSlider.value) - 5);
      volSlider.dispatchEvent(new Event('input'));
      break;
  }
});