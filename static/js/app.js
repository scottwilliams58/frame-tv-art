/* ── State ── */
let cropper = null;
let tvConnected = false;
let tvIp = '';
let flipX = 1, flipY = 1;
let bulkMode = false;
let bulkQueue = []; // [{file, thumbUrl, name, status}]
let colorTemp = 'natural';

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => lucide.createIcons());

/* ── DOM refs ── */
const uploadZone      = document.getElementById('uploadZone');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const bulkHint        = document.getElementById('bulkHint');
const cropWrapper     = document.getElementById('cropWrapper');
const cropImage       = document.getElementById('cropImage');
const fileInput       = document.getElementById('fileInput');
const fileInputBulk   = document.getElementById('fileInputBulk');
const browseBtn       = document.getElementById('browseBtn');
const cropControls    = document.getElementById('cropControls');
const ratioGroup      = document.getElementById('ratioGroup');
const bulkModeSwitch  = document.getElementById('bulkModeSwitch');
const bulkQueueEl     = document.getElementById('bulkQueue');
const bulkItemsEl     = document.getElementById('bulkItems');
const bulkCountEl     = document.getElementById('bulkCount');

const tvIpInput    = document.getElementById('tvIp');
const connectBtn   = document.getElementById('connectBtn');
const statusChip   = document.getElementById('statusChip');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const pairingAlert = document.getElementById('pairingAlert');

const cardUpload      = document.getElementById('cardUpload');
const uploadBtn       = document.getElementById('uploadBtn');
const uploadBulkBtn   = document.getElementById('uploadBulkBtn');
const uploadBulkLabel = document.getElementById('uploadBulkLabel');
const matteSelect     = document.getElementById('matteSelect');
const resolutionSelect= document.getElementById('resolutionSelect');
const showAfter       = document.getElementById('showAfter');
const progressWrap    = document.getElementById('progressWrap');
const progressFill    = document.getElementById('progressFill');
const progressLabel   = document.getElementById('progressLabel');
const resultSuccess   = document.getElementById('resultSuccess');
const resultSuccessText= document.getElementById('resultSuccessText');
const resultError     = document.getElementById('resultError');
const resultErrorText = document.getElementById('resultErrorText');
const cardArtworks    = document.getElementById('cardArtworks');
const artworksGrid    = document.getElementById('artworksGrid');
const refreshArtworks = document.getElementById('refreshArtworks');

// Art Mode tab
const amNotConnected  = document.getElementById('amNotConnected');
const amDisplay       = document.getElementById('amDisplay');
const amAppearance    = document.getElementById('amAppearance');
const amActions       = document.getElementById('amActions');
const artModeBadge    = document.getElementById('artModeBadge');
const artModeOn2      = document.getElementById('artModeOn2');
const artModeOff2     = document.getElementById('artModeOff2');
const shuffleSwitch   = document.getElementById('shuffleSwitch');
const displayTimer    = document.getElementById('displayTimer');
const brightnessSlider= document.getElementById('brightnessSlider');
const brightnessVal   = document.getElementById('brightnessVal');
const colorTempGroup  = document.getElementById('colorTempGroup');
const fetchSettingsBtn= document.getElementById('fetchSettings');
const saveSettingsBtn = document.getElementById('saveSettings');
const amSuccess       = document.getElementById('amSuccess');
const amSuccessText   = document.getElementById('amSuccessText');
const amError         = document.getElementById('amError');
const amErrorText     = document.getElementById('amErrorText');

/* ── Toast ── */
const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type = 'info') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + type;
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

/* ── API helper ── */
async function api(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(endpoint, opts);
  return res.json();
}

/* ── Ratio helper ── */
function getSelectedRatio() {
  const active = ratioGroup.querySelector('.btn-ratio.active');
  const r = parseFloat(active?.dataset?.ratio ?? '1.7778');
  return isNaN(r) ? 16 / 9 : r;
}

/* ════════════════════════════════════════
   BULK MODE
   ════════════════════════════════════════ */
