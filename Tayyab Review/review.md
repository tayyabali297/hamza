# Tayyab Review — Full Change Log

Everything that was built across all sessions. Written to keep a clear record of what changed, why, and how it works.

---

## Session 1 — Core Improvements

### 1. Streaming Responses

**Before:** The app waited for the full response before showing anything. Up to 10 seconds of staring at dots.

**After:** Text appears word by word as Claude generates it. The API call uses `stream: true` and reads Server-Sent Events line by line:

```js
body: JSON.stringify({ model, max_tokens, messages, stream: true })
```

A placeholder message is added immediately, then updated on every incoming chunk via the `onChunk` callback. The tricky part was buffering — network chunks don't arrive on clean line boundaries, so incomplete lines are held in a `buffer` variable until the next chunk fills them in.

### 2. Markdown Rendering

**Before:** Claude's replies showed raw markdown characters (`**bold**`, `- list item`).

**After:** Responses are rendered through `react-markdown` with a custom `.md-content` CSS class. Bold, lists, code blocks, headers, and links all render correctly. User messages stay as plain text.

### 3. Retry Button

**Before:** If the API failed, you had to retype your message.

**After:** Failed responses get an `error: true` flag. A "↻ Retry" button appears and re-sends the last user message automatically. The error message is filtered out before retrying so it doesn't reappear during the new streaming response.

### 4. Delete Confirmation

Added `window.confirm('Delete this conversation?')` before deleting a chat. One accidental click no longer loses a conversation.

### 5. Styles Moved to `index.css`

All CSS was extracted from an inline `<style>` block in the old monolithic file into `src/index.css`. Consistent, easier to find.

### 6. Inter Font

Added Inter from Google Fonts for a cleaner, more intentional look. Falls back to system font if offline.

---

## Session 2 — Persistent Local Memory

### How it works

After every substantive AI response (>100 chars), a silent background call is made to Claude Haiku. It reads the exchange and extracts 0–3 important personal facts about the user. Results are stored in `localStorage` under the key `hx_memories`.

```js
// Each memory entry:
{ id, text, date, chatId, room }
```

Up to 150 memories are kept. Oldest drop off when the cap is hit.

### Injection

Every time a message is sent, the last 40 memories are formatted into the system prompt:

```
MEMORY LOG (oldest to newest): [15 May] User feels anxious before exams | [18 May] User decided to cut back on gym...
```

This gives Claude up to 1500 characters of memory context on top of the existing personal profile. Claude naturally connects patterns across conversations — if anxiety was mentioned three times across different rooms and different days, it notices.

### Memory view

The Memory page is now split into two sections:

1. **Learned memories** — auto-extracted cards with date badges and individual × delete buttons. "Clear all" button at the top right.
2. **Pinned notes** — the original freeform textarea, still there for things you want to manually lock in.

### Notification

When new memories are saved, a subtle `◆ Memory updated` notification fades in at the bottom-right for 2.5 seconds, then disappears.

---

## Session 3 — Simplifications (no feature changes)

Five genuine code issues cleaned up:

### 1. Shared API headers constant

The Anthropic request headers were written twice — once in `callAPIStreaming` and again in `extractMemory`. Now a single `ANTHROPIC_HEADERS` constant at the top of `App.jsx` is used by both. If the API version ever changes, one update covers everything.

### 2. VoiceButton CSS moved to `index.css`

The voice button had an inline `<style>` tag that re-injected CSS on every render. Those rules (`.vbtn`, `pulse-mic` animation, `spin` animation) now live in `index.css` alongside all other styles.

### 3. Removed dead code in `electron/main.js`

`app.commandLine.appendSwitch('use-fake-ui-for-media-stream', 'false')` — this line did nothing. Chromium doesn't interpret switch values as booleans; the switch was present regardless of the `'false'` string. Removed.

### 4. Removed duplicate permission handler in `electron/main.js`

`session.defaultSession.setPermissionRequestHandler()` was being called twice — once before the window was created and again on `win.webContents.session`. These are the same object in Electron unless a custom session is created. The second call was removed.

### 5. Added `--kill-others-on-fail` to dev script

```json
"dev": "concurrently --kill-others-on-fail \"vite\" \"wait-on tcp:5173 && electron .\""
```

Previously, if Vite crashed (port conflict, syntax error), Electron kept running with a blank screen. Now both processes die cleanly together.

