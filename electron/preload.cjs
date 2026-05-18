// preload.cjs — CommonJS so it works regardless of "type":"module" in package.json
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Sends a plain Float32 array to main process, returns transcribed text
  transcribe: (audioArray) => ipcRenderer.invoke('whisper-transcribe', audioArray),
});
