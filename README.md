# Hamza — Personal AI Life Assistant

A desktop app that puts a deeply personalised AI advisor on your computer. You write a context file describing who you are — your goals, patterns, projects, values — and the AI uses that as its permanent memory in every conversation. No cloud sync, no subscriptions beyond the API, everything runs locally.

Built with Electron + React. Voice input runs fully on-device using Whisper. All conversations are stored in localStorage.

---

## What it looks like

- Black/white minimal design, pixel art avatar
- Sidebar with 6 rooms (customisable), each with unlimited renameable chat threads
- Fast mode (Claude Haiku — cheap, instant) or Deep mode (Claude Sonnet — slower, more nuanced)
- Mic button that records, transcribes locally, and submits automatically
- Speaker button on every AI message for text-to-speech
- Memory page for runtime notes the AI references mid-conversation

---

## How the personalisation works

The core idea: your personal context is injected as the first message of every conversation, not as a system prompt. This avoids Claude's system prompt caching and makes the AI feel like it already knows you.

In `src/context.local.js` (gitignored, never committed), you write a plain text description of yourself in whatever format you want. Something like:

```
You are [name], personal advisor to [your name] ([age], [location]).

WHO I AM: [personality, communication style, how you process problems]

WHAT I'M BUILDING: [projects, current status, blockers]

MY PATTERNS: [recurring behaviours you want called out]
  - [Pattern]: [description]

GOALS: [what you're actually trying to achieve]

YOUR BEHAVIOUR: Direct. Honest. Not a yes-man. [any other tone instructions]
```

This gets prepended to every API call as:
```json
{ "role": "user",      "content": "Instructions: [your full context]" },
{ "role": "assistant", "content": "Understood. I am Hamza." }
```

The result is an AI that remembers everything about you without you having to re-explain yourself every session.

---

## Tech stack

| Layer | Tech | Why |
|---|---|---|
| Desktop shell | Electron 34 | Cross-platform, native window, mic access |
| UI | React 18 + Vite 5 | Fast dev, simple component model |
| AI (Fast) | Claude Haiku (`claude-haiku-4-5-20251001`) | Cheap, instant replies for quick questions |
| AI (Deep) | Claude Sonnet (`claude-sonnet-4-6`) | Better reasoning for emotional/complex topics |
| Voice input | @xenova/transformers — Whisper tiny.en | Fully local, no API key, ~40MB model |
| ONNX runtime | onnxruntime-node (via main process IPC) | Avoids browser WASM issues in Electron |
| TTS | Web Speech API (`window.speechSynthesis`) | Built into Chromium, no extra dependencies |
| Persistence | localStorage | Simple, zero-config, local-only |
| Packaging | electron-builder | Portable Windows .exe |

---

## Project structure

```
hamza/
├── electron/
│   ├── main.js          # Electron main process
│   │                    #   - Creates BrowserWindow
│   │                    #   - Handles mic permissions
│   │                    #   - Loads Whisper model via @xenova/transformers (Node.js)
│   │                    #   - IPC handler: 'whisper-transcribe'
│   └── preload.cjs      # contextBridge — exposes electronAPI.transcribe() to renderer
│
├── src/
│   ├── App.jsx          # Entire UI + state
│   │                    #   - Sidebar, chat list, chat view, memory view
│   │                    #   - callAPI() — fetch to Anthropic with correct headers
│   │                    #   - speak() — TTS using speechSynthesis
│   │                    #   - localStorage read/write for all state
│   │
│   ├── Avatar.jsx       # Pixel art avatar rendered as SVG rects
│   │                    #   - 17×14 grid, 4-colour palette, scalable via `sz` prop
│   │
│   ├── VoiceButton.jsx  # Mic button component
│   │                    #   - Records audio with MediaRecorder
│   │                    #   - Resamples to 16kHz Float32 using AudioContext
│   │                    #   - Sends to main process via window.electronAPI.transcribe()
│   │                    #   - Auto-submits after successful transcription
│   │
│   ├── rooms.js         # Room config + system prompt builder
│   │                    #   - CATS: array of room definitions
│   │                    #   - OPENERS: first message shown in each room
│   │                    #   - ADDONS: room-specific additions to the base prompt
│   │                    #   - getSys(): builds full prompt for a given room
│   │                    #   - buildMessages(): wraps user messages with context injection
│   │
│   ├── context.js       # Template — fill this in with your own info (committed)
│   ├── context.local.js # YOUR actual context — gitignored, never pushed
│   │
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles (minimal)
│
├── scripts/
│   └── copy-wasm.js     # postinstall script — copies onnxruntime-web WASM files
│                        # from node_modules to public/ so Vite can serve them
│
├── public/              # WASM files (auto-copied on npm install)
├── .env                 # Your API key — gitignored
├── .env.example         # Template
├── vite.config.js
└── package.json
```

---

## Setup

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and install

```bash
git clone https://github.com/tayyabali297/hamza.git
cd hamza
npm install
```

The postinstall script copies ONNX WASM files to `public/` automatically.

