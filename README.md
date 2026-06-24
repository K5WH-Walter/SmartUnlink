# SmartUnlink — K5WH Edition

**Make your FlexRadio visible over VPN connections**

> This is an enhanced fork of the original [SmartUnlink by EI6LF (Brian)](https://github.com/brianbruff/SmartUnlink),
> maintained by **Walter Holmes — K5WH**, Extra Class Amateur Radio Operator, Houston TX.
> Full credit and thanks to Brian EI6LF for the original concept and implementation.

---

## The Problem

If you've ever tried to use your FlexRadio remotely over a VPN, you've probably run into a frustrating issue: **SmartSDR can't find your radio**.

This happens because FlexRadio uses a discovery system that broadcasts special VITA-49 packets on your local network to announce "Hey, I'm here!". These broadcast packets work great on your home network, but VPNs typically don't forward them. So when you're connected via VPN from a remote location, SmartSDR sits there searching... and searching... and never finds your radio.

## The Solution

SmartUnlink solves this problem by running on a computer at your remote location (where SmartSDR is running) and broadcasting those discovery packets on your behalf. It tells SmartSDR "there's a FlexRadio at this IP address" — and suddenly your radio appears!

## K5WH Edition — What's New

This fork adds several improvements over the original:

- **Live LAN Discovery panel** — automatically detects FlexRadio units broadcasting on your network and displays them in real time, with model, IP, firmware version, serial number, license ID, and callsign
- **One-click "Add to Config"** — click any discovered radio to pre-fill the Add Radio form with all fields populated directly from the radio's own broadcast
- **Correct license passthrough** — serial number, `radio_license_id`, and `max_licensed_version` are captured from the radio's real discovery packets and passed verbatim to SmartSDR, so authentication works correctly
- **Auto-backfill** — if a radio in your config is heard on the LAN, its license and version fields are automatically updated in the background without manual editing
- **Firmware version fetch** — uses the LAN discovery cache first (instant), with TCP fallback if needed
- **Expanded model list** — FLEX-6300, 6400, 6400M, 6500, 6600, 6600M, 6700, 8400, 8600, Aurora 510, Aurora 520
- **Multi-platform releases** — pre-built binaries for Windows, macOS (Intel + Apple Silicon), and Linux (AppImage, .deb, .rpm)

## How It Works

1. Install SmartUnlink on your **remote computer** (the one running SmartSDR, not the radio's LAN)
2. The **Discovered on LAN** panel will automatically show any FlexRadio units heard on the network
3. Click **+ Add to Config** on a discovered radio — all fields are pre-filled from the live packet
4. Toggle the radio **enabled**
5. Open SmartSDR — your radio will appear with correct license and version info

That's it. No complicated network configuration required.

## VPN Notes — Tailscale

SmartUnlink works great with **Tailscale**. For full waterfall and spectrum display over VPN you also need subnet routing enabled on your station PC so UDP data streams can flow back to SmartSDR:

```bash
# On your station PC (same LAN as the radio):
tailscale up --advertise-routes=192.168.x.0/24

# On your remote PC (running SmartSDR):
tailscale up --accept-routes
```

Approve the subnet route in the [Tailscale admin console](https://login.tailscale.com), then enable IP forwarding on the station PC:

```
reg add HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters /v IPEnableRouter /t REG_DWORD /d 1 /f
```

Reboot the station PC after running that command.

## Download

Get the latest pre-built installer for your platform from the [Releases](https://github.com/K5WH-Walter/SmartUnlink/releases) page:

| Platform | File | Notes |
|----------|------|-------|
| Windows | `SmartUnlink-Setup-*.exe` | Installer (recommended) |
| Windows | `SmartUnlink-*-portable.exe` | No install needed |
| macOS (Intel) | `SmartUnlink-*-x64.dmg` | Intel Mac |
| macOS (Apple Silicon) | `SmartUnlink-*-arm64.dmg` | M1/M2/M3 Mac |
| Linux | `SmartUnlink-*.AppImage` | Universal — `chmod +x`, then run |
| Linux | `SmartUnlink-*.deb` | Debian / Ubuntu |
| Linux | `SmartUnlink-*.rpm` | Fedora / RHEL |

## Build from Source

```bash
git clone https://github.com/K5WH-Walter/SmartUnlink.git
cd SmartUnlink
npm install
npm start                # run in development
npm run dist             # build Windows installer
npm run dist:portable    # build Windows portable exe
npm run dist:mac         # build macOS DMG (run on macOS)
npm run dist:linux       # build Linux packages (run on Linux)
```

## Supported Radios

**FLEX Series**
- FLEX-6300
- FLEX-6400 / 6400M
- FLEX-6500
- FLEX-6600 / 6600M
- FLEX-6700
- FLEX-8400
- FLEX-8600

**Aurora Series**
- Aurora-510
- Aurora-520

## Support

**Live support is available 24/7** via Walter's ZOOM channel — a room full of experienced hams ready to help:

🔗 **http://www.k5wh.net/zoom**

For bug reports and feature requests, open an [issue](https://github.com/K5WH-Walter/SmartUnlink/issues) on this repo.

## Credits

- **Original author:** Brian — [EI6LF](https://github.com/brianbruff) — concept, original implementation, and VITA-49 packet engineering
- **K5WH Edition:** Walter Holmes — K5WH — LAN discovery, license passthrough, multi-platform builds, Tailscale integration notes

## License

MIT License — feel free to use, modify, and share.

---

*SmartUnlink is not affiliated with FlexRadio Systems.*
