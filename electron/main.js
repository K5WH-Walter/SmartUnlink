const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Configuration
let config = {
  broadcastIntervalMs: 3000,
  radios: []
};

let mainWindow = null;
let udpSender = null;       // socket used to broadcast outgoing discovery packets
let udpListener = null;     // socket used to listen for radios announcing themselves
let broadcastInterval = null;
let packetCount = 0;

// Radios we have heard announce themselves on the LAN  { ip -> { model, version, nickname, callsign, serial, ... } }
const discoveredRadios = {};

// ─── Network helpers ──────────────────────────────────────────────────────────

function getBroadcastAddresses() {
  const interfaces = os.networkInterfaces();
  const results = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const ip   = addr.address.split('.').map(Number);
        const mask = addr.netmask.split('.').map(Number);
        const broadcast = ip.map((o, i) => o | (~mask[i] & 255)).join('.');
        results.push({ interface: name, broadcast, address: addr.address });
      }
    }
  }
  return results;
}

// ─── Config persistence ───────────────────────────────────────────────────────

const getConfigPath = () => {
  if (app.isPackaged) return path.join(app.getPath('userData'), 'config.json');
  return path.join(__dirname, '..', 'config.json');
};

function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log(`Loaded config from ${configPath}`);
    } else {
      saveConfig();
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// ─── VITA-49 packet builder ───────────────────────────────────────────────────

function buildVita49DiscoveryPacket(radio) {
  // Use values captured live from the radio's own VITA-49 broadcast wherever available.
  // This ensures serial, radio_license_id, max_licensed_version etc. are exact copies
  // of what the real radio sends — SmartSDR validates these and will reject dummies.
  const disc = discoveredRadios[radio.ipAddress] || {};

  const payloadStr = [
    `discovery_protocol_version=${disc.discovery_protocol_version || '3.1.0.2'}`,
    `model=${disc.model                        || radio.model}`,
    `serial=${disc.serial                      || radio.serialNumber       || '0000-0000-0000-0000'}`,
    `version=${disc.version                    || radio.version            || '4.1.3.39644'}`,
    `nickname=${disc.nickname                  || radio.name}`,
    `callsign=${disc.callsign                  || radio.callsign           || ''}`,
    `ip=${radio.ipAddress}`,
    `port=${disc.port                          || '4992'}`,
    `status=${disc.status                      || 'Available'}`,
    `inuse_ip=${disc.inuse_ip                  || ''}`,
    `inuse_host=${disc.inuse_host              || ''}`,
    `max_licensed_version=${disc.max_licensed_version || radio.maxLicensedVersion || 'v3'}`,
    `radio_license_id=${disc.radio_license_id         || radio.radioLicenseId     || '00-00-00-00-00-00'}`,
    `fpc_mac=${disc.fpc_mac                    || ''}`,
    `wan_connected=${disc.wan_connected        || '0'}`,
    `licensed_clients=${disc.licensed_clients         || '4'}`,
    `available_clients=${disc.available_clients       || '4'}`,
    `max_panadapters=${disc.max_panadapters           || '4'}`,
    `available_panadapters=${disc.available_panadapters || '4'}`,
    `max_slices=${disc.max_slices              || '4'}`,
    `available_slices=${disc.available_slices  || '4'}`
  ].join(' ');

  const payloadBytes  = Buffer.from(payloadStr, 'ascii');
  const paddedLength  = Math.ceil(payloadBytes.length / 4) * 4;
  const paddedPayload = Buffer.alloc(paddedLength, 0);
  payloadBytes.copy(paddedPayload);

  const headerSize        = 4 + 4 + 4 + 4 + 12; // 28 bytes
  const packetLengthWords = (headerSize + paddedLength) / 4;
  const packet            = Buffer.alloc(headerSize + paddedLength);
  let offset = 0;

  const header = (0x38500000 | ((packetCount & 0xF) << 16) | (packetLengthWords & 0xFFFF)) >>> 0;
  packet.writeUInt32BE(header,     offset); offset += 4;
  packet.writeUInt32BE(0x00000800, offset); offset += 4;
  packet.writeUInt32BE(0x00001C2D, offset); offset += 4;
  packet.writeUInt32BE(0x534CFFFF, offset); offset += 4;
  packet.writeUInt32BE(0,          offset); offset += 4;
  packet.writeUInt32BE(0,          offset); offset += 4;
  packet.writeUInt32BE(0,          offset); offset += 4;
  paddedPayload.copy(packet, offset);

  packetCount = (packetCount + 1) & 0xF;
  return packet;
}

// ─── Parse an inbound VITA-49 discovery payload ───────────────────────────────

function parseDiscoveryPayload(buf) {
  try {
    // Skip 28-byte VITA-49 header
    const HEADER_BYTES = 28;
    if (buf.length <= HEADER_BYTES) return null;

    // Verify FlexRadio Class ID (bytes 8-15)
    const ouiHigh = buf.readUInt32BE(8);
    const ouiLow  = buf.readUInt32BE(12);
    if (ouiHigh !== 0x00001C2D || ouiLow !== 0x534CFFFF) return null;

    const payload = buf.slice(HEADER_BYTES).toString('ascii').replace(/\0/g, '').trim();
    const fields  = {};
    for (const kv of payload.split(' ')) {
      const eq = kv.indexOf('=');
      if (eq !== -1) fields[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    if (!fields.ip || !fields.model) return null;
    return fields;
  } catch (_) {
    return null;
  }
}

// ─── UDP listener — hears radios announce themselves ─────────────────────────

function startListening() {
  if (udpListener) return;

  udpListener = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpListener.on('error', (err) => {
    console.error('UDP listener error:', err);
  });

  udpListener.on('message', (msg, rinfo) => {
    const fields = parseDiscoveryPayload(msg);
    if (!fields) return;

    const key  = fields.ip || rinfo.address;
    const prev = discoveredRadios[key];
    discoveredRadios[key] = { ...fields, _seen: Date.now() };

    // If this IP matches a radio already in config, backfill the real license/serial
    // so the broadcaster can use them immediately without waiting for a manual edit.
    const saved = config.radios.find(r => r.ipAddress === key);
    if (saved) {
      let dirty = false;
      const copy = (src, dst) => { if (fields[src] && saved[dst] !== fields[src]) { saved[dst] = fields[src]; dirty = true; } };
      copy('serial',               'serialNumber');
      copy('version',              'version');
      copy('max_licensed_version', 'maxLicensedVersion');
      copy('radio_license_id',     'radioLicenseId');
      copy('model',                'model');
      copy('callsign',             'callsign');
      if (dirty) {
        saveConfig();
        console.log(`[discovery] Updated config for ${key} with live radio data`);
      }
    }

    // Only push to UI when it's a new discovery (or key fields changed)
    const isNew = !prev
      || prev.model             !== fields.model
      || prev.version           !== fields.version
      || prev.radio_license_id  !== fields.radio_license_id;

    if (isNew && mainWindow) {
      console.log(`[discovery] ${fields.model} @ ${fields.ip}  serial=${fields.serial}  license_id=${fields.radio_license_id}  max_licensed=${fields.max_licensed_version}  v${fields.version}`);
      mainWindow.webContents.send('radio-discovered', discoveredRadios[key]);
    }
  });

  // Listen on port 4992 (SmartSDR discovery port) on all interfaces
  udpListener.bind(4992, () => {
    try { udpListener.setBroadcast(true); } catch (_) {}
    // Also bind port 4991 via a second socket
    startListening4991();
    console.log('UDP discovery listener started on port 4992');
  });
}

let udpListener4991 = null;
function startListening4991() {
  if (udpListener4991) return;
  udpListener4991 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpListener4991.on('error', () => {});
  udpListener4991.on('message', (msg, rinfo) => {
    const fields = parseDiscoveryPayload(msg);
    if (!fields) return;
    const key = fields.ip || rinfo.address;
    discoveredRadios[key] = { ...fields, _seen: Date.now() };
  });
  udpListener4991.bind(4991, () => {
    try { udpListener4991.setBroadcast(true); } catch (_) {}
  });
}

// ─── UDP sender — broadcasts our proxy packets ────────────────────────────────

function startBroadcasting() {
  if (broadcastInterval) clearInterval(broadcastInterval);

  udpSender = dgram.createSocket('udp4');
  udpSender.on('error', (err) => {
    console.error('UDP sender error:', err);
    if (mainWindow) mainWindow.webContents.send('broadcast-error', err.message);
  });

  udpSender.bind(() => {
    udpSender.setBroadcast(true);

    broadcastInterval = setInterval(() => {
      const enabledRadios    = config.radios.filter(r => r.enabled);
      const broadcastAddrs   = getBroadcastAddresses();

      enabledRadios.forEach(radio => {
        const packet = buildVita49DiscoveryPacket(radio);
        broadcastAddrs.forEach(({ broadcast }) => {
          udpSender.send(packet, 0, packet.length, 4992, broadcast, () => {});
          udpSender.send(packet, 0, packet.length, 4991, broadcast, () => {});
        });
      });

      if (mainWindow && enabledRadios.length > 0) {
        mainWindow.webContents.send('broadcast-tick', {
          timestamp:      new Date().toISOString(),
          radioCount:     enabledRadios.length,
          interfaceCount: getBroadcastAddresses().length
        });
      }
    }, config.broadcastIntervalMs || 3000);

    console.log(`Broadcasting started (interval: ${config.broadcastIntervalMs}ms)`);
  });
}

function stopBroadcasting() {
  if (broadcastInterval) { clearInterval(broadcastInterval); broadcastInterval = null; }
  if (udpSender)          { udpSender.close(); udpSender = null; }
  console.log('Broadcasting stopped');
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 700, minWidth: 700, minHeight: 500,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    },
    title:           'SmartUnlink - FlexRadio Discovery Proxy',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-radios',      () => config.radios);
ipcMain.handle('get-config',      () => config);
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('add-radio', (event, radio) => {
  radio.id      = uuidv4();
  radio.enabled = radio.enabled || false;
  if (!radio.serialNumber) radio.serialNumber = '0000-0000-0000-0000';
  config.radios.push(radio);
  saveConfig();
  return radio;
});

ipcMain.handle('update-radio', (event, radio) => {
  const index = config.radios.findIndex(r => r.id === radio.id);
  if (index !== -1) { config.radios[index] = radio; saveConfig(); return true; }
  return false;
});

ipcMain.handle('delete-radio', (event, radioId) => {
  const index = config.radios.findIndex(r => r.id === radioId);
  if (index !== -1) { config.radios.splice(index, 1); saveConfig(); return true; }
  return false;
});

ipcMain.handle('set-radio-enabled', (event, { radioId, enabled }) => {
  const radio = config.radios.find(r => r.id === radioId);
  if (radio) { radio.enabled = enabled; saveConfig(); return true; }
  return false;
});

ipcMain.handle('set-broadcast-interval', (event, interval) => {
  config.broadcastIntervalMs = interval;
  saveConfig();
  if (broadcastInterval) { stopBroadcasting(); startBroadcasting(); }
  return true;
});

ipcMain.handle('get-config-path',    () => getConfigPath());
ipcMain.handle('get-discovered',     () => Object.values(discoveredRadios));

ipcMain.handle('open-config-folder', () => {
  const dir = path.dirname(getConfigPath());
  // Ensure the directory exists before trying to open it
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return true;
});

// TCP version fetch from radio's command API
ipcMain.handle('fetch-radio-version', (event, ipAddress) => {
  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 5000;
    let settled = false;
    let buffer  = '';

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      if (result.error) reject(new Error(result.error));
      else resolve(result.value);
    };

    const timer = setTimeout(() =>
      done({ error: `Timed out connecting to ${ipAddress}:4992 — is the radio on and reachable?` }),
      TIMEOUT_MS
    );

    const socket = new net.Socket();
    socket.on('error', err => done({ error: `Could not reach ${ipAddress}:4992 — ${err.message}` }));

    socket.connect(4992, ipAddress, () => {
      console.log(`[fetch-version] Connected to ${ipAddress}:4992`);
      socket.write('v\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('ascii');
      for (const line of buffer.split('\n')) {
        const m = line.match(/\bversion=([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
        if (m) { done({ value: m[1] }); return; }
      }
      // Keep only the last (potentially incomplete) line
      buffer = buffer.split('\n').pop();
    });

    socket.on('close', () => {
      if (!settled) done({ error: 'Radio closed the connection before returning a version string.' });
    });
  });
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  startListening();    // listen for radios on LAN
  startBroadcasting(); // proxy our configured radios

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBroadcasting();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopBroadcasting());