bulkModeSwitch.addEventListener('click', () => {
  bulkMode = !bulkMode;
  bulkModeSwitch.setAttribute('aria-checked', bulkMode ? 'true' : 'false');
  applyBulkModeUI();
});

function applyBulkModeUI() {
  if (bulkMode) {
    if (cropper) { cropper.destroy(); cropper = null; }
    cropWrapper.style.display = 'none';
    cropControls.style.display = 'none';
    uploadPlaceholder.style.display = 'flex';
    uploadZone.style.cursor = 'pointer';
    bulkHint.style.display = 'block';
    bulkQueueEl.style.display = bulkQueue.length ? 'flex' : 'none';
    uploadBtn.style.display = 'none';
    if (tvConnected) uploadBulkBtn.style.display = 'flex';
  } else {
    bulkHint.style.display = 'none';
    bulkQueueEl.style.display = 'none';
    uploadBulkBtn.style.display = 'none';
    if (tvConnected) uploadBtn.style.display = 'flex';
  }
}

/* ── File input / drag-drop ── */
browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  bulkMode ? fileInputBulk.click() : fileInput.click();
});

uploadZone.addEventListener('click', () => {
  if (bulkMode && uploadPlaceholder.style.display !== 'none') fileInputBulk.click();
  else if (!bulkMode && (!cropWrapper.style.display || cropWrapper.style.display === 'none')) fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

fileInputBulk.addEventListener('change', (e) => {
  if (e.target.files.length) addToBulkQueue([...e.target.files]);
  e.target.value = '';
});

document.getElementById('addMoreBtn').addEventListener('click', () => fileInputBulk.click());

document.getElementById('clearQueueBtn').addEventListener('click', () => {
  bulkQueue = [];
  renderBulkQueue();
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (!files.length) { showToast('Please drop image files.', 'error'); return; }
  bulkMode ? addToBulkQueue(files) : loadFile(files[0]);
});

/* ── Single mode: load & crop ── */
function loadFile(file) {
  cropImage.src = URL.createObjectURL(file);
  uploadPlaceholder.style.display = 'none';
  cropWrapper.style.display = 'block';
  uploadZone.style.cursor = 'default';
  cropControls.style.display = 'flex';
  initCropper();
}

function initCropper() {
  if (cropper) { cropper.destroy(); cropper = null; }
  flipX = 1; flipY = 1;
  cropper = new Cropper(cropImage, {
    aspectRatio: getSelectedRatio(),
    viewMode: 1, dragMode: 'move', autoCropArea: 1,
    restore: false, guides: true, center: true,
    highlight: true, cropBoxMovable: true, cropBoxResizable: true,
    toggleDragModeOnDblclick: false, background: false,
  });
}

/* ── Ratio & tool buttons ── */
ratioGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-ratio');
  if (!btn) return;
  ratioGroup.querySelectorAll('.btn-ratio').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (cropper) {
    const r = parseFloat(btn.dataset.ratio);
    cropper.setAspectRatio(isNaN(r) ? NaN : r);
  }
});

document.getElementById('rotateLeft').addEventListener('click',  () => cropper && cropper.rotate(-90));
document.getElementById('rotateRight').addEventListener('click', () => cropper && cropper.rotate(90));
document.getElementById('flipH').addEventListener('click', () => {
  if (!cropper) return;
  flipX *= -1;
  cropper.scaleX(flipX);
});
document.getElementById('flipV').addEventListener('click', () => {
  if (!cropper) return;
  flipY *= -1;
  cropper.scaleY(flipY);
});
document.getElementById('resetCrop').addEventListener('click', () => {
  if (!cropper) return;
  flipX = 1; flipY = 1;
  // replace() re-renders from the original src, resetting rotation, flip, and crop box.
  // reset() alone does not restore rotation applied via rotate().
  cropper.replace(cropImage.src);
});
document.getElementById('changeImage').addEventListener('click', () => {
  if (cropper) { cropper.destroy(); cropper = null; }
  cropWrapper.style.display = 'none';
  uploadPlaceholder.style.display = 'flex';
  cropControls.style.display = 'none';
  uploadZone.style.cursor = 'pointer';
  cropImage.src = '';
  fileInput.value = '';
});

