# Nearsend v2

A zero-dependency, local Wi-Fi file and clipboard transfer app for your iPhone and Windows laptop.

## What's new in v2.0

- **Real-time live sync (SSE)**: Files, shared text, and connected devices update instantly without polling.
- **Self-contained QR codes**: Pure Node.js ISO/IEC 18004 SVG QR generator — Python is no longer required.
- **Folder & batch transfers**: Drag-and-drop folders (or use **Choose folder**), see live transfer speed and ETA, multi-select items, download selected/all files as a **ZIP archive**, or bulk delete / clear all.
- **Inline media lightbox**: Preview photos, stream/scrub videos (with HTTP Range `206` support), and play audio directly in the browser with keyboard navigation.
- **Network & device controls**: Switch between network adapters (helpful with VPNs or virtual adapters), rotate the 6-digit pairing code, and view/revoke paired devices.
- **Upgraded clipboard**: Auto-detected clickable links, one-tap copy on every text item, and a full Shared Clipboard history view.
- **Desktop controls & Dark Mode**: Toggle light/dark theme, open `data/files/` in Windows Explorer, or stop the background server right from the UI.
- **Optional HTTPS**: Place `cert.pem` and `key.pem` in `data/` (or set `NEARSEND_CERT` and `NEARSEND_KEY`) to serve over HTTPS.

## Run on Windows

Requires Node.js 22 or newer. No npm packages or Python are needed.

Double-click **Create Desktop Shortcut.cmd** once to add **Nearsend** to your desktop. Then double-click the desktop shortcut whenever you want to transfer: it starts the server in the background and opens an app window showing the QR code. Scan it with your iPhone Camera, open the link, then choose files or share text.

You can also double-click **Nearsend.vbs** or **start-nearsend.cmd** directly. Reopening reuses the running server. You can stop the background server at any time using **Stop server** in the sidebar.

For a visible terminal instead, open PowerShell in this folder and run:

```powershell
npm start
```

Open **http://localhost:3210** on your laptop.

## Connect your iPhone

1. Connect both devices to the same trusted Wi-Fi.
2. On the laptop, click **Connect a device** (and pick your Wi-Fi adapter from **Network adapter** if you have VPN/VM interfaces).
3. Scan the QR code using your iPhone Camera and open the link in Safari, or enter the displayed address and six-digit pairing code.
4. Send files, folders, or shared text — transfers appear immediately on all paired devices.

Allow Node.js through Windows Firewall on **Private networks** if Windows asks. Pairing keys reset when the server restarts.

## Storage and privacy

Files are streamed to `data/files/` on this laptop, with metadata in `data/index.json`. There is a 2 GB limit per file and a 50,000-character limit per text transfer.

By default, Nearsend uses local HTTP on your trusted private Wi-Fi. For encrypted local traffic, provide a TLS certificate (`data/cert.pem` + `data/key.pem` or `NEARSEND_CERT` / `NEARSEND_KEY`).

## Checks

```powershell
npm test
```

Set `PORT` to change the port, and `NEARSEND_DATA` to change the data folder.
