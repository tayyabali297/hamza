import { useState, useRef, useEffect } from 'react';

// ─── Audio helper ─────────────────────────────────────────────────────────────

// Converts a webm/opus Blob → plain Array of Float32 samples at 16 kHz
async function blobToAudioArray(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode the raw audio using the browser's native decoder
  const decodeCtx = new AudioContext();
  const decoded   = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  // Resample to 16000 Hz (what Whisper needs)
  const TARGET_SR  = 16000;
  const numFrames  = Math.round(decoded.duration * TARGET_SR);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SR);
  const src        = offlineCtx.createBufferSource();
  src.buffer       = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);

  const resampled = await offlineCtx.startRendering();
  // Convert Float32Array → plain Array so IPC can serialize it
  return Array.from(resampled.getChannelData(0));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceButton({ onTranscript, onAutoSubmit, disabled }) {
  const [phase,  setPhase]  = useState('idle'); // idle | recording | processing
  const [errMsg, setErrMsg] = useState('');

  const recorderRef = useRef(null);
  const chunksRef   = useRef([]);
  const streamRef   = useRef(null);

  // Auto-clear error after 6 s
  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(''), 6000);
    return () => clearTimeout(t);
  }, [errMsg]);

  async function start() {
    setErrMsg('');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      setErrMsg('Mic: ' + (err.message || err.name));
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(250);
    recorderRef.current = recorder;
    setPhase('recording');
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    setPhase('processing');

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach(t => t.stop());

      try {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        if (blob.size < 500) {
          setPhase('idle');
          return;
        }

        // Resample audio in renderer (uses browser AudioContext)
        const audioArray = await blobToAudioArray(blob);

        // Whisper runs in the Electron main process (onnxruntime-node)
        const text = await window.electronAPI.transcribe(audioArray);

        if (text) {
          onTranscript(text);
          setTimeout(() => onAutoSubmit?.(), 150);
        }
      } catch (err) {
        const msg = err?.message || String(err);
        setErrMsg(msg.length > 55 ? msg.slice(0, 55) + '…' : msg);
        console.error('[VoiceButton]', err);
      }

      setPhase('idle');
    };

    recorder.stop();
  }

  function toggle() {
    if (phase === 'recording') stop();
    else if (phase === 'idle') start();
  }

  const isRecording  = phase === 'recording';
  const isProcessing = phase === 'processing';

  const statusLabel =
    isProcessing ? 'transcribing...' :
    isRecording  ? 'recording — click to send' :
                   'voice input';

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <style>{`
        @keyframes pulse-mic {
          0%   { box-shadow: 0 0 0 0px rgba(200,50,50,0.35); }
          70%  { box-shadow: 0 0 0 9px rgba(200,50,50,0); }
          100% { box-shadow: 0 0 0 0px rgba(200,50,50,0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .vbtn {
          width: 30px; height: 30px; border-radius: 4px; border: none;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; background: transparent; transition: background 0.15s;
          cursor: pointer;
        }
        .vbtn:hover:not(:disabled) { background: #141414; }
        .vbtn.rec  { animation: pulse-mic 1.2s ease-out infinite; background: #140606; }
        .vbtn:disabled { cursor: not-allowed; opacity: 0.35; }
      `}</style>

      <button
        className={`vbtn${isRecording ? ' rec' : ''}`}
        onClick={toggle}
        disabled={disabled || isProcessing}
        title={statusLabel}
      >
        {isProcessing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="9" stroke="#333" strokeWidth="2"
              strokeDasharray="42" strokeDashoffset="12" strokeLinecap="round" />
          </svg>
        ) : isRecording ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="5" width="14" height="14" rx="2" fill="#cc3030" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="11" rx="3" stroke="#3a3a3a" strokeWidth="2" />
            <path d="M5 10a7 7 0 0014 0" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="21" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
            <line x1="9"  y1="21" x2="15" y2="21" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {(errMsg || isRecording || isProcessing) && (
        <div style={{
          position: 'absolute', bottom: '38px', left: '50%', transform: 'translateX(-50%)',
          background: errMsg ? '#180808' : '#0c0c0c',
          border: `1px solid ${errMsg ? '#2a0a0a' : '#1a1a1a'}`,
          borderRadius: '3px', padding: '4px 9px', fontSize: '10px',
          color: errMsg ? '#884040' : '#3a3a3a',
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 100,
        }}>
          {errMsg || statusLabel}
        </div>
      )}
    </div>
  );
}