### 2. Add your API key

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_ANTHROPIC_API_KEY=your_key_here
```

### 3. Set up your personal context

Copy the template:
```bash
cp src/context.js src/context.local.js
```

Open `src/context.local.js` and replace the placeholder text with your actual information. This is the most important step — the quality of this file determines how well the AI knows you. See [Writing your context](#writing-your-context) below.

### 4. Run in development

```bash
npm run dev
```

Opens the Electron window. The first time you use voice input, the Whisper model (~40MB) will download and cache automatically.

### 5. Build a desktop app

```bash
npm run package
```

Creates `release/win-unpacked/Hamza.exe`. Right-click → **Send to → Desktop (create shortcut)** for a desktop icon.

> Note: electron-builder will fail at the code-signing step on Windows without admin privileges — this is fine. The app is fully built and usable in `release/win-unpacked/` before that step runs.

---

## Writing your context

`src/context.local.js` exports a single string called `BASE`. This is injected into every conversation. Write it in plain English — no special format required. The more specific you are, the better.

Things worth including:

**Identity**
- Name, age, location, background
- How you communicate (direct? need softening? respond well to pushback?)
- How you process problems (out loud? analytically? emotionally first?)

**What you're working on**
- Projects with current status, blockers, key decisions pending
- Work or studies with specific areas of struggle

**Your patterns** (this is the most valuable section)
- Recurring behaviours that get in your way
- Name them specifically so the AI can call them out by name mid-conversation
- Example: "Overthinks before executing, especially on outreach tasks"

**Goals**
- Not vague aspirations — the actual thing you're trying to change about yourself or build

**Tone instructions**
- How you want the AI to behave: how direct, when to push back, when to just listen

**Example structure:**

```js
export const BASE = `You are [assistant name], personal advisor to [your name].
Your role: [one sentence on the relationship dynamic — e.g. "older sibling, direct, warm, honest"].

WHO I AM: [2-4 sentences on personality, communication style, how you respond to feedback]

WHAT I'M BUILDING:
- [Project]: [stack, status, what's actually blocking progress]
- [Other commitments]

PATTERNS TO CALL OUT:
- [Pattern name]: [specific description of when it shows up]
When you spot a pattern — name it. "[Pattern name]. What can you actually control here?"

GOALS: [concrete, behavioural goals — not "be more confident" but "approach situations X without seeking approval first"]

YOUR BEHAVIOUR: [tone, when to push, when to listen, what you never want it to do]`;
```

---

## Customising the rooms

Edit the `CATS` array in `src/rooms.js`:

```js
export const CATS = [
  { id: 'general',   label: 'Everything', sub: 'Life, decisions, anything on your mind' },
  { id: 'work',      label: 'Work',       sub: 'Projects, clients, strategy' },
  { id: 'health',    label: 'Health',     sub: 'Fitness, sleep, habits' },
  // ... add or change rooms as you like
];
```

Each room can have its own OPENER (the first message shown) and ADDON (extra instruction appended to the base prompt for that room):

```js
const ADDONS = {
  work: ' ROOM: Work. Be strategic and direct. Ask what the actual blocker is.',
  health: ' ROOM: Health. Evidence-based. No pseudoscience.',
};
```

To make certain rooms auto-switch to Deep mode:
```js
export const DEEP_ROOMS = ['emotional', 'spiritual']; // or whichever rooms you want
```

---

## How voice input works

1. `VoiceButton.jsx` records audio with `MediaRecorder` (webm/opus format)
2. When stopped, `AudioContext.decodeAudioData()` decodes the audio
3. `OfflineAudioContext` resamples to 16000 Hz mono (what Whisper expects)
4. The Float32Array is sent to the Electron main process via IPC
5. In `electron/main.js`, `@xenova/transformers` runs Whisper tiny.en using `onnxruntime-node` (Node.js native binary — no browser WASM)
6. The transcribed text comes back to the renderer and auto-submits

Running Whisper in the main process (Node.js) instead of the renderer avoids the ONNX/WASM path issues that come with running ML models in Electron's Chromium context.

**First use:** the model downloads to your OS cache (~40MB). Subsequent uses load from cache instantly.

---

## API and cost

The app calls the Anthropic API directly from the renderer using the `anthropic-dangerous-direct-browser-access: true` header. This is intentional — it's a local desktop app with no backend server.

Approximate costs (as of 2025):
- **Haiku** (Fast mode): ~$0.001 per conversation — essentially free for personal use
- **Sonnet** (Deep mode): ~$0.01–0.03 per conversation depending on length

Voice transcription is free — it runs locally.

---

## Adding to a different OS

The `package.json` build config targets Windows portable. For macOS or Linux, change the `win` section:

```json
"build": {
  "mac": { "target": "dmg" },
  "linux": { "target": "AppImage" }
}
```

---

## Privacy

- Your API key lives in `.env` — gitignored
- Your personal context lives in `src/context.local.js` — gitignored  
- All conversations are stored in `localStorage` on your machine only
- Voice audio is processed locally — never sent anywhere
- The only outbound traffic is to `api.anthropic.com` for AI responses