---

## File Map

| File | What it does |
|------|-------------|
| `src/App.jsx` | Everything — state, chat logic, streaming, memory, UI |
| `src/rooms.js` | Room definitions, system prompt builder, memory injection |
| `src/index.css` | All styles including VoiceButton (moved from inline) |
| `src/Avatar.jsx` | Pixel art avatar rendered as SVG |
| `src/VoiceButton.jsx` | Voice recording → Whisper transcription via Electron IPC |
| `src/main.jsx` | React entry point |
| `src/context.js` | Public template for personal context |
| `src/context.local.js` | Real personal context (gitignored — never committed) |
| `electron/main.js` | Electron main process, window, Whisper IPC handler |
| `electron/preload.cjs` | Exposes `electronAPI.transcribe()` to renderer |
| `index.html` | HTML shell, loads Inter font |
| `vite.config.js` | Vite build config |
| `package.json` | Scripts and dependencies |
| `scripts/copy-wasm.js` | Copies ONNX WASM files to `public/` after install |

---

## Session 4 — Voice Fix, Chat Naming, Memory Cleanup, UI Polish

### 1. Voice Transcription: Long Recording Fix + Live Preview

**Before:** The entire recording (however long) was sent to Whisper as one blob at the end. Whisper-tiny has a ~30-second context limit, so 2-3 minute recordings produced garbage or truncated output. There was no feedback while recording.

**After:** `VoiceButton.jsx` now processes audio in 10-second rolling segments during recording. Every 10 seconds, only the new-since-last-call chunks are resampled and sent to Whisper. The result is appended to the growing transcript and shown live in the input box. When the user clicks Stop, any remaining unprocessed chunks are transcribed and appended as a final pass.

Key implementation details:
- `processedCountRef` tracks how many chunks have already been sent, preventing double-transcription.
- `clearInterval()` is called at the top of `stop()` before anything else, so the interval and the final pass never race.
- The `onAutoSubmit` auto-send was removed — user reviews the accumulated text and sends manually.
- Status label updated to `'recording — click to stop'`.

### 2. Auto-Name Chats + Pencil Icon Rename

**Before:** New chats were named `"Chat 1"`, `"Chat 2"`, etc. The rename button was a dim text label.

**After:** After the first AI response in a new chat, a background Haiku call generates a 3-5 word title and updates the chat name. The update is guarded: if the user has already manually renamed the chat (name no longer matches `/^Chat \d+$/`), the auto-name is discarded. The rename text button is now a small pencil SVG icon (visible on hover, same dim-to-bright color transition).

`autoNameChat()` is fire-and-forget, wrapped in a silent try/catch — naming failures are never user-visible. Triggered in `send()` when `fa.length === 2` (exactly one exchange).

### 3. Delete Chat → Also Deletes Memories + localStorage

**Before:** Deleting a chat removed it from the chat list but left orphaned messages (`hm_{id}`), API history (`ha_{id}`), and any memories extracted from that conversation in localStorage.

**After:** `deleteChat()` now also:
- `localStorage.removeItem('hm_' + id)` and `localStorage.removeItem('ha_' + id)`
- Filters `memoriesRef.current` to remove entries with `chatId === id`, saves the updated list
- Clears `msgCache` and `apiCache` entries for that ID (frees React memory for long-running sessions)

### 4. Speaker Button: White Outline, Glossy

**Before:** Speaker SVG used dark fill (`#2a2a2a`), invisible against the dark UI. Button was fully transparent (`opacity: 0`) until hover.

**After:**
- SVG paths changed to `fill="none"` with `stroke="rgba(255,255,255,0.55)"` — outlined white appearance.
- Wave bars (active/speaking state) changed from `#666` to `rgba(255,255,255,0.7)`.
- `.speak-btn` CSS: default `opacity: 0.35` (subtly visible at rest), hover shows full opacity + glass background `rgba(255,255,255,0.06)`.

### 5. TTS Voice: Deeper, Warmer

**Before:** `pickVoice()` tried Microsoft George first. `rate: 0.88`, `pitch: 0.92`.

**After:** Voice priority is now Ryan (deep British) → Christopher → Eric → Guy → George → fallbacks. Speech parameters: `rate: 0.83`, `pitch: 0.85` — slower and lower for a more cozy, deliberate delivery.
