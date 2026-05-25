# Hamza — Personal AI Desktop Assistant

Electron + React + Vite desktop app. Personal AI life assistant for Tayyab, with six conversation rooms, persistent local memory, voice input, and streaming responses.

---

## Commands

```bash
npm run dev        # Start dev mode (Vite + Electron, both die together on failure)
npm run build      # Vite build only
npm run package    # Build + package to release/win-unpacked/Hamza.exe
```

**After `npm run package`:** The exe at `release/win-unpacked/Hamza.exe` is rebuilt before the code signing step. Code signing always fails on this machine (Windows symlink privilege error) — that's expected. The exe is still fully functional. The desktop shortcut at `C:\Users\tayya\Desktop\Hamza.lnk` points to this path and updates automatically.

---

## Environment

Copy `.env.example` to `.env` and add the Anthropic API key:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Vite statically inlines `import.meta.env.VITE_ANTHROPIC_API_KEY` at build time — it is baked into the JS bundle, not read at runtime.

---

## Architecture

### Process model
- **Electron main** (`electron/main.js`) — window creation, Whisper transcription via IPC
- **Renderer** (`src/`) — React app running in Electron's Chromium, talks to Anthropic API directly (no proxy needed — `anthropic-dangerous-direct-browser-access: true` header)
- **Preload** (`electron/preload.cjs`) — exposes `window.electronAPI.transcribe()` to the renderer

### State and persistence
All persistence is `localStorage`. No server, no database.

| Key | Contents |
|-----|----------|
| `hx_chats_{roomId}` | Chat list per room (id, title, date) |
| `hx_msgs_{chatId}` | Messages for a chat |
| `hx_notes` | Pinned notes (freeform textarea) |
| `hx_memories` | Auto-extracted memory entries (max 150) |

### API calls
Two models are used:
- **Claude Haiku** — memory extraction (background, silent, fire-and-forget)
- **Claude Sonnet** — all user-facing responses (default), always used in Spiritual and Emotional rooms

All calls share `ANTHROPIC_HEADERS` constant in `App.jsx`. Streaming uses SSE with a buffer to handle incomplete line boundaries between chunks.

### Memory system
After every AI response >100 chars, a background Haiku call extracts 0–3 personal facts. Stored in `localStorage` as `{ id, text, date, chatId, room }`. On every message send, the last 40 memories are injected into the system prompt as a dated log. Cap is 150 entries (oldest drop off).

`setMemories` uses a functional update (`prev => [...]`) to prevent concurrent extractions from overwriting each other.

### Voice input
- Mic button records audio in renderer, sends raw `Float32Array` via IPC to Electron main
- Main process runs Whisper (`Xenova/whisper-tiny.en`) via `@xenova/transformers` with `onnxruntime-node`
- Model is loaded on app start in the background; first transcription may be slow

---

## File Map

| File | Purpose |
|------|---------|
| `src/App.jsx` | Everything — state, chat logic, streaming, memory extraction, all UI |
| `src/rooms.js` | Room definitions, system prompt builder, memory injection (`getSys`) |
| `src/index.css` | All styles (including VoiceButton — not inline) |
| `src/Avatar.jsx` | Pixel art SVG avatar |
| `src/VoiceButton.jsx` | Mic button, IPC → Whisper transcription |
| `src/main.jsx` | React entry point |
| `src/context.js` | Template for personal context (committed) |
| `src/context.local.js` | Real personal context — gitignored, never commit |
| `electron/main.js` | Electron main: window, permissions, Whisper IPC handler |
| `electron/preload.cjs` | Exposes `electronAPI.transcribe()` to renderer |
| `scripts/copy-wasm.js` | Copies ONNX WASM files to `public/` on `npm install` |
| `hamza.md` | Hamza's identity, room descriptions, operating principles |
| `knowledge.md` | Everything Hamza knows about Tayyab (personal profile) |
| `Tayyab Review/review.md` | Full change log across all sessions |

---

## Key Decisions

- **No inline `<style>` tags** — all CSS lives in `index.css`, including VoiceButton keyframes
- **`memoriesRef`** mirrors `notesRef` — both exist so async callbacks (streaming, extraction) always read latest state without stale closures
- **`extractMemory` is always fire-and-forget** — never awaited, wrapped in silent `try/catch`. Memory failures must never be user-visible.
- **`retry()`** calls `send(lastUserMsg.content)` directly. `send()` filters error messages out of `activeMsgs` when retrying (`retryText` flag), so the error message never re-appears during the new stream.
- **`--kill-others-on-fail`** on concurrently — if Vite crashes, Electron dies with it instead of running blank
