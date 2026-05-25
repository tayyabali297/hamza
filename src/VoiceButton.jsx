import { useState, useRef, useEffect } from 'react';

// ─── Audio helper ─────────────────────────────────────────────────────────────

// Converts a webm/opus Blob → plain Array of Float32 samples at 16 kHz
async function blobToAudioArray(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  const decodeCtx = new AudioContext();
  const decoded   = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const TARGET_SR  = 16000;
  const numFrames  = Math.round(decoded.duration * TARGET_SR);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SR);
  const src        = offlineCtx.createBufferSource();
  src.buffer       = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);

  const resampled = await offlineCtx.startRendering();
  return Array.from(resampled.getChannelData(0));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceButton({ onTranscript, disabled }) {
  const [phase,  setPhase]  = useState('idle'); // idle | recording | processing
  const [errMsg, setErrMsg] = useState('');

  const recorderRef       = useRef(null);
  const chunksRef         = useRef([]);
  const streamRef         = useRef(null);
  const accumulatedRef    = useRef('');   // running transcription text
  const processedCountRef = useRef(0);   // chunks already transcribed
  const intervalRef       = useRef(null);
  const segLockRef        = useRef(false); // prevents concurrent segment processing

  // Auto-clear error after 6 s
  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(''), 6000);
    return () => clearTimeout(t);
  }, [errMsg]);

  // Transcribe only new chunks since last call, append to accumulated text
  async function processSegment() {
    if (segLockRef.current) return; // already processing a segment
    const allChunks = chunksRef.current;
    const newChunks = allChunks.slice(processedCountRef.current);
    if (newChunks.length === 0) return;

    segLockRef.current = true;
    const nextCount = allChunks.length;

    const blob = new Blob(newChunks, { type: 'audio/webm' });
    if (blob.size < 500) { segLockRef.current = false; return; }

    try {
      const audioArray = await blobToAudioArray(blob);
      const text = await window.electronAPI.transcribe(audioArray);
      processedCountRef.current = nextCount; // advance only on success
      if (text) {
        accumulatedRef.current = accumulatedRef.current
          ? accumulatedRef.current + ' ' + text
          : text;
        onTranscript(accumulatedRef.current.trim());
      }
    } catch (err) {
      console.warn('[VoiceButton] segment error:', err);
    } finally {
      segLockRef.current = false;
    }
  }

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
    chunksRef.current         = [];
    accumulatedRef.current    = '';
    processedCountRef.current = 0;
    segLockRef.current        = false;

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(250);
    recorderRef.current = recorder;

    // Process audio in 10-second segments for live preview
    intervalRef.current = setInterval(processSegment, 10000);
    setPhase('recording');
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    // Stop periodic transcription immediately
    clearInterval(intervalRef.current);
    intervalRef.current = null;

    setPhase('processing');

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach(t => t.stop());

      try {
        const remaining = chunksRef.current.slice(processedCountRef.current);

        if (remaining.length > 0) {
          const blob = new Blob(remaining, { type: 'audio/webm' });
          if (blob.size >= 500) {
            const audioArray = await blobToAudioArray(blob);
            const text = await window.electronAPI.transcribe(audioArray);
            if (text) {
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + text
                : text;
            }
          }
        }

        if (accumulatedRef.current) {
          onTranscript(accumulatedRef.current.trim());
          // No auto-submit — user reviews the transcribed text before sending
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
    isProcessing ? 'finishing transcription...' :
    isRecording  ? 'recording — click to stop' :
                   'voice input';

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>

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
