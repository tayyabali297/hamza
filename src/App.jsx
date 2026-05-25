import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { CATS, DEEP_ROOMS, OPENERS, getSys, buildMessages } from './rooms';
import Avatar from './Avatar';
import VoiceButton from './VoiceButton';

// ─── Storage ──────────────────────────────────────────────────────────────────
// Simple wrappers around localStorage. Try/catch so the app never crashes
// if storage is full or unavailable.

function sget(k) {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; }
}
function sset(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkid()    { return 'c' + Date.now() + Math.random().toString(36).slice(2, 5); }
function ftime()   { return new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' }); }
function fdate(ts) { return new Date(ts).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }); }

// ─── Streaming API ────────────────────────────────────────────────────────────
// Instead of waiting for the full response, we read chunks as they arrive.
// This makes the AI feel much faster because text appears word-by-word.
// The `onChunk` callback gets called with each new piece of text.

const ANTHROPIC_HEADERS = {
  'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'Content-Type': 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
};

async function callAPIStreaming(userMessages, sys, deep, onChunk) {
  const messages   = buildMessages(userMessages, sys);
  const model      = deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const max_tokens = deep ? 1200 : 500;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: ANTHROPIC_HEADERS,
      body: JSON.stringify({ model, max_tokens, messages, stream: true }),
    });
  } catch (err) {
    throw new Error('Network error: ' + err.message);
  }

  if (!res.ok) {
    // If streaming fails, try to read the error message
    let errText = 'HTTP ' + res.status;
    try { const d = await res.json(); errText = d.error?.message || errText; } catch {}
    throw new Error(errText);
  }

  // Read the stream line by line
  // Anthropic sends Server-Sent Events (SSE) — each line starts with "data: "
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines from the buffer
    const lines = buffer.split('\n');
    // Keep the last incomplete line in the buffer
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6); // Remove "data: " prefix
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        // Anthropic sends "content_block_delta" events with the text
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onChunk(fullText); // Update the UI with what we have so far
        }
      } catch {
        // Skip lines that aren't valid JSON (like event: lines)
      }
    }
  }

  if (!fullText) throw new Error('Empty response from API');
  return fullText;
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return (
    voices.find(v => v.name === 'Microsoft Ryan - English (United Kingdom)') ||
    voices.find(v => v.name === 'Microsoft Christopher - English (United States)') ||
    voices.find(v => v.name === 'Microsoft Eric - English (United States)') ||
    voices.find(v => v.name === 'Microsoft Guy - English (United States)') ||
    voices.find(v => v.name === 'Microsoft George - English (United Kingdom)') ||
    voices.find(v => v.name.includes('Ryan') || v.name.includes('Christopher') || v.name.includes('Eric')) ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang.startsWith('en')) ||
    null
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [catId,      setCatId]      = useState('general');
  const [chatLists,  setChatLists]  = useState({});
  const [openChatId, setOpenChatId] = useState({});
  const [msgCache,   setMsgCache]   = useState({});
  const [apiCache,   setApiCache]   = useState({});
  const [notes,      setNotes]      = useState('');
  const [memories,   setMemories]   = useState([]);
  const [memNotif,   setMemNotif]   = useState(false);
  const [view,       setView]       = useState('list');
  const [sidebar,    setSidebar]    = useState(true);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [editName,   setEditName]   = useState('');
  const [lastErr,    setLastErr]    = useState('');
  const [deepMode,   setDeepMode]   = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [inputFocus, setInputFocus] = useState(false);

  const bottomRef   = useRef(null);
  const inputRef    = useRef(null);
  const notesRef    = useRef('');
  const memoriesRef = useRef([]);
  const sendFnRef   = useRef(null);
  notesRef.current   = notes;
  memoriesRef.current = memories;

  // Auto-toggle deep on room switch
  useEffect(() => {
    setDeepMode(DEEP_ROOMS.includes(catId));
  }, [catId]);

  // Stop TTS when switching rooms or chats
  useEffect(() => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, [catId, openChatId]);

  // Load from localStorage
  useEffect(() => {
    const cl = {};
    for (const c of CATS) cl[c.id] = sget('hcl_' + c.id) || [];
    setChatLists(cl);
    setNotes(sget('hn') || '');
    setMemories(sget('hx_memories') || []);
    setLoaded(true);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgCache, loading, view, catId]);

  const activeCat    = CATS.find(c => c.id === catId);
  const activeChatId = openChatId[catId] || null;
  const activeMsgs   = activeChatId ? (msgCache[activeChatId] || []) : [];
  const activeApi    = activeChatId ? (apiCache[activeChatId] || []) : [];
  const activeChat   = (chatLists[catId] || []).find(c => c.id === activeChatId);

  // ── TTS ───────────────────────────────────────────────────────────────────

  function speak(text, msgKey) {
    if (!window.speechSynthesis) return;
    if (speakingId === msgKey) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utt.voice = voice;
    utt.lang   = 'en-GB';
    utt.rate   = 0.83;
    utt.pitch  = 0.85;
    utt.volume = 1;
    utt.onend  = () => setSpeakingId(null);
    utt.onerror = () => setSpeakingId(null);
    setSpeakingId(msgKey);
    window.speechSynthesis.speak(utt);
  }

  // ── Chat actions ──────────────────────────────────────────────────────────

  function newChat() {
    const id     = mkid();
    const list   = chatLists[catId] || [];
    const name   = 'Chat ' + (list.length + 1);
    const opener = { role: 'assistant', content: OPENERS[catId], time: '—' };
    const entry  = { id, name, created: Date.now(), preview: OPENERS[catId].slice(0, 50) + '…' };
    const nl     = [entry, ...list];
    setChatLists(p => ({ ...p, [catId]: nl }));
    setMsgCache(p => ({ ...p, [id]: [opener] }));
    setApiCache(p => ({ ...p, [id]: [] }));
    setOpenChatId(p => ({ ...p, [catId]: id }));
    setView('chat');
    sset('hcl_' + catId, nl);
    sset('hm_' + id, [opener]);
    sset('ha_' + id, []);
  }

  function openChat(id) {
    if (!msgCache[id]) {
      setMsgCache(p => ({ ...p, [id]: sget('hm_' + id) || [] }));
      setApiCache(p => ({ ...p, [id]: sget('ha_' + id) || [] }));
    }
    setOpenChatId(p => ({ ...p, [catId]: id }));
    setView('chat');
  }

  function deleteChat(id, e) {
    e.stopPropagation();
    // Simple confirmation so you don't accidentally delete chats
    if (!window.confirm('Delete this conversation?')) return;
    const nl = (chatLists[catId] || []).filter(c => c.id !== id);
    setChatLists(p => ({ ...p, [catId]: nl }));
    if (openChatId[catId] === id) {
      setOpenChatId(p => ({ ...p, [catId]: null }));
      setView('list');
    }
    sset('hcl_' + catId, nl);
    localStorage.removeItem('hm_' + id);
    localStorage.removeItem('ha_' + id);
    const updatedMems = memoriesRef.current.filter(m => m.chatId !== id);
    setMemories(updatedMems);
    sset('hx_memories', updatedMems);
    setMsgCache(p => { const n = { ...p }; delete n[id]; return n; });
    setApiCache(p => { const n = { ...p }; delete n[id]; return n; });
  }

  function saveRename(id) {
    const nl = (chatLists[catId] || []).map(c =>
      c.id === id ? { ...c, name: editName.trim() || c.name } : c
    );
    setChatLists(p => ({ ...p, [catId]: nl }));
    setEditId(null);
    setEditName('');
    sset('hcl_' + catId, nl);
  }

  async function autoNameChat(chatId, firstUserMsg, roomCatId) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: ANTHROPIC_HEADERS,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 30,
          messages: [{ role: 'user', content: `Give this conversation a 3-5 word title. Just the title, nothing else.\n\nUser said: "${firstUserMsg.slice(0, 200)}"` }],
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const title = data.content?.[0]?.text?.trim().replace(/^["']|["']$/g, '');
      if (!title || title.length > 60) return;
      setChatLists(prev => {
        const existing = (prev[roomCatId] || []).find(c => c.id === chatId);
        if (!existing || !existing.name.match(/^Chat \d+$/)) return prev;
        const updated = (prev[roomCatId] || []).map(c =>
          c.id === chatId ? { ...c, name: title } : c
        );
        sset('hcl_' + roomCatId, updated);
        return { ...prev, [roomCatId]: updated };
      });
    } catch {
      // silent — auto-naming is best-effort
    }
  }

  // ── Send (with streaming) ────────────────────────────────────────────────
  // This is the main function that sends your message and gets the AI reply.
  // It now uses streaming so text appears as it's generated.

  async function send(retryText) {
    const text = retryText || input.trim();
    if (!text || loading || !activeChatId) return;

    const uiMsg = { role: 'user', content: text, time: ftime() };
    const newM  = retryText ? activeMsgs.filter(m => !m.error) : [...activeMsgs, uiMsg];
    const newA  = retryText ? activeApi  : [...activeApi, { role: 'user', content: text }];

    setMsgCache(p => ({ ...p, [activeChatId]: newM }));
    setApiCache(p => ({ ...p, [activeChatId]: newA }));
    if (!retryText) setInput('');
    setLoading(true);
    setLastErr('');

    // Update preview in chat list
    const ul = (chatLists[catId] || []).map(c =>
      c.id === activeChatId
        ? { ...c, preview: text.slice(0, 50) + (text.length > 50 ? '…' : '') }
        : c
    );
    setChatLists(p => ({ ...p, [catId]: ul }));
    sset('hcl_' + catId, ul);

    // Add a placeholder message that will be updated as chunks arrive
    const placeholderMsg = { role: 'assistant', content: '', time: ftime() };
    setMsgCache(p => ({ ...p, [activeChatId]: [...newM, placeholderMsg] }));

    try {
      const reply = await callAPIStreaming(
        newA,
        getSys(catId, notesRef.current, memoriesRef.current),
        deepMode,
        // This callback runs every time a new chunk of text arrives
        (partialText) => {
          setMsgCache(p => ({
            ...p,
            [activeChatId]: [...newM, { ...placeholderMsg, content: partialText }],
          }));
        }
      );

      // Final update with complete text
      const aMsg = { role: 'assistant', content: reply, time: ftime() };
      const fm   = [...newM, aMsg];
      const fa   = [...newA, { role: 'assistant', content: reply }];
      setMsgCache(p => ({ ...p, [activeChatId]: fm }));
      setApiCache(p => ({ ...p, [activeChatId]: fa }));
      sset('hm_' + activeChatId, fm);
      sset('ha_' + activeChatId, fa);

      // Fire-and-forget memory extraction — runs in background, never blocks UI
      extractMemory(text, reply, catId, activeChatId);
      if (fa.length === 2) autoNameChat(activeChatId, text, catId);
    } catch (err) {
      setLastErr(err.message);
      // Mark the error message with a flag so we can show a retry button
      const em = { role: 'assistant', content: 'Something went wrong. Check the error bar above.', time: ftime(), error: true };
      setMsgCache(p => ({ ...p, [activeChatId]: [...newM, em] }));
    }

    setLoading(false);
    inputRef.current?.focus();
  }

  sendFnRef.current = send;

  // Retry: re-sends the last user message
  function retry() {
    const lastUserMsg = [...activeApi].reverse().find(m => m.role === 'user');
    if (lastUserMsg) send(lastUserMsg.content);
  }

  // ── Memory extraction ─────────────────────────────────────────────────────
  // Runs silently after each successful AI response. Uses Haiku to extract
  // 0-3 important personal facts from the exchange and stores them locally.

  async function extractMemory(userMsg, aiReply, roomId, chatId) {
    if (aiReply.length < 100) return; // skip trivial exchanges

    const recent = memoriesRef.current.slice(-20).map(m => m.text).join('; ') || 'none';

    const extractPrompt = `You extract personal facts for a memory system. From this conversation exchange, extract 0 to 3 important new personal facts about the user. Return ONLY a valid JSON array of short strings (each under 90 chars), or [] if nothing important.

Already known (do not repeat these): ${recent}

User said: "${userMsg.slice(0, 400)}"
Assistant replied: "${aiReply.slice(0, 600)}"

Rules:
- Only extract genuinely important personal facts: emotions, events, health, relationships, decisions, realisations, worries, plans, patterns
- Skip small talk, generic questions, facts already known above, or things that are temporary/trivial
- Write each fact as a short third-person statement: "User feels..." / "User mentioned..." / "User decided..."
- Return [] if nothing new and worth remembering

Return ONLY the JSON array, nothing else.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: ANTHROPIC_HEADERS,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 220,
          messages: [{ role: 'user', content: extractPrompt }],
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const raw  = data.content?.[0]?.text?.trim();
      if (!raw) return;

      // Extract JSON array from the response (handle any surrounding whitespace/text)
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return;
      const facts = JSON.parse(match[0]);
      if (!Array.isArray(facts) || facts.length === 0) return;

      // Build new memory entries
      const now = Date.now();
      const newEntries = facts
        .filter(f => typeof f === 'string' && f.trim().length > 5)
        .map(f => ({ id: mkid(), text: f.trim(), date: now, chatId, room: roomId }));

      if (newEntries.length === 0) return;

      // Functional update so concurrent extractions don't overwrite each other
      setMemories(prev => {
        const updated = [...prev, ...newEntries].slice(-150);
        sset('hx_memories', updated);
        return updated;
      });

      // Brief "Memory updated" notification
      setMemNotif(true);
      setTimeout(() => setMemNotif(false), 2500);
    } catch {
      // Silent failure — never show memory errors to the user
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // ── Loading screen ────────────────────────────────────────────────────────

  if (!loaded) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#2a2a2a', fontFamily: 'Inter, monospace', fontSize: '13px', animation: 'pulse 2s ease-in-out infinite' }}>loading...</span>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', background: '#0a0a0a', display: 'flex', color: '#ccc', fontSize: '14px', overflow: 'hidden' }}>

      {/* ── SIDEBAR ──────────────────────────────────────────────────────────── */}
      {sidebar && (
        <div className="sidebar-enter" style={{ width: '200px', minWidth: '200px', borderRight: '1px solid #111', background: '#060606', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Header / Avatar */}
          <div style={{ padding: '18px 14px 14px', borderBottom: '1px solid #111', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px',
              padding: '5px 5px 2px',
              animation: 'avatarBreathe 4s ease-in-out infinite',
            }}>
              <Avatar sz={3} />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#e8e8e8', letterSpacing: '-0.3px' }}>Hamza</div>
              <div style={{ fontSize: '10px', color: '#333', marginTop: '2px', letterSpacing: '0.5px' }}>personal advisor</div>
            </div>
          </div>

          {/* Rooms */}
          <div style={{ padding: '14px 6px 4px' }}>
            <div style={{ fontSize: '9px', color: '#2a2a2a', letterSpacing: '2px', textTransform: 'uppercase', paddingLeft: '12px', marginBottom: '6px', fontWeight: '600' }}>Rooms</div>
            {CATS.map(c => {
              const on  = catId === c.id && view !== 'memory';
              const cnt = (chatLists[c.id] || []).length;
              return (
                <button
                  key={c.id}
                  className={'sb' + (on ? ' on' : '')}
                  style={{ fontWeight: on ? '600' : '400' }}
                  onClick={() => { setCatId(c.id); setView('list'); }}
                >
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {DEEP_ROOMS.includes(c.id) && (
                    <span style={{ fontSize: '7px', color: on ? '#555' : '#2a2a2a' }}>◆</span>
                  )}
                  {cnt > 0 && (
                    <span style={{ fontSize: '10px', color: '#444', background: '#111', padding: '1px 6px', borderRadius: '8px' }}>{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ height: '1px', background: '#111', margin: '6px 12px' }} />

          {/* Memory */}
          <div style={{ padding: '0 6px 6px' }}>
            <button
              className={'sb' + (view === 'memory' ? ' on' : '')}
              onClick={() => setView('memory')}
            >
              Memory
            </button>
          </div>

          {/* Mode pill at bottom */}
          <div style={{ padding: '12px 14px 18px', marginTop: 'auto', borderTop: '1px solid #0e0e0e' }}>
            <div style={{ fontSize: '9px', color: '#2a2a2a', marginBottom: '8px', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: '600' }}>Active mode</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 10px', borderRadius: '6px',
              background: deepMode ? '#0d0d0d' : 'transparent',
              border: deepMode ? '1px solid #1a1a1a' : '1px solid transparent',
              transition: 'all 0.3s',
            }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: deepMode ? '#e0e0e0' : '#2a2a2a',
                display: 'inline-block', flexShrink: 0,
                transition: 'background 0.3s',
                animation: deepMode ? 'deepGlow 2s ease-in-out infinite' : 'none',
              }} />
              <div>
                <div style={{ fontSize: '11px', color: deepMode ? '#bbb' : '#444', transition: 'color 0.3s' }}>
                  {deepMode ? 'Deep · Sonnet' : 'Fast · Haiku'}
                </div>
                <div style={{ fontSize: '9px', color: '#2a2a2a', marginTop: '1px' }}>
                  {deepMode ? 'full depth' : 'quick replies'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #111', background: '#060606', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setSidebar(s => !s)}
            style={{ background: 'none', border: 'none', color: '#333', fontSize: '14px', padding: '3px 5px', borderRadius: '3px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#666'}
            onMouseLeave={e => e.currentTarget.style.color = '#333'}
          >&#9776;</button>

          {view === 'chat' && (
            <button
              onClick={() => setView('list')}
              style={{ background: 'none', border: 'none', color: '#444', fontSize: '12px', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#888'}
              onMouseLeave={e => e.currentTarget.style.color = '#444'}
            >&larr; {activeCat?.label}</button>
          )}

          <span style={{ color: '#555', fontWeight: '600', fontSize: '13px', letterSpacing: '-0.1px' }}>
            {view === 'list'  ? activeCat?.label
           : view === 'chat'  ? (activeChat?.name || 'Chat')
           : 'Memory'}
          </span>

          {/* Mode toggle */}
          <button
            className={'mode-btn' + (deepMode ? ' on' : '')}
            onClick={() => setDeepMode(d => !d)}
            style={{ marginLeft: 'auto' }}
            title={deepMode ? 'Deep (Sonnet) — click for Fast (Haiku)' : 'Fast (Haiku) — click for Deep (Sonnet)'}
          >
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: deepMode ? '#ccc' : '#2a2a2a',
              display: 'inline-block',
              transition: 'background 0.2s',
              animation: deepMode ? 'deepGlow 2s ease-in-out infinite' : 'none',
            }} />
            {deepMode ? 'Deep' : 'Fast'}
          </button>

          {/* Rename */}
          {view === 'chat' && (
            editId === activeChatId ? (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  saveRename(activeChatId);
                    if (e.key === 'Escape') setEditId(null);
                  }}
                  autoFocus
                  style={{ background: '#111', border: '1px solid #222', color: '#ccc', borderRadius: '4px', padding: '3px 8px', fontSize: '12px', width: '120px', fontFamily: 'inherit' }}
                />
                <button onClick={() => saveRename(activeChatId)} style={{ background: 'none', border: 'none', color: '#555', fontSize: '11px' }}>save</button>
              </div>
            ) : (
              <button
                onClick={() => { setEditId(activeChatId); setEditName(activeChat?.name || ''); }}
                style={{ background: 'none', border: 'none', color: '#2a2a2a', padding: '3px 5px', borderRadius: '3px', transition: 'color 0.15s', display: 'flex', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.color = '#666'}
                onMouseLeave={e => e.currentTarget.style.color = '#2a2a2a'}
                title="Rename chat"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 012.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )
          )}
        </div>

        {/* Error bar */}
        {lastErr && (
          <div style={{ background: '#110606', borderBottom: '1px solid #220a0a', padding: '8px 16px', fontSize: '11px', color: '#664040', fontFamily: 'monospace', wordBreak: 'break-all', animation: 'fadeIn 0.2s ease-out' }}>
            {lastErr}
            <button onClick={() => setLastErr('')} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#442020', fontSize: '10px', cursor: 'pointer' }}>dismiss</button>
          </div>
        )}

        {/* Memory saved notification */}
        {memNotif && (
          <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '8px 14px', fontSize: '11px', color: '#555', zIndex: 999, animation: 'fadeIn 0.2s ease-out', pointerEvents: 'none' }}>
            ◆ Memory updated
          </div>
        )}

        {/* ── LIST VIEW ────────────────────────────────────────────────────── */}
        {view === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '14px' }}>
              <button
                onClick={newChat}
                style={{
                  width: '100%', padding: '12px', background: '#0d0d0d',
                  border: '1px solid #1a1a1a', borderRadius: '8px',
                  color: '#ccc', fontSize: '13px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: '7px',
                  transition: 'background 0.15s, border-color 0.15s',
                  letterSpacing: '0.1px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.borderColor = '#222'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0d0d0d'; e.currentTarget.style.borderColor = '#1a1a1a'; }}
              >
                <span style={{ fontSize: '18px', lineHeight: 1, color: '#555' }}>+</span> New Conversation
              </button>
            </div>
            <div style={{ padding: '0 14px 12px' }}>
              <div style={{ padding: '10px 12px', background: '#080808', border: '1px solid #141414', borderRadius: '6px', fontSize: '12px', color: '#444', lineHeight: '1.5' }}>
                {activeCat?.sub}
              </div>
            </div>
            {(chatLists[catId] || []).length === 0
              ? <div style={{ padding: '50px 16px', textAlign: 'center', color: '#2a2a2a', fontSize: '13px' }}>No conversations yet.</div>
              : (chatLists[catId] || []).map((chat, i) => (
                <div
                  key={chat.id}
                  className="cr msg-enter"
                  style={{ animationDelay: i * 25 + 'ms' }}
                  onClick={() => openChat(chat.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '13px', color: '#bbb', fontWeight: '600' }}>{chat.name}</span>
                    <span style={{ fontSize: '9px', color: '#333' }}>{fdate(chat.created)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#444', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.preview}
                  </div>
                  <button
                    onClick={e => deleteChat(chat.id, e)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#222', fontSize: '13px', padding: '3px 6px', transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#666'}
                    onMouseLeave={e => e.currentTarget.style.color = '#222'}
                  >×</button>
                </div>
              ))
            }
          </div>
        )}

        {/* ── CHAT VIEW ────────────────────────────────────────────────────── */}
        {view === 'chat' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px', display: 'flex', flexDirection: 'column', maxWidth: '700px', width: '100%', margin: '0 auto' }}>
              {activeMsgs.map((msg, i) => {
                const msgKey = `${activeChatId}-${i}`;
                const isSpeaking = speakingId === msgKey;
                return (
                  <div
                    key={i}
                    className="msg-enter msg-wrap"
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      marginBottom: '16px',
                      animationDelay: Math.min(i * 30, 300) + 'ms',
                    }}
                  >
                    {msg.role === 'assistant' && (
                      <div style={{ fontSize: '10px', color: '#333', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Avatar sz={1} />
                        <span>Hamza{msg.time !== '—' ? ' · ' + msg.time : ''}</span>
                      </div>
                    )}

                    <div style={{
                      maxWidth: '82%',
                      padding: msg.role === 'user' ? '10px 14px' : '14px 18px',
                      borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '2px 14px 14px 14px',
                      background: msg.role === 'user' ? '#e0e0e0' : '#0f0f0f',
                      border: msg.role === 'user' ? 'none' : '1px solid #1a1a1a',
                      color: msg.role === 'user' ? '#080808' : '#b0b0b0',
                      fontSize: '14px', lineHeight: '1.75',
                      boxShadow: msg.role === 'assistant' ? '0 2px 12px rgba(0,0,0,0.3)' : 'none',
                    }}>
                      {msg.role === 'assistant' ? (
                        // Render AI messages as Markdown (bold, lists, code blocks, etc.)
                        <div className="md-content">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        // User messages stay as plain text
                        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                      )}
                    </div>

                    {/* Timestamp + speaker + retry button row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                      {msg.role === 'user' && (
                        <div style={{ fontSize: '9px', color: '#2a2a2a' }}>{msg.time}</div>
                      )}
                      {msg.role === 'assistant' && (
                        <button
                          className={'speak-btn' + (isSpeaking ? ' active' : '')}
                          onClick={() => speak(msg.content, msgKey)}
                          title={isSpeaking ? 'Stop' : 'Listen to this'}
                        >
                          {isSpeaking ? (
                            <span style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5px', height: '10px' }}>
                              {[0.3, 0.6, 1, 0.6, 0.3].map((delay, j) => (
                                <span key={j} style={{
                                  width: '2px', height: '10px', background: 'rgba(255,255,255,0.7)', borderRadius: '1px',
                                  display: 'inline-block',
                                  animation: `waveBar 0.6s ease-in-out ${delay * 0.2}s infinite`,
                                  transformOrigin: 'bottom',
                                }} />
                              ))}
                            </span>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                              <path d="M15.54 8.46a5 5 0 010 7.07" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      {/* Retry button — only shows on error messages */}
                      {msg.error && !loading && (
                        <button className="retry-btn" onClick={retry}>↻ Retry</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {loading && (
                <div className="msg-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#333', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Avatar sz={1} />
                    <span>Hamza · {deepMode ? 'thinking' : 'replying'}</span>
                  </div>
                  <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '2px 14px 14px 14px', padding: '14px 18px', display: 'flex', gap: '5px', alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{ width: '5px', height: '5px', background: '#333', borderRadius: '50%', display: 'inline-block', animation: `dot 1.4s ease-in-out ${i * 0.18}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #111', background: '#060606', maxWidth: '700px', width: '100%', margin: '0 auto' }}>
              <div style={{
                display: 'flex', gap: '8px', alignItems: 'flex-end',
                background: '#0a0a0a', border: '1px solid',
                borderColor: inputFocus ? '#282828' : '#161616',
                borderRadius: '8px', padding: '10px 12px',
                transition: 'border-color 0.2s',
                boxShadow: inputFocus ? '0 0 0 1px rgba(255,255,255,0.04)' : 'none',
              }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  onFocus={() => setInputFocus(true)}
                  onBlur={() => setInputFocus(false)}
                  placeholder="Message Hamza..."
                  rows={1}
                  onInput={e => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
                  }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#c8c8c8', fontSize: '14px', lineHeight: '1.6', maxHeight: '100px', overflowY: 'auto', caretColor: '#888', letterSpacing: '0.1px' }}
                />
                <VoiceButton
                  onTranscript={t => setInput(t)}
                  disabled={loading}
                />
                <button
                  onClick={() => send()}
                  disabled={loading || !input.trim()}
                  style={{
                    width: '32px', height: '32px', borderRadius: '6px', flexShrink: 0, border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (input.trim() && !loading) ? '#e0e0e0' : '#111',
                    cursor: (input.trim() && !loading) ? 'pointer' : 'default',
                    transition: 'background 0.15s, transform 0.1s',
                    transform: (input.trim() && !loading) ? 'scale(1)' : 'scale(0.95)',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                      stroke={(input.trim() && !loading) ? '#000' : '#2a2a2a'}
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '10px', color: '#222', letterSpacing: '0.5px' }}>
                Enter to send · Shift+Enter for new line · {deepMode ? 'Sonnet · deep' : 'Haiku · fast'}
              </div>
            </div>
          </>
        )}

        {/* ── MEMORY VIEW ──────────────────────────────────────────────────── */}
        {view === 'memory' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 18px', maxWidth: '560px', width: '100%', margin: '0 auto' }}>

            {/* ── Auto-memories section ── */}
            <div className="msg-enter" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <span style={{ fontSize: '12px', color: '#555', fontWeight: '600' }}>Learned memories</span>
                  <span style={{ fontSize: '10px', color: '#2a2a2a', marginLeft: '8px' }}>
                    {memories.length > 0 ? memories.length + ' stored' : ''}
                  </span>
                </div>
                {memories.length > 0 && (
                  <button
                    onClick={() => { if (window.confirm('Clear all learned memories?')) { setMemories([]); sset('hx_memories', []); } }}
                    style={{ background: 'none', border: 'none', fontSize: '11px', color: '#333', transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#666'}
                    onMouseLeave={e => e.currentTarget.style.color = '#333'}
                  >Clear all</button>
                )}
              </div>

              <div style={{ fontSize: '11px', color: '#2a2a2a', marginBottom: '10px', lineHeight: '1.6' }}>
                Hamza learns from your conversations automatically. These are injected into every reply.
              </div>

              {memories.length === 0 ? (
                <div style={{ padding: '18px 16px', background: '#080808', border: '1px solid #141414', borderRadius: '6px', fontSize: '12px', color: '#2a2a2a', textAlign: 'center' }}>
                  No memories yet — they build up as you chat.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...memories].reverse().map((mem, i) => (
                    <div
                      key={mem.id}
                      className="msg-enter"
                      style={{
                        animationDelay: Math.min(i * 20, 200) + 'ms',
                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                        padding: '10px 12px', background: '#080808',
                        border: '1px solid #141414', borderRadius: '6px',
                      }}
                    >
                      <span style={{
                        fontSize: '9px', color: '#333', background: '#111',
                        border: '1px solid #1a1a1a', borderRadius: '3px',
                        padding: '2px 6px', whiteSpace: 'nowrap', marginTop: '1px', flexShrink: 0,
                      }}>
                        {new Date(mem.date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}
                      </span>
                      <span style={{ fontSize: '12px', color: '#555', lineHeight: '1.6', flex: 1 }}>{mem.text}</span>
                      <button
                        onClick={() => {
                          const updated = memories.filter(m => m.id !== mem.id);
                          setMemories(updated);
                          sset('hx_memories', updated);
                        }}
                        style={{ background: 'none', border: 'none', color: '#222', fontSize: '14px', padding: '0 2px', lineHeight: 1, flexShrink: 0, transition: 'color 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#666'}
                        onMouseLeave={e => e.currentTarget.style.color = '#222'}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ height: '1px', background: '#111', margin: '4px 0 20px' }} />

            {/* ── Manual notes section ── */}
            <div className="msg-enter" style={{ animationDelay: '60ms', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', color: '#555', fontWeight: '600' }}>Pinned notes</span>
                {notes.trim() && (
                  <button
                    onClick={() => { setNotes(''); sset('hn', ''); }}
                    style={{ background: 'none', border: 'none', fontSize: '11px', color: '#333', transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#666'}
                    onMouseLeave={e => e.currentTarget.style.color = '#333'}
                  >Clear</button>
                )}
              </div>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); sset('hn', e.target.value); }}
                placeholder="Anything you want to manually pin — Hamza will always have it in mind."
                style={{
                  width: '100%', minHeight: '120px',
                  background: '#080808', border: '1px solid #181818',
                  borderRadius: '6px', padding: '14px 16px',
                  fontSize: '13px', lineHeight: '1.85', color: '#555',
                  fontFamily: 'inherit', resize: 'vertical',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = '#252525'}
                onBlur={e => e.target.style.borderColor = '#181818'}
              />
            </div>

            <div className="msg-enter" style={{ animationDelay: '100ms', padding: '12px 14px', background: '#080808', border: '1px solid #141414', borderRadius: '6px' }}>
              <div style={{ fontSize: '9px', color: '#2a2a2a', marginBottom: '5px', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: '600' }}>Built-in knowledge</div>
              <div style={{ fontSize: '12px', color: '#3a3a3a', lineHeight: '1.8' }}>
                Your full profile — life, Glao, goals, patterns, Islamic context — is baked into every conversation.
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