/* ════════════════════════════════════════
   BULK QUEUE
   ════════════════════════════════════════ */
async function addToBulkQueue(files) {
  const ratio = getSelectedRatio();
  for (const file of files) {
    const thumbUrl = await generateThumb(file, ratio);
    bulkQueue.push({ file, thumbUrl, name: file.name, status: 'pending' });
  }
  renderBulkQueue();
  if (bulkQueue.length) bulkQueueEl.style.display = 'flex';
  updateBulkLabel();
}

function renderBulkQueue() {
  bulkItemsEl.innerHTML = '';
  if (!bulkQueue.length) {
    bulkQueueEl.style.display = 'none';
    updateBulkLabel();
    return;
  }
  bulkQueue.forEach((item, i) => {
    const statusIcon = { pending: 'circle', uploading: 'loader', done: 'check-circle', error: 'alert-circle' }[item.status] || 'circle';
    const el = document.createElement('div');
    el.className = 'bulk-item';
    el.innerHTML = `
      <img class="bulk-thumb" src="${item.thumbUrl}" alt="" />
      <div class="bulk-item-info">
        <span class="bulk-item-name">${item.name}</span>
        <span class="bulk-item-status bulk-item-status--${item.status}">
          <i data-lucide="${statusIcon}"></i>
          ${item.status.charAt(0).toUpperCase() + item.status.slice(1)}
        </span>
      </div>
      <button class="btn-icon bulk-item-remove" data-index="${i}" title="Remove">
        <i data-lucide="x"></i>
      </button>`;
    bulkItemsEl.appendChild(el);
  });
  lucide.createIcons();
  bulkItemsEl.querySelectorAll('.bulk-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      bulkQueue.splice(parseInt(btn.dataset.index), 1);
      renderBulkQueue();
    });
  });
  updateBulkLabel();
}

function updateBulkLabel() {
  const n = bulkQueue.length;
  bulkCountEl.textContent = `${n} image${n !== 1 ? 's' : ''}`;
  uploadBulkLabel.textContent = `Upload ${n} Image${n !== 1 ? 's' : ''} to Frame TV`;
}

async function generateThumb(file, ratio) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const H = 50, W = Math.round(H * ratio);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const srcAR = img.width / img.height;
      let sx, sy, sw, sh;
      if (srcAR > ratio) { sh = img.height; sw = sh * ratio; sx = (img.width - sw) / 2; sy = 0; }
      else               { sw = img.width;  sh = sw / ratio; sx = 0; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

async function autoCropToDataURL(file, ratio, w, h) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const srcAR = img.width / img.height;
      let sx, sy, sw, sh;
      if (srcAR > ratio) { sh = img.height; sw = sh * ratio; sx = (img.width - sw) / 2; sy = 0; }
      else               { sw = img.width;  sh = sw / ratio; sx = 0; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ── Bulk upload ── */
uploadBulkBtn.addEventListener('click', uploadBulk);

async function uploadBulk() {
  if (!tvConnected) { showToast('Connect to the TV first.', 'error'); return; }
  if (!bulkQueue.length) { showToast('Add images to the queue first.', 'error'); return; }

  const matte = matteSelect.value;
  const show  = showAfter.checked;
  const [w, h] = resolutionSelect.value.split(',').map(Number);
  const ratio  = getSelectedRatio();

  uploadBulkBtn.disabled = true;
  let successCount = 0;

  for (let i = 0; i < bulkQueue.length; i++) {
    const item = bulkQueue[i];
    if (item.status === 'done') continue;
    item.status = 'uploading';
    renderBulkQueue();

    const dataURL = await autoCropToDataURL(item.file, ratio, w, h);
    if (!dataURL) { item.status = 'error'; renderBulkQueue(); continue; }

    try {
      // Only display the last successfully uploaded image if "show" is checked
      const data = await api('/api/upload', 'POST', {
        ip: tvIp, image: dataURL, matte,
        show: show && i === bulkQueue.length - 1,
      });
      item.status = data.success ? 'done' : 'error';
      if (data.success) successCount++;
    } catch { item.status = 'error'; }
    renderBulkQueue();
  }

  uploadBulkBtn.disabled = false;
  const all = bulkQueue.length;
  showToast(`${successCount} of ${all} image${all !== 1 ? 's' : ''} uploaded.`,
    successCount === all ? 'success' : 'error');
  if (successCount) loadArtworks();
}

/* ════════════════════════════════════════
   TABS
   ════════════════════════════════════════ */
document.getElementById('mainTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-trigger');
  if (!btn) return;
  document.querySelectorAll('.tab-trigger').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(p => p.style.display = 'none');
  btn.classList.add('active');
  const panel = document.getElementById('panel-' + btn.dataset.tab);
  if (panel) panel.style.display = 'flex';
  if (btn.dataset.tab === 'artmode' && !tvConnected) {
    amNotConnected.style.display = 'block';
  }
});

