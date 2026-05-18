# Hamza — Personal AI Life Assistant

A desktop app built with Electron + React. Hamza is a personal AI assistant organised into six life rooms, with persistent chat history, voice input, and a memory system.

---

## What it does

- **6 rooms** — Everything, Spiritual, Financial, Emotional, College, Building — each with unlimited renameable chat threads
- **Fast mode** (Claude Haiku) for quick answers, **Deep mode** (Claude Sonnet) for emotional/nuanced conversations; Spiritual and Emotional rooms auto-use Deep
- **Voice input** — local Whisper transcription (no external API, runs on your device)
- **TTS** — speaker button on every Hamza message reads responses aloud
- **Memory page** — persistent notes Hamza can reference across conversations
- **Black/white minimal design** with a pixel art avatar
- All chat history saved locally via localStorage — no server, no cloud

---

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron 34 |
| UI | React 18 + Vite 5 |
| AI | Anthropic Claude API (Haiku + Sonnet) |
| Voice input | @xenova/transformers — Whisper tiny.en (on-device) |
| TTS | Web Speech API (window.speechSynthesis) |
| Persistence | localStorage |
| Packaging | electron-builder (portable Windows .exe) |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/hamza.git
cd hamza
npm install
```

`npm install` automatically copies the ONNX WASM files needed for local voice transcription into `public/`.

### 2. Add your API key

Create a `.env` file in the root (see `.env.example`):

```
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

### 3. Run in development

```bash
npm run dev
```

Opens the Electron window pointed at the Vite dev server.

### 4. Build a desktop app (.exe)

```bash
npm run package
```

Creates `release/win-unpacked/Hamza.exe`. Right-click → Send to Desktop to create a shortcut.

---

## Project structure

```
hamza/
├── electron/
│   ├── main.js          # Electron main process + Whisper IPC handler
│   └── preload.cjs      # Exposes transcribe() to renderer via contextBridge
├── src/
│   ├── App.jsx          # Full app — rooms, chat threads, memory, API calls
│   ├── Avatar.jsx       # Pixel art avatar (SVG grid)
│   ├── VoiceButton.jsx  # Mic recording + audio resampling → IPC transcription
│   ├── rooms.js         # Room config, system prompt builder, message formatter
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles
├── scripts/
│   └── copy-wasm.js     # Postinstall — copies ONNX WASM files to public/
├── public/              # ONNX Runtime WASM files (auto-copied on install)
├── .env.example
├── vite.config.js
└── package.json
```

---

## Notes

- Voice transcription downloads the Whisper tiny.en model (~40 MB) on first use and caches it locally. First transcription takes ~20 seconds; subsequent ones are fast.
- The app calls the Anthropic API directly from the renderer process using the `anthropic-dangerous-direct-browser-access` header — this is intentional for a local desktop app.
- Conversations are stored in `localStorage` and never leave your machine.
