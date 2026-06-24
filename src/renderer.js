// ─── State ────────────────────────────────────────────────────────────────────
let radios         = [];
let editingRadioId = null;
let deletingRadioId = null;
const discovered   = {};   // ip -> fields

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const radioList       = document.getElementById('radioList');
const emptyState      = document.getElementById('emptyState');
const broadcastStatus = document.getElementById('broadcastStatus');
const lastBroadcast   = document.getElementById('lastBroadcast');
const discoveredList  = document.getElementById('discoveredList');
const discoveredEmpty = document.getElementById('discoveredEmpty');
const discoveredBadge = document.getElementById('discoveredBadge');

const radioModal    = document.getElementById('radioModal');
const settingsModal = document.getElementById('settingsModal');
const deleteModal   = document.getElementById('deleteModal');
const radioForm     = document.getElementById('radioForm');
const settingsForm  = document.getElementById('settingsForm');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadRadios();
  await loadConfig();
  setupEventListeners();
  setupBroadcastListener();
  setupDiscoveryListener();
  // Fetch any radios already discovered before the window opened
  try {
    const existing = await window.smartunlink.getDiscovered();
    existing.forEach(f => handleDiscovered(f));
  } catch (_) {}
}

// ─── Configured radios ────────────────────────────────────────────────────────
async function loadRadios() {
  try {
    radios = await window.smartunlink.getRadios();
    renderRadios();
    updateBroadcastStatus();
  } catch (err) {
    console.error('Error loading radios:', err);
  }
}

