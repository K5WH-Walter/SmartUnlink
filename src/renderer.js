// State
let radios = [];
let editingRadioId = null;
let deletingRadioId = null;

// DOM Elements
const radioList = document.getElementById('radioList');
const emptyState = document.getElementById('emptyState');
const broadcastStatus = document.getElementById('broadcastStatus');
const lastBroadcast = document.getElementById('lastBroadcast');

// Modal Elements
const radioModal = document.getElementById('radioModal');
const settingsModal = document.getElementById('settingsModal');
const deleteModal = document.getElementById('deleteModal');
const radioForm = document.getElementById('radioForm');
const settingsForm = document.getElementById('settingsForm');

// Buttons
const addRadioBtn = document.getElementById('addRadioBtn');
const addFirstRadioBtn = document.getElementById('addFirstRadioBtn');
const settingsBtn = document.getElementById('settingsBtn');
const openConfigBtn = document.getElementById('openConfigBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Initialize
async function init() {
  await loadRadios();
  await loadConfig();
  setupEventListeners();
  setupBroadcastListener();
}

// Load radios from backend
async function loadRadios() {
  try {
    radios = await window.smartunlink.getRadios();
    renderRadios();
    updateBroadcastStatus();
  } catch (error) {
    console.error('Error loading radios:', error);
  }
}

// Load configuration
async function loadConfig() {
  try {
    const config = await window.smartunlink.getConfig();
    document.getElementById('broadcastInterval').value = config.broadcastIntervalMs || 3000;

    const configPath = await window.smartunlink.getConfigPath();
    document.getElementById('configPath').textContent = configPath;
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

// Render radio cards
function renderRadios() {
  if (radios.length === 0) {
    radioList.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');
  radioList.innerHTML = radios.map(radio => createRadioCard(radio)).join('');

  // Attach event listeners to cards
  radios.forEach(radio => {
    const card = document.querySelector(`[data-radio-id="${radio.id}"]`);
    if (card) {
      const toggle = card.querySelector('.toggle input');
      const editBtn = card.querySelector('.edit-btn');
      const deleteBtn = card.querySelector('.delete-btn');

      toggle.addEventListener('change', () => toggleRadio(radio.id, toggle.checked));
      editBtn.addEventListener('click', () => openEditModal(radio));
      deleteBtn.addEventListener('click', () => openDeleteModal(radio));
    }
  });
}

// Create radio card HTML
function createRadioCard(radio) {
  const statusClass = radio.enabled ? 'broadcasting' : 'idle';
  const statusText = radio.enabled ? 'Broadcasting' : 'Idle';

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
          ${radio.callsign ? `
          <span class="radio-card-detail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            ${escapeHtml(radio.callsign)}
          </span>
          ` : ''}
        </div>
      </div>
      <div class="radio-card-status">
        <div class="status-indicator ${statusClass}">
          <span class="dot"></span>
          ${statusText}
        </div>
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
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
        <label class="toggle">
          <input type="checkbox" ${radio.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  `;
}

// Toggle radio enabled state
async function toggleRadio(radioId, enabled) {
  try {
    await window.smartunlink.setRadioEnabled(radioId, enabled);
    const radio = radios.find(r => r.id === radioId);
    if (radio) {
      radio.enabled = enabled;
      renderRadios();
      updateBroadcastStatus();
    }
  } catch (error) {
    console.error('Error toggling radio:', error);
  }
}

// Update broadcast status in header
function updateBroadcastStatus() {
  const enabledCount = radios.filter(r => r.enabled).length;
  const statusText = broadcastStatus.querySelector('.status-text');

  if (enabledCount > 0) {
    broadcastStatus.classList.add('active');
    statusText.textContent = `Broadcasting (${enabledCount})`;
  } else {
    broadcastStatus.classList.remove('active');
    statusText.textContent = 'Idle';
  }
}

// Modal functions
function openAddModal() {
  editingRadioId = null;
  document.getElementById('modalTitle').textContent = 'Add Radio';
  document.getElementById('saveRadioBtn').textContent = 'Save Radio';
  radioForm.reset();
  document.getElementById('radioVersion').value = '4.1.3.39644';
  const helpEl = document.getElementById('versionHelp');
  helpEl.textContent = 'Enter the IP above, then click "Fetch from Radio" to auto-detect.';
  helpEl.className = 'form-help';
  radioModal.classList.add('visible');
}

function openEditModal(radio) {
  editingRadioId = radio.id;
  document.getElementById('modalTitle').textContent = 'Edit Radio';
  document.getElementById('saveRadioBtn').textContent = 'Update Radio';

  document.getElementById('radioId').value = radio.id;
  document.getElementById('radioName').value = radio.name;
  document.getElementById('radioIp').value = radio.ipAddress;
  document.getElementById('radioModel').value = radio.model;
  document.getElementById('radioCallsign').value = radio.callsign || '';
  document.getElementById('radioVersion').value = radio.version || '4.1.3.39644';

  const helpEl = document.getElementById('versionHelp');
  helpEl.textContent = 'Click "Fetch from Radio" to refresh the version from the live radio.';
  helpEl.className = 'form-help';

  radioModal.classList.add('visible');
}

function closeRadioModal() {
  radioModal.classList.remove('visible');
  editingRadioId = null;
}

function openDeleteModal(radio) {
  deletingRadioId = radio.id;
  document.getElementById('deleteRadioName').textContent = radio.name;
  deleteModal.classList.add('visible');
}

function closeDeleteModal() {
  deleteModal.classList.remove('visible');
  deletingRadioId = null;
}

function openSettingsModal() {
  settingsModal.classList.add('visible');
}

function closeSettingsModal() {
  settingsModal.classList.remove('visible');
}

// Form submission handlers
async function handleRadioSubmit(e) {
  e.preventDefault();

  const formData = {
    name: document.getElementById('radioName').value.trim(),
    ipAddress: document.getElementById('radioIp').value.trim(),
    model: document.getElementById('radioModel').value,
    serialNumber: '0000-0000-0000-0000',
    callsign: document.getElementById('radioCallsign').value.trim().toUpperCase(),
    version: document.getElementById('radioVersion').value.trim() || '4.1.3.39644'
  };

  // Validate IP address
  if (!validateIpAddress(formData.ipAddress)) {
    alert('Please enter a valid IP address');
    return;
  }

  try {
    if (editingRadioId) {
      formData.id = editingRadioId;
      const existingRadio = radios.find(r => r.id === editingRadioId);
      formData.enabled = existingRadio ? existingRadio.enabled : false;
      await window.smartunlink.updateRadio(formData);
    } else {
      formData.enabled = false;
      await window.smartunlink.addRadio(formData);
    }

    closeRadioModal();
    await loadRadios();
  } catch (error) {
    console.error('Error saving radio:', error);
    alert('Error saving radio: ' + error.message);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();

  const interval = parseInt(document.getElementById('broadcastInterval').value);

  if (interval < 1000 || interval > 30000) {
    alert('Broadcast interval must be between 1000 and 30000 ms');
    return;
  }

  try {
    await window.smartunlink.setBroadcastInterval(interval);
    closeSettingsModal();
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Error saving settings: ' + error.message);
  }
}

async function handleDeleteConfirm() {
  if (!deletingRadioId) return;

  try {
    await window.smartunlink.deleteRadio(deletingRadioId);
    closeDeleteModal();
    await loadRadios();
  } catch (error) {
    console.error('Error deleting radio:', error);
    alert('Error deleting radio: ' + error.message);
  }
}

// Validation
function validateIpAddress(ip) {
  const regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!regex.test(ip)) return false;

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part);
    return num >= 0 && num <= 255;
  });
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Setup broadcast listener
function setupBroadcastListener() {
  window.smartunlink.onBroadcastTick((data) => {
    lastBroadcast.textContent = `Last broadcast: ${new Date(data.timestamp).toLocaleTimeString()} (${data.radioCount} radio${data.radioCount === 1 ? '' : 's'})`;
  });

  window.smartunlink.onBroadcastError((error) => {
    console.error('Broadcast error:', error);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Fetch version from radio
  document.getElementById('fetchVersionBtn').addEventListener('click', async () => {
    const ip = document.getElementById('radioIp').value.trim();
    const versionInput = document.getElementById('radioVersion');
    const helpEl = document.getElementById('versionHelp');
    const btn = document.getElementById('fetchVersionBtn');

    if (!ip || !validateIpAddress(ip)) {
      helpEl.textContent = 'Enter a valid IP address first.';
      helpEl.className = 'form-help error';
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    helpEl.textContent = `Connecting to ${ip}:4992…`;
    helpEl.className = 'form-help';

    try {
      const version = await window.smartunlink.fetchRadioVersion(ip);
      versionInput.value = version;
      helpEl.textContent = `✓ Version detected: ${version}`;
      helpEl.className = 'form-help success';
    } catch (err) {
      helpEl.textContent = `✗ ${err.message}`;
      helpEl.className = 'form-help error';
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  // Add radio buttons
  addRadioBtn.addEventListener('click', openAddModal);
  addFirstRadioBtn.addEventListener('click', openAddModal);

  // Radio modal
  closeModalBtn.addEventListener('click', closeRadioModal);
  cancelModalBtn.addEventListener('click', closeRadioModal);
  radioForm.addEventListener('submit', handleRadioSubmit);

  // Settings
  settingsBtn.addEventListener('click', openSettingsModal);
  closeSettingsBtn.addEventListener('click', closeSettingsModal);
  cancelSettingsBtn.addEventListener('click', closeSettingsModal);
  settingsForm.addEventListener('submit', handleSettingsSubmit);

  // Delete modal
  cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  confirmDeleteBtn.addEventListener('click', handleDeleteConfirm);

  // Open config folder
  openConfigBtn.addEventListener('click', () => {
    window.smartunlink.openConfigFolder();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', () => {
      closeRadioModal();
      closeSettingsModal();
      closeDeleteModal();
    });
  });

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRadioModal();
      closeSettingsModal();
      closeDeleteModal();
    }
  });
}

// Initialize app
init();
