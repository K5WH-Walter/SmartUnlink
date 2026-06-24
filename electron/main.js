const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
let udpClient = null;
let broadcastInterval = null;
let packetCount = 0;

// Get all broadcast addresses for local network interfaces
function getBroadcastAddresses() {
  const interfaces = os.networkInterfaces();
  const broadcasts = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Calculate broadcast address from IP and netmask
        const ip = addr.address.split('.').map(Number);
        const mask = addr.netmask.split('.').map(Number);
        const broadcast = ip.map((octet, i) => octet | (~mask[i] & 255)).join('.');
        broadcasts.push({ interface: name, broadcast, address: addr.address });
      }
    }
  }
  return broadcasts;
}

// Config file path - use userData for installed app, local for development
const getConfigPath = () => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'config.json');
  }
  return path.join(__dirname, '..', 'config.json');
};

// Load configuration from JSON file
function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
      console.log(`Loaded config from ${configPath}`);
    } else {
      // Create default config
      saveConfig();
      console.log(`Created default config at ${configPath}`);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

// Save configuration to JSON file
function saveConfig() {
  const configPath = getConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Saved config to ${configPath}`);
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// Build VITA-49 Discovery Packet (ported from C# SmartUnlinkService)
function buildVita49DiscoveryPacket(radio) {
  // Build payload string (key=value pairs separated by space)
  const payloadStr = [
    `discovery_protocol_version=3.1.0.2`,
    `model=${radio.model}`,
    `serial=${radio.serialNumber}`,
    `version=${radio.version || '4.1.3.39644'}`,
    `nickname=${radio.name}`,
    `callsign=${radio.callsign || ''}`,
    `ip=${radio.ipAddress}`,
    `port=4992`,
    `status=Available`,
    `inuse_ip=`,
    `inuse_host=`,
    `max_licensed_version=v3`,
    `radio_license_id=00-00-00-00-00-00`,
    `fpc_mac=`,
    `wan_connected=0`,
    `licensed_clients=4`,
    `available_clients=4`,
    `max_panadapters=4`,
    `available_panadapters=4`,
    `max_slices=4`,
    `available_slices=4`
  ].join(' ');

  const payloadBytes = Buffer.from(payloadStr, 'ascii');

  // Pad payload to 4-byte alignment (VITA-49 requirement)
  const paddedLength = Math.ceil(payloadBytes.length / 4) * 4;
  const paddedPayload = Buffer.alloc(paddedLength, 0);
  payloadBytes.copy(paddedPayload);

  // Calculate total packet length in 32-bit words
  // Header(4) + StreamID(4) + ClassIDHigh(4) + ClassIDLow(4) + Timestamps(12) + Payload
  const headerSize = 4 + 4 + 4 + 4 + 12; // 28 bytes = 7 words
  const packetLengthWords = (headerSize + paddedLength) / 4;

  // Build packet
  const packet = Buffer.alloc(headerSize + paddedLength);
  let offset = 0;

  // Header (4 bytes)
  // Bits 31-28: Packet Type 0x3 (Extension Command)
  // Bit 27: Class ID present (1)
  // Bits 25-24: Reserved (0)
  // Bits 23-22: TSI 0x1 (Other timestamp)
  // Bits 21-20: TSF 0x1 (Sample count timestamp)
  // Bits 19-16: Packet Count
  // Bits 15-0: Packet size in words
  const header = (0x38500000 | ((packetCount & 0xF) << 16) | (packetLengthWords & 0xFFFF)) >>> 0;
  packet.writeUInt32BE(header, offset);
  offset += 4;

  // Stream ID (4 bytes) - 0x00000800
  packet.writeUInt32BE(0x00000800, offset);
  offset += 4;

  // Class ID High (4 bytes) - FlexRadio OUI: 0x00001C2D
  packet.writeUInt32BE(0x00001C2D, offset);
  offset += 4;

  // Class ID Low (4 bytes) - Discovery class code: 0x534CFFFF
  packet.writeUInt32BE(0x534CFFFF, offset);
  offset += 4;

  // Integer Timestamp (4 bytes) - 0
  packet.writeUInt32BE(0, offset);
  offset += 4;

  // Fractional Timestamp High (4 bytes) - 0
  packet.writeUInt32BE(0, offset);
  offset += 4;

  // Fractional Timestamp Low (4 bytes) - 0
  packet.writeUInt32BE(0, offset);
  offset += 4;

  // Payload
  paddedPayload.copy(packet, offset);

  // Increment packet count (wraps at 16)
  packetCount = (packetCount + 1) & 0xF;

  return packet;
}

// Start UDP broadcasting
function startBroadcasting() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
  }

  udpClient = dgram.createSocket('udp4');

  udpClient.on('error', (err) => {
    console.error('UDP Client error:', err);
    if (mainWindow) {
      mainWindow.webContents.send('broadcast-error', err.message);
    }
  });

  udpClient.bind(() => {
    udpClient.setBroadcast(true);
    const broadcastAddresses = getBroadcastAddresses();
    console.log('UDP broadcast enabled on interfaces:');
    broadcastAddresses.forEach(({ interface: name, broadcast, address }) => {
      console.log(`  ${name}: ${address} -> ${broadcast}`);
    });

    broadcastInterval = setInterval(() => {
      const enabledRadios = config.radios.filter(r => r.enabled);
      const broadcastAddresses = getBroadcastAddresses();

      enabledRadios.forEach(radio => {
        const packet = buildVita49DiscoveryPacket(radio);

        // Send to each network interface's broadcast address
        broadcastAddresses.forEach(({ broadcast, interface: ifaceName }) => {
          // Send to port 4992 (SmartSDR command API)
          udpClient.send(packet, 0, packet.length, 4992, broadcast, (err) => {
            if (err) {
              console.error(`Error broadcasting to ${broadcast}:4992 (${ifaceName}) for ${radio.name}:`, err);
            }
          });

          // Send to port 4991 (VITA-49 streaming, for compatibility)
          udpClient.send(packet, 0, packet.length, 4991, broadcast, (err) => {
            if (err) {
              console.error(`Error broadcasting to ${broadcast}:4991 (${ifaceName}) for ${radio.name}:`, err);
            }
          });
        });
      });

      // Notify UI of broadcast
      if (mainWindow && enabledRadios.length > 0) {
        mainWindow.webContents.send('broadcast-tick', {
          timestamp: new Date().toISOString(),
          radioCount: enabledRadios.length,
          interfaceCount: broadcastAddresses.length
        });
      }
    }, config.broadcastIntervalMs || 3000);

    console.log(`Broadcasting started (interval: ${config.broadcastIntervalMs}ms)`);
  });
}

// Stop UDP broadcasting
function stopBroadcasting() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
  if (udpClient) {
    udpClient.close();
    udpClient = null;
  }
  console.log('Broadcasting stopped');
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'SmartUnlink by EI6LF - FlexRadio Discovery Proxy',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-radios', () => {
  return config.radios;
});

ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('add-radio', (event, radio) => {
  radio.id = uuidv4();
  radio.enabled = radio.enabled || false;
  config.radios.push(radio);
  saveConfig();
  return radio;
});

ipcMain.handle('update-radio', (event, radio) => {
  const index = config.radios.findIndex(r => r.id === radio.id);
  if (index !== -1) {
    config.radios[index] = radio;
    saveConfig();
    return true;
  }
  return false;
});

ipcMain.handle('delete-radio', (event, radioId) => {
  const index = config.radios.findIndex(r => r.id === radioId);
  if (index !== -1) {
    config.radios.splice(index, 1);
    saveConfig();
    return true;
  }
  return false;
});

ipcMain.handle('set-radio-enabled', (event, { radioId, enabled }) => {
  const radio = config.radios.find(r => r.id === radioId);
  if (radio) {
    radio.enabled = enabled;
    saveConfig();
    return true;
  }
  return false;
});

ipcMain.handle('set-broadcast-interval', (event, interval) => {
  config.broadcastIntervalMs = interval;
  saveConfig();
  // Restart broadcasting with new interval
  if (broadcastInterval) {
    stopBroadcasting();
    startBroadcasting();
  }
  return true;
});

ipcMain.handle('get-config-path', () => {
  return getConfigPath();
});

ipcMain.handle('open-config-folder', () => {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  require('electron').shell.openPath(configDir);
  return true;
});

ipcMain.handle('fetch-radio-version', (event, ipAddress) => {
  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 5000;
    let settled = false;
    let buffer = '';

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      if (result.error) reject(new Error(result.error));
      else resolve(result.value);
    };

    const timer = setTimeout(() => {
      done({ error: `Timed out connecting to ${ipAddress}:4992 — is the radio on and reachable?` });
    }, TIMEOUT_MS);

    const socket = new net.Socket();

    socket.on('error', (err) => {
      done({ error: `Could not connect to ${ipAddress}:4992 — ${err.message}` });
    });

    socket.connect(4992, ipAddress, () => {
      console.log(`[fetch-radio-version] Connected to ${ipAddress}:4992`);
      // The Flex radio sends a version message immediately on connect; also send 'v' to be safe
      socket.write('v\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('ascii');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial last line

      for (const line of lines) {
        const trimmed = line.trim();
        console.log(`[fetch-radio-version] <-- ${trimmed}`);

        // Response lines look like:
        //   V version=4.1.3.39644|...
        //   S version=4.1.3.39644
        //   version=4.1.3.39644   (plain)
        const match =
          trimmed.match(/\bversion=(\S+)/i) ||       // any key=value
          trimmed.match(/^V\s+(\d+\.\d+\.\d+\.\d+)/i); // bare V response

        if (match) {
          // Strip trailing pipe-separated fields if present
          const ver = match[1].split('|')[0].trim();
          console.log(`[fetch-radio-version] Detected version: ${ver}`);
          done({ value: ver });
          return;
        }
      }
    });

    socket.on('close', () => {
      if (!settled) {
        done({ error: 'Radio closed the connection before returning a version string.' });
      }
    });
  });
});

// App lifecycle
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  startBroadcasting();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBroadcasting();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBroadcasting();
});