async function loadConfig() {
  try {
    const config = await window.smartunlink.getConfig();
    document.getElementById('broadcastInterval').value = config.broadcastIntervalMs || 3000;
    const configPath = await window.smartunlink.getConfigPath();
    document.getElementById('configPath').textContent = configPath;
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function renderRadios() {
  if (radios.length === 0) {
    radioList.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }
  emptyState.classList.remove('visible');
  radioList.innerHTML = radios.map(r => createRadioCard(r)).join('');

  radios.forEach(radio => {
    const card = document.querySelector(`[data-radio-id="${radio.id}"]`);
    if (!card) return;
    card.querySelector('.toggle input').addEventListener('change', e => toggleRadio(radio.id, e.target.checked));
    card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(radio));
    card.querySelector('.delete-btn').addEventListener('click', () => openDeleteModal(radio));
  });
}

function createRadioCard(radio) {
  const cls  = radio.enabled ? 'broadcasting' : 'idle';
  const text = radio.enabled ? 'Broadcasting'  : 'Idle';
  return `
    <div class="radio-card" data-radio-id="${radio.id}">
      <div class="radio-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M6 8h.01M10 8h.01M6 12h12M6 16h8"/>
        </svg>
      </div>
      <div class="radio-card-info">
        <div class="radio-card-header">
          <span class="radio-card-name">${escapeHtml(radio.name)}</span>
          <span class="radio-card-model">${escapeHtml(radio.model)}</span>
        </div>
        <div class="radio-card-details">
          <span class="radio-card-detail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            ${escapeHtml(radio.ipAddress)}
          </span>
          ${radio.version ? `<span class="radio-card-detail">v${escapeHtml(radio.version)}</span>` : ''}
          ${radio.callsign ? `<span class="radio-card-detail">${escapeHtml(radio.callsign)}</span>` : ''}
        </div>
      </div>
      <div class="radio-card-status">
        <div class="status-indicator ${cls}"><span class="dot"></span>${text}</div>
      </div>
      <div class="radio-card-actions">
        <button class="btn btn-icon edit-btn" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn btn-icon delete-btn" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        <label class="toggle">
          <input type="checkbox" ${radio.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`;
}

async function toggleRadio(radioId, enabled) {
  try {
    await window.smartunlink.setRadioEnabled(radioId, enabled);
    const r = radios.find(r => r.id === radioId);
    if (r) { r.enabled = enabled; renderRadios(); updateBroadcastStatus(); }
  } catch (err) { console.error('Error toggling radio:', err); }
}

function updateBroadcastStatus() {
  const n = radios.filter(r => r.enabled).length;
  const t = broadcastStatus.querySelector('.status-text');
  if (n > 0) { broadcastStatus.classList.add('active'); t.textContent = `Broadcasting (${n})`; }
  else        { broadcastStatus.classList.remove('active'); t.textContent = 'Idle'; }
}

// ─── LAN Discovery panel ──────────────────────────────────────────────────────
function handleDiscovered(fields) {
  const key = fields.ip;
  if (!key) return;
  discovered[key] = fields;
  renderDiscovered();
}

function renderDiscovered() {
  const entries = Object.values(discovered);
  const count   = entries.length;
  discoveredBadge.textContent = count === 0 ? 'Listening…' : `${count} radio${count === 1 ? '' : 's'} found`;

  if (count === 0) {
    discoveredEmpty.style.display = '';
    // Remove any existing cards
    discoveredList.querySelectorAll('.discovered-card').forEach(el => el.remove());
    return;
  }

  discoveredEmpty.style.display = 'none';

  entries.forEach(f => {
    const id  = `disc-${f.ip.replace(/\./g, '-')}`;
    const alreadyConfigured = radios.some(r => r.ipAddress === f.ip);

    // Show serial (truncated) and license fields so the operator can verify
    const serialShort = f.serial && f.serial !== '0000-0000-0000-0000'
      ? f.serial : null;
    const licenseId = f.radio_license_id && f.radio_license_id !== '00-00-00-00-00-00'
      ? f.radio_license_id : null;

    const html = `
      <div class="discovered-card" id="${id}">
        <div class="disc-info">
          <span class="disc-model">${escapeHtml(f.model || 'Unknown')}</span>
          <span class="disc-detail">${escapeHtml(f.ip)}</span>
          ${f.nickname  ? `<span class="disc-detail">${escapeHtml(f.nickname)}</span>`               : ''}
          ${f.version   ? `<span class="disc-detail">v${escapeHtml(f.version)}</span>`               : ''}
          ${f.callsign  ? `<span class="disc-detail">${escapeHtml(f.callsign)}</span>`               : ''}
          ${serialShort ? `<span class="disc-detail disc-dim">S/N: ${escapeHtml(serialShort)}</span>`: ''}
          ${f.max_licensed_version ? `<span class="disc-detail disc-dim">Lic: ${escapeHtml(f.max_licensed_version)}</span>` : ''}
          ${licenseId   ? `<span class="disc-detail disc-dim">ID: ${escapeHtml(licenseId)}</span>`   : ''}
        </div>
        <button class="btn btn-secondary btn-sm add-disc-btn"
                data-ip="${escapeHtml(f.ip)}"
                data-model="${escapeHtml(f.model || '')}"
                data-version="${escapeHtml(f.version || '')}"
                data-nickname="${escapeHtml(f.nickname || '')}"
                data-callsign="${escapeHtml(f.callsign || '')}"
                data-serial="${escapeHtml(f.serial || '')}"
                data-max-licensed-version="${escapeHtml(f.max_licensed_version || '')}"
                data-radio-license-id="${escapeHtml(f.radio_license_id || '')}"
                ${alreadyConfigured ? 'disabled title="Already in your config"' : ''}>
          ${alreadyConfigured ? '✓ In Config' : '+ Add to Config'}
        </button>
      </div>`;

    const existing = document.getElementById(id);
    if (existing) {
      existing.outerHTML = html;
    } else {
      discoveredEmpty.insertAdjacentHTML('beforebegin', html);
    }

    // Wire up button — pass ALL discovered fields into the modal
    document.getElementById(id)?.querySelector('.add-disc-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      openAddModalPrefilled({
        ipAddress:          btn.dataset.ip,
        model:              btn.dataset.model,
        version:            btn.dataset.version,
        name:               btn.dataset.nickname || btn.dataset.model,
        callsign:           btn.dataset.callsign,
        serialNumber:       btn.dataset.serial,
        maxLicensedVersion: btn.dataset.maxLicensedVersion,
        radioLicenseId:     btn.dataset.radioLicenseId
      });
    });
  });
}

