import { app, BrowserWindow, session, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

app.commandLine.appendSwitch('use-fake-ui-for-media-stream', 'false');

// ─── Whisper in main process (Node.js → onnxruntime-node, no WASM browser issues) ───

let _transcriber = null;
let _loadPromise = null;

async function getTranscriber() {
  if (_transcriber) return _transcriber;
  if (!_loadPromise) {
    _loadPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      _transcriber = t;
      return t;
    })();
    _loadPromise.catch(() => { _loadPromise = null; });
  }
  return _loadPromise;
}

// Start loading model in background when app starts
app.whenReady().then(() => getTranscriber().catch(() => {}));

ipcMain.handle('whisper-transcribe', async (_event, audioArray) => {
  const transcriber = await getTranscriber();
  const float32 = Float32Array.from(audioArray);
  const result = await transcriber(float32, { sampling_rate: 16000 });
  return result?.text?.trim() || '';
});

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    title: 'Hamza',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true);
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
