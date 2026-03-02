/* ── State ── */
let cropper = null;
let tvConnected = false;
let tvIp = '';
let flipX = 1, flipY = 1;
let _cropObjectUrl = null;   // Bug #7: track so we can revoke on image change
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
const amMotion        = document.getElementById('amMotion');
const amActions       = document.getElementById('amActions');
const artModeBadge    = document.getElementById('artModeBadge');
const artModeOn2      = document.getElementById('artModeOn2');
const artModeOff2     = document.getElementById('artModeOff2');
const shuffleSwitch   = document.getElementById('shuffleSwitch');
const displayTimer    = document.getElementById('displayTimer');
const brightnessSlider= document.getElementById('brightnessSlider');
const brightnessVal   = document.getElementById('brightnessVal');
const brightnessSnsr  = document.getElementById('brightnessSensorSwitch');
const colorTempGroup  = document.getElementById('colorTempGroup');
const motionTimer     = document.getElementById('motionTimer');
const motionSensGroup = document.getElementById('motionSensGroup');
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
// Bug #4 fix: previously always sent Content-Type on GET requests, and called
// res.json() unconditionally — which throws on Flask's HTML error pages (413,
// 500).  Now: Content-Type only when sending a body; throw a readable error
// when the response isn't JSON so callers show something meaningful.
// Bug #16 fix: don't send Content-Type header on GET requests (no body).
async function api(endpoint, method = 'GET', body = null) {
  const opts = { method };
  if (body !== null) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, opts);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Server error (HTTP ${res.status})`);
  }
  return res.json();
}

/* ── Matte helpers (dynamic list from TV) ── */
function formatMatteName(id) {
  // e.g. "modern_white_01" → "Modern White"
  return id
    .replace(/_\d+$/, '')          // strip trailing _01, _02, …
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function loadMattes() {
  if (!tvIp) return;
  try {
    const data = await api(`/api/mattes?ip=${encodeURIComponent(tvIp)}`);
    if (!data.success || !Array.isArray(data.mattes) || !data.mattes.length) return;

    // Flatten: the TV may return [{matte_type, color:[...]}] or a flat list
    const options = [{ value: 'none', label: 'None (full bleed)' }];
    data.mattes.forEach(m => {
      if (typeof m === 'string') {
        options.push({ value: m, label: formatMatteName(m) });
      } else if (m && typeof m === 'object') {
        const type = m.matte_type || m.type || m.id || '';
        const colors = Array.isArray(m.color) ? m.color : [];
        if (colors.length) {
          colors.forEach(c => {
            const val = `${type}_${c}`;
            options.push({ value: val, label: `${formatMatteName(type)} — ${formatMatteName(c)}` });
          });
        } else if (type) {
          options.push({ value: type, label: formatMatteName(type) });
        }
      }
    });

    const prev = matteSelect.value;
    matteSelect.innerHTML = '';
    options.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      matteSelect.appendChild(opt);
    });
    // Restore previous selection if still valid
    if ([...matteSelect.options].some(o => o.value === prev)) matteSelect.value = prev;
  } catch {
    // Non-fatal — keep existing options
  }
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
  // Bug #7 fix: revoke the previous object URL before creating a new one to
  // avoid a URL leak on each image load.
  if (_cropObjectUrl) { URL.revokeObjectURL(_cropObjectUrl); }
  _cropObjectUrl = URL.createObjectURL(file);
  cropImage.src = _cropObjectUrl;
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
  // Bug #7 fix: revoke the object URL when the user navigates away from the image.
  if (_cropObjectUrl) { URL.revokeObjectURL(_cropObjectUrl); _cropObjectUrl = null; }
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
  // Bug #2 fix: was using el.innerHTML with item.name (a filesystem filename)
  // and item.thumbUrl unsanitised, enabling XSS via a crafted filename.
  // Now built entirely with DOM methods — textContent for all user-sourced strings.
  bulkQueue.forEach((item, i) => {
    const statusIcon = { pending: 'circle', uploading: 'loader', done: 'check-circle', error: 'alert-circle' }[item.status] || 'circle';

    const el = document.createElement('div');
    el.className = 'bulk-item';

    // Thumbnail (src is a data: URL we generated — safe to set via attribute)
    const img = document.createElement('img');
    img.className = 'bulk-thumb';
    img.src = item.thumbUrl;
    img.alt = '';

    // Name + status info
    const info = document.createElement('div');
    info.className = 'bulk-item-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'bulk-item-name';
    nameSpan.textContent = item.name;   // textContent — safe for any filename

    const statusSpan = document.createElement('span');
    statusSpan.className = `bulk-item-status bulk-item-status--${item.status}`;
    const statusIconEl = document.createElement('i');
    statusIconEl.setAttribute('data-lucide', statusIcon);
    const statusLabel = document.createElement('span');
    statusLabel.textContent = item.status.charAt(0).toUpperCase() + item.status.slice(1);
    statusSpan.appendChild(statusIconEl);
    statusSpan.appendChild(statusLabel);

    info.appendChild(nameSpan);
    info.appendChild(statusSpan);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon bulk-item-remove';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${item.name}`);
    const removeIcon = document.createElement('i');
    removeIcon.setAttribute('data-lucide', 'x');
    removeBtn.appendChild(removeIcon);
    removeBtn.addEventListener('click', () => {
      bulkQueue.splice(i, 1);
      renderBulkQueue();
    });

    el.appendChild(img);
    el.appendChild(info);
    el.appendChild(removeBtn);
    bulkItemsEl.appendChild(el);
  });
  lucide.createIcons();
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

  // Bug #9 fix: previously compared loop index to bulkQueue.length - 1, which
  // broke in two ways: (a) if the last item was already 'done' it was skipped
  // so show was never true for any upload; (b) if the last item failed, nothing
  // was displayed even though earlier items succeeded.
  // Fix: compute the index of the last *pending* item before the loop starts.
  const lastPendingIdx = bulkQueue.reduce(
    (last, item, i) => item.status !== 'done' ? i : last, -1);

  for (let i = 0; i < bulkQueue.length; i++) {
    const item = bulkQueue[i];
    if (item.status === 'done') continue;
    item.status = 'uploading';
    renderBulkQueue();

    const dataURL = await autoCropToDataURL(item.file, ratio, w, h);
    if (!dataURL) { item.status = 'error'; renderBulkQueue(); continue; }

    try {
      // Only display on TV for the last pending item (not the last index of the
      // full queue, which may have already-done items after it).
      const data = await api('/api/upload', 'POST', {
        ip: tvIp, image: dataURL, matte,
        show: show && i === lastPendingIdx,
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
  // Bug #15 fix: sync aria-selected so screen readers announce which tab is active.
  document.querySelectorAll('.tab-trigger').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach(p => p.style.display = 'none');
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
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
  // Bug #13 fix: don't update tvIp until the connection succeeds — a failed
  // reconnect attempt was leaving tvIp pointing at the new (unreachable) IP.
  setConnectingState();

  let data;
  try { data = await api('/api/connect', 'POST', { ip }); }
  catch (err) { setErrorState('Network error — is the app server running?'); return; }

  if (!data.success) {
    // Bug #8 fix: server now returns data.pairing = true for auth/pairing failures
    // instead of relying on client-side regex that matched "connect" in generic errors.
    pairingAlert.style.display = data.pairing ? 'block' : 'none';
    setErrorState(data.pairing
      ? 'Check your TV for a pairing dialog, then retry.'
      : (data.error || 'Connection failed'));
    return;
  }

  pairingAlert.style.display = 'none';
  setConnectedState(data, ip);
}

function setConnectingState() {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  statusChip.style.display = 'flex';
  statusDot.className = 'status-dot connecting';
  statusText.textContent = 'Connecting…';
}

function setConnectedState(data, ip) {
  tvIp = ip;   // Bug #13 fix: only set tvIp on confirmed success
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
    amMotion.style.display = 'block';
    amActions.style.display = 'block';
    if (data.artmode) {
      artModeBadge.textContent = data.artmode === 'on' ? 'On' : 'Off';
      artModeBadge.className = 'artmode-badge artmode-badge--' + data.artmode;
    }
    loadArtworks();
    loadMattes();
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
  // Bug #14 fix: hide TV-dependent UI so the user knows they need to reconnect.
  // Previously these cards stayed visible after a failed reconnect attempt.
  cardUpload.style.display    = 'none';
  cardArtworks.style.display  = 'none';
  uploadBtn.style.display     = 'none';
  uploadBulkBtn.style.display = 'none';
  amNotConnected.style.display = 'block';
  amDisplay.style.display     = 'none';
  amAppearance.style.display  = 'none';
  amMotion.style.display      = 'none';
  amActions.style.display     = 'none';
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

/* Auto brightness sensor switch */
brightnessSnsr.addEventListener('click', () => {
  const on = brightnessSnsr.getAttribute('aria-checked') !== 'true';
  brightnessSnsr.setAttribute('aria-checked', on ? 'true' : 'false');
});

/* Motion sensitivity */
motionSensGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-ratio');
  if (!btn) return;
  motionSensGroup.querySelectorAll('.btn-ratio').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
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
    if (s.motion_timer !== undefined) {
      motionTimer.value = s.motion_timer;
    }
    if (s.motion_sensitivity !== undefined) {
      motionSensGroup.querySelectorAll('.btn-ratio').forEach(b => b.classList.remove('active'));
      const sensBtn = motionSensGroup.querySelector(`[data-sens="${s.motion_sensitivity}"]`);
      if (sensBtn) sensBtn.classList.add('active');
    }
    if (s.brightness_sensor !== undefined) {
      const on = s.brightness_sensor === true || s.brightness_sensor === 'true' || s.brightness_sensor === 'on';
      brightnessSnsr.setAttribute('aria-checked', on ? 'true' : 'false');
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
    brightness:         parseInt(brightnessSlider.value),
    shuffle:            shuffleSwitch.getAttribute('aria-checked') === 'true',
    display_timer:      parseInt(displayTimer.value),
    color:              colorTemp,
    motion_timer:       motionTimer.value,
    motion_sensitivity: motionSensGroup.querySelector('.btn-ratio.active')?.dataset?.sens ?? '2',
    brightness_sensor:  brightnessSnsr.getAttribute('aria-checked') === 'true',
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
    if (!data.success) {
      // Bug #3 fix: was injecting data.error into innerHTML — use textContent.
      const errSpan = document.createElement('span');
      errSpan.className = 'muted';
      errSpan.textContent = data.error || 'Error loading artworks.';
      artworksGrid.innerHTML = '';
      artworksGrid.appendChild(errSpan);
      return;
    }
    const list = data.artworks || [];
    if (!list.length) { artworksGrid.innerHTML = '<span class="muted">No uploaded artworks found.</span>'; return; }
    artworksGrid.innerHTML = '';
    list.forEach(item => {
      const id = item.content_id || item.id || '';
      const div = document.createElement('div');
      div.className = 'artwork-item';
      // Use textContent / setAttribute — never innerHTML — with TV-sourced data
      div.setAttribute('title', `ID: ${id}\nClick to display on TV`);

      const thumb = document.createElement('div');
      thumb.className = 'artwork-thumb';
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'image');
      icon.style.cssText = 'width:18px;height:18px;opacity:.4';
      thumb.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = id.slice(-8) || 'art';

      div.appendChild(thumb);
      div.appendChild(label);
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