function setupDiscoveryListener() {
  window.smartunlink.onRadioDiscovered(handleDiscovered);
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function resetVersionHelp(msg) {
  const el = document.getElementById('versionHelp');
  el.textContent = msg;
  el.className   = 'form-help';
}

function openAddModal() {
  editingRadioId = null;
  document.getElementById('modalTitle').textContent    = 'Add Radio';
  document.getElementById('saveRadioBtn').textContent  = 'Save Radio';
  radioForm.reset();
  radioForm.dataset.serialNumber       = '';
  radioForm.dataset.maxLicensedVersion = '';
  radioForm.dataset.radioLicenseId     = '';
  document.getElementById('radioVersion').value = '';
  resetVersionHelp('Enter the IP above, then click "Fetch from Radio" to auto-detect.');
  radioModal.classList.add('visible');
}

function openAddModalPrefilled(data) {
  editingRadioId = null;
  document.getElementById('modalTitle').textContent   = 'Add Radio';
  document.getElementById('saveRadioBtn').textContent = 'Save Radio';
  radioForm.reset();
  document.getElementById('radioName').value     = data.name     || '';
  document.getElementById('radioIp').value       = data.ipAddress|| '';
  document.getElementById('radioCallsign').value = data.callsign || '';
  document.getElementById('radioVersion').value  = data.version  || '';
  // Stash license fields in dataset on the form for handleRadioSubmit to pick up
  radioForm.dataset.serialNumber       = data.serialNumber       || '';
  radioForm.dataset.maxLicensedVersion = data.maxLicensedVersion || '';
  radioForm.dataset.radioLicenseId     = data.radioLicenseId     || '';
  // Set model dropdown
  const modelSel = document.getElementById('radioModel');
  for (const opt of modelSel.options) {
    if (opt.value === data.model) { opt.selected = true; break; }
  }
  resetVersionHelp(data.version
    ? `✓ Version from discovery: ${data.version}`
    : 'Click "Fetch from Radio" to confirm the version.');
  if (data.version) document.getElementById('versionHelp').className = 'form-help success';
  radioModal.classList.add('visible');
}

function openEditModal(radio) {
  editingRadioId = radio.id;
  document.getElementById('modalTitle').textContent   = 'Edit Radio';
  document.getElementById('saveRadioBtn').textContent = 'Update Radio';
  document.getElementById('radioId').value       = radio.id;
  document.getElementById('radioName').value     = radio.name;
  document.getElementById('radioIp').value       = radio.ipAddress;
  document.getElementById('radioCallsign').value = radio.callsign  || '';
  document.getElementById('radioVersion').value  = radio.version   || '';
  const modelSel = document.getElementById('radioModel');
  for (const opt of modelSel.options) {
    if (opt.value === radio.model) { opt.selected = true; break; }
  }
  resetVersionHelp('Click "Fetch from Radio" to refresh the version from the live radio.');
  radioModal.classList.add('visible');
}

function closeRadioModal()    { radioModal.classList.remove('visible');    editingRadioId = null; }
function openDeleteModal(r)   { deletingRadioId = r.id; document.getElementById('deleteRadioName').textContent = r.name; deleteModal.classList.add('visible'); }
function closeDeleteModal()   { deleteModal.classList.remove('visible');   deletingRadioId = null; }
function openSettingsModal()  { settingsModal.classList.add('visible'); }
function closeSettingsModal() { settingsModal.classList.remove('visible'); }

// ─── Form handlers ────────────────────────────────────────────────────────────
async function handleRadioSubmit(e) {
  e.preventDefault();

  const formData = {
    name:               document.getElementById('radioName').value.trim(),
    ipAddress:          document.getElementById('radioIp').value.trim(),
    model:              document.getElementById('radioModel').value,
    serialNumber:       radioForm.dataset.serialNumber       || '0000-0000-0000-0000',
    maxLicensedVersion: radioForm.dataset.maxLicensedVersion || '',
    radioLicenseId:     radioForm.dataset.radioLicenseId     || '',
    callsign:           document.getElementById('radioCallsign').value.trim().toUpperCase(),
    version:            document.getElementById('radioVersion').value.trim() || '4.1.3.39644'
  };

  if (!validateIpAddress(formData.ipAddress)) {
    alert('Please enter a valid IP address (e.g. 192.168.1.100)');
    return;
  }
  if (!formData.model) {
    alert('Please select a radio model');
    return;
  }

  try {
    if (editingRadioId) {
      formData.id = editingRadioId;
      const existing = radios.find(r => r.id === editingRadioId);
      formData.enabled = existing ? existing.enabled : false;
      await window.smartunlink.updateRadio(formData);
    } else {
      formData.enabled = false;
      await window.smartunlink.addRadio(formData);
    }
    closeRadioModal();
    await loadRadios();
    renderDiscovered(); // refresh "already in config" state
  } catch (err) {
    console.error('Error saving radio:', err);
    alert('Error saving radio: ' + err.message);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const interval = parseInt(document.getElementById('broadcastInterval').value);
  if (interval < 1000 || interval > 30000) {
    alert('Broadcast interval must be between 1000 and 30000 ms');
    return;
  }
  try { await window.smartunlink.setBroadcastInterval(interval); closeSettingsModal(); }
  catch (err) { alert('Error saving settings: ' + err.message); }
}

async function handleDeleteConfirm() {
  if (!deletingRadioId) return;
  try {
    await window.smartunlink.deleteRadio(deletingRadioId);
    closeDeleteModal();
    await loadRadios();
  } catch (err) { alert('Error deleting radio: ' + err.message); }
}

// ─── Broadcast listener ───────────────────────────────────────────────────────
function setupBroadcastListener() {
  window.smartunlink.onBroadcastTick((data) => {
    lastBroadcast.textContent =
      `Last broadcast: ${new Date(data.timestamp).toLocaleTimeString()} (${data.radioCount} radio${data.radioCount === 1 ? '' : 's'})`;
  });
  window.smartunlink.onBroadcastError(err => console.error('Broadcast error:', err));
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('addRadioBtn').addEventListener('click', openAddModal);
  document.getElementById('addFirstRadioBtn').addEventListener('click', openAddModal);

  document.getElementById('closeModalBtn').addEventListener('click',    closeRadioModal);
  document.getElementById('cancelModalBtn').addEventListener('click',   closeRadioModal);
  radioForm.addEventListener('submit', handleRadioSubmit);

  document.getElementById('settingsBtn').addEventListener('click',      openSettingsModal);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('cancelSettingsBtn').addEventListener('click',closeSettingsModal);
  settingsForm.addEventListener('submit', handleSettingsSubmit);

  document.getElementById('cancelDeleteBtn').addEventListener('click',  closeDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', handleDeleteConfirm);

  document.getElementById('openConfigBtn').addEventListener('click', () => window.smartunlink.openConfigFolder());

  // Fetch version — try discovery cache first, fall back to TCP
  document.getElementById('fetchVersionBtn').addEventListener('click', async () => {
    const ip      = document.getElementById('radioIp').value.trim();
    const vInput  = document.getElementById('radioVersion');
    const helpEl  = document.getElementById('versionHelp');
    const btn     = document.getElementById('fetchVersionBtn');

    if (!validateIpAddress(ip)) {
      helpEl.textContent = 'Enter a valid IP address first.';
      helpEl.className   = 'form-help error';
      return;
    }

    // ── 1. Check the in-memory discovery cache (zero latency) ──
    const cached = discovered[ip];
    if (cached && cached.version) {
      vInput.value       = cached.version;
      helpEl.textContent = `✓ Version from LAN discovery: ${cached.version}`;
      helpEl.className   = 'form-help success';
      return;
    }

    // ── 2. Also check the main-process cache (populated before window opened) ──
    try {
      const all = await window.smartunlink.getDiscovered();
      const match = all.find(r => r.ip === ip);
      if (match && match.version) {
        vInput.value       = match.version;
        helpEl.textContent = `✓ Version from LAN discovery: ${match.version}`;
        helpEl.className   = 'form-help success';
        // Sync into local cache too
        discovered[ip] = match;
        return;
      }
    } catch (_) {}

    // ── 3. Fall back to TCP query ──
    btn.disabled = true;
    btn.classList.add('loading');
    helpEl.textContent = `No discovery packet seen yet — trying TCP on ${ip}:4992…`;
    helpEl.className   = 'form-help';

    try {
      const version    = await window.smartunlink.fetchRadioVersion(ip);
      vInput.value     = version;
      helpEl.textContent = `✓ Version via TCP: ${version}`;
      helpEl.className   = 'form-help success';
    } catch (err) {
      helpEl.textContent =
        `✗ Could not reach ${ip}:4992 via TCP. ` +
        `Make sure the radio is powered on and on this LAN, or wait for it to appear in "Discovered on LAN" above.`;
      helpEl.className   = 'form-help error';
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  // Close modals on overlay click or Escape
  document.querySelectorAll('.modal-overlay').forEach(o =>
    o.addEventListener('click', () => { closeRadioModal(); closeSettingsModal(); closeDeleteModal(); })
  );
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeRadioModal(); closeSettingsModal(); closeDeleteModal(); }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateIpAddress(ip) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  return ip.split('.').every(p => { const n = parseInt(p); return n >= 0 && n <= 255; });
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Go ───────────────────────────────────────────────────────────────────────
init();