/* ════════════════════════════════════════
   TV CONNECTION
   ════════════════════════════════════════ */
connectBtn.addEventListener('click', connectToTV);
tvIpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectToTV(); });

async function connectToTV() {
  const ip = tvIpInput.value.trim();
  if (!ip) { showToast('Enter the TV IP address first.', 'error'); return; }
  tvIp = ip;
  setConnectingState();

  let data;
  try { data = await api('/api/connect', 'POST', { ip }); }
  catch { setErrorState('Network error — is the app server running?'); return; }

  if (!data.success) {
    const isFirst = /token|pair|connect|refused/i.test(data.error || '');
    pairingAlert.style.display = isFirst ? 'block' : 'none';
    setErrorState(isFirst ? 'Check your TV for a pairing dialog, then retry.' : (data.error || 'Connection failed'));
    return;
  }

  pairingAlert.style.display = 'none';
  setConnectedState(data);
}

function setConnectingState() {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  statusChip.style.display = 'flex';
  statusDot.className = 'status-dot connecting';
  statusText.textContent = 'Connecting…';
}

function setConnectedState(data) {
  tvConnected = true;
  connectBtn.disabled = false;
  connectBtn.textContent = 'Reconnect';
  statusDot.className = 'status-dot connected';
  statusText.textContent = `Connected${data.art_supported ? ' — Art Mode supported' : ''}`;

  if (data.art_supported) {
    cardUpload.style.display = 'block';
    cardArtworks.style.display = 'block';
    // Art Mode tab
    amNotConnected.style.display = 'none';
    amDisplay.style.display = 'block';
    amAppearance.style.display = 'block';
    amActions.style.display = 'block';
    if (data.artmode) {
      artModeBadge.textContent = data.artmode === 'on' ? 'On' : 'Off';
      artModeBadge.className = 'artmode-badge artmode-badge--' + data.artmode;
    }
    loadArtworks();
  }

  // Show correct send button based on current mode
  uploadBtn.style.display = bulkMode ? 'none' : 'flex';
  uploadBulkBtn.style.display = bulkMode ? 'flex' : 'none';

  showToast('Connected to Frame TV!', 'success');
}

function setErrorState(msg) {
  tvConnected = false;
  connectBtn.disabled = false;
  connectBtn.textContent = 'Connect';
  statusDot.className = 'status-dot disconnected';
  statusText.textContent = msg;
  showToast(msg, 'error');
}

/* ════════════════════════════════════════
   ART MODE TAB
   ════════════════════════════════════════ */

/* On / Off */
artModeOn2.addEventListener('click', () => setArtMode('on'));
artModeOff2.addEventListener('click', () => setArtMode('off'));

async function setArtMode(mode) {
  if (!tvConnected) { showToast('Connect to the TV first.', 'error'); return; }
  try {
    const data = await api('/api/artmode', 'POST', { ip: tvIp, mode });
    if (data.success) {
      artModeBadge.textContent = mode === 'on' ? 'On' : 'Off';
      artModeBadge.className = 'artmode-badge artmode-badge--' + mode;
      showToast(`Art Mode ${mode === 'on' ? 'enabled' : 'disabled'}.`, 'success');
    } else {
      showToast(data.error || 'Failed to change Art Mode.', 'error');
    }
  } catch { showToast('Request failed.', 'error'); }
}

/* Shuffle switch */
shuffleSwitch.addEventListener('click', () => {
  const on = shuffleSwitch.getAttribute('aria-checked') !== 'true';
  shuffleSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
});

/* Brightness slider */
brightnessSlider.addEventListener('input', () => {
  brightnessVal.textContent = brightnessSlider.value;
});

/* Color temperature */
colorTempGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-ratio');
  if (!btn) return;
  colorTempGroup.querySelectorAll('.btn-ratio').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  colorTemp = btn.dataset.colortemp;
});

/* Fetch settings from TV */
fetchSettingsBtn.addEventListener('click', async () => {
  if (!tvConnected) { showToast('Connect to the TV first.', 'error'); return; }
  amSuccess.style.display = 'none';
  amError.style.display = 'none';
  fetchSettingsBtn.disabled = true;
  fetchSettingsBtn.innerHTML = '<i data-lucide="loader-2"></i> Fetching…';
  lucide.createIcons();

  try {
    const data = await api(`/api/artmode/settings?ip=${encodeURIComponent(tvIp)}`);
    fetchSettingsBtn.disabled = false;
    fetchSettingsBtn.innerHTML = '<i data-lucide="download"></i> Fetch from TV';
    lucide.createIcons();

    if (!data.success) {
      amErrorText.textContent = data.error || 'Could not fetch settings.';
      amError.style.display = 'flex';
      return;
    }

    const s = data.settings || {};
    if (s.brightness !== undefined) { brightnessSlider.value = s.brightness; brightnessVal.textContent = s.brightness; }
    if (s.shuffle    !== undefined) {
      const on = s.shuffle === true || s.shuffle === 'true' || s.shuffle === 'on';
      shuffleSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (s.display_timer !== undefined) displayTimer.value = s.display_timer;
    if (s.color         !== undefined) {
      colorTempGroup.querySelectorAll('.btn-ratio').forEach(b => b.classList.remove('active'));
      const btn = colorTempGroup.querySelector(`[data-colortemp="${s.color}"]`);
      if (btn) btn.classList.add('active');
      colorTemp = s.color;
    }

    amSuccessText.textContent = 'Settings loaded from TV.';
    amSuccess.style.display = 'flex';
    setTimeout(() => amSuccess.style.display = 'none', 3000);
  } catch {
    fetchSettingsBtn.disabled = false;
    fetchSettingsBtn.innerHTML = '<i data-lucide="download"></i> Fetch from TV';
    lucide.createIcons();
    amErrorText.textContent = 'Request failed.';
    amError.style.display = 'flex';
  }
});

/* Save settings to TV */
saveSettingsBtn.addEventListener('click', async () => {
  if (!tvConnected) { showToast('Connect to the TV first.', 'error'); return; }
  amSuccess.style.display = 'none';
  amError.style.display = 'none';
  saveSettingsBtn.disabled = true;

  const settings = {
    brightness:    parseInt(brightnessSlider.value),
    shuffle:       shuffleSwitch.getAttribute('aria-checked') === 'true',
    display_timer: parseInt(displayTimer.value),
    color:         colorTemp,
  };

  try {
    const data = await api('/api/artmode/settings', 'POST', { ip: tvIp, settings });
    saveSettingsBtn.disabled = false;
    if (data.success) {
      amSuccessText.textContent = 'Settings saved to TV.';
      amSuccess.style.display = 'flex';
      showToast('Art Mode settings saved!', 'success');
      setTimeout(() => amSuccess.style.display = 'none', 3000);
    } else {
      amErrorText.textContent = data.error || 'Could not save settings.';
      amError.style.display = 'flex';
    }
  } catch {
    saveSettingsBtn.disabled = false;
    amErrorText.textContent = 'Request failed.';
    amError.style.display = 'flex';
  }
});

/* ════════════════════════════════════════
   UPLOAD (single mode)
   ════════════════════════════════════════ */
uploadBtn.addEventListener('click', uploadToTV);

async function uploadToTV() {
  if (!tvConnected) { showToast('Connect to the TV first.', 'error'); return; }
  if (!cropper)     { showToast('Load and crop an image first.', 'error'); return; }

  resultSuccess.style.display = 'none';
  resultError.style.display   = 'none';

  const [w, h] = resolutionSelect.value.split(',').map(Number);
  const matte  = matteSelect.value;
  const show   = showAfter.checked;

  showProgress(true);
  setProgress(10, 'Rendering cropped image…');
  uploadBtn.disabled = true;

  let dataURL;
  try {
    const canvas = cropper.getCroppedCanvas({ width: w, height: h, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    setProgress(30, 'Encoding JPEG…');
    dataURL = canvas.toDataURL('image/jpeg', 0.95);
  } catch (e) {
    showProgress(false); uploadBtn.disabled = false;
    showResult('error', 'Failed to render image: ' + e.message); return;
  }

  setProgress(55, 'Uploading to Frame TV… (this may take 20–40 s)');
  let data;
  try {
    data = await api('/api/upload', 'POST', { ip: tvIp, image: dataURL, matte, show });
  } catch (e) {
    showProgress(false); uploadBtn.disabled = false;
    showResult('error', 'Network error: ' + e.message); return;
  }

  setProgress(100, 'Done!');
  uploadBtn.disabled = false;

  if (data.success) {
    showResult('success', `Uploaded!${data.content_id ? ' ID: ' + data.content_id : ''}${show ? ' Displaying on TV.' : ''}`);
    showToast('Artwork sent to Frame TV!', 'success');
    setTimeout(() => showProgress(false), 1200);
    loadArtworks();
  } else {
    showResult('error', data.error || 'Upload failed.');
    showToast('Upload failed.', 'error');
    setTimeout(() => showProgress(false), 800);
  }
}

function showProgress(v) { progressWrap.style.display = v ? 'block' : 'none'; }
function setProgress(pct, label) { progressFill.style.width = pct + '%'; progressLabel.textContent = label; }
function showResult(type, msg) {
  resultSuccess.style.display = 'none';
  resultError.style.display   = 'none';
  if (type === 'success') { resultSuccessText.textContent = msg; resultSuccess.style.display = 'flex'; }
  else                    { resultErrorText.textContent   = msg; resultError.style.display   = 'flex'; }
}

/* ════════════════════════════════════════
   MY ARTWORKS
   ════════════════════════════════════════ */
refreshArtworks.addEventListener('click', loadArtworks);

async function loadArtworks() {
  if (!tvConnected) return;
  artworksGrid.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const data = await api(`/api/artworks?ip=${encodeURIComponent(tvIp)}`);
    if (!data.success) { artworksGrid.innerHTML = `<span class="muted">${data.error}</span>`; return; }
    const list = data.artworks || [];
    if (!list.length) { artworksGrid.innerHTML = '<span class="muted">No uploaded artworks found.</span>'; return; }
    artworksGrid.innerHTML = '';
    list.forEach(item => {
      const id = item.content_id || item.id || '';
      const div = document.createElement('div');
      div.className = 'artwork-item';
      div.title = `ID: ${id}\nClick to display on TV`;
      div.innerHTML = `
        <div class="artwork-thumb"><i data-lucide="image" style="width:18px;height:18px;opacity:.4"></i></div>
        <span>${id.slice(-8) || 'art'}</span>`;
      div.addEventListener('click', () => selectArtwork(id));
      artworksGrid.appendChild(div);
    });
    lucide.createIcons();
  } catch { artworksGrid.innerHTML = '<span class="muted">Failed to load.</span>'; }
}

async function selectArtwork(contentId) {
  if (!tvConnected) return;
  try {
    const data = await api('/api/select', 'POST', { ip: tvIp, content_id: contentId });
    showToast(data.success ? 'Displaying artwork on TV.' : (data.error || 'Could not select artwork.'),
              data.success ? 'success' : 'error');
  } catch { showToast('Request failed.', 'error'); }
}
