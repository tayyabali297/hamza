import { useState, useRef, useEffect } from 'react';
import { CATS, DEEP_ROOMS, OPENERS, getSys, buildMessages } from './rooms';
import Avatar from './Avatar';
import VoiceButton from './VoiceButton';

// ─── Storage ──────────────────────────────────────────────────────────────────

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

// ─── API ──────────────────────────────────────────────────────────────────────

async function callAPI(userMessages, sys, deep) {
  const messages   = buildMessages(userMessages, sys);
  const model      = deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const max_tokens = deep ? 1200 : 500;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens, messages }),
    });
  } catch (err) {
    throw new Error('Network error: ' + err.message);
  }

  let data;
  try { data = await res.json(); } catch { throw new Error('Parse error — status ' + res.status); }

  if (data?.type === 'error') throw new Error('API: ' + data.error?.message);
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 120));

  const texts = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
  if (!texts.length) throw new Error('Empty response from API');
  return texts.join('\n');
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return (
    voices.find(v => v.name === 'Microsoft George - English (United Kingdom)') ||
    voices.find(v => v.name.includes('George')) ||
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

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const notesRef  = useRef('');
  const sendFnRef = useRef(null);
  notesRef.current = notes;

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
    utt.rate   = 0.88;
    utt.pitch  = 0.92;
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
    const nl = (chatLists[catId] || []).filter(c => c.id !== id);
    setChatLists(p => ({ ...p, [catId]: nl }));
    if (openChatId[catId] === id) {
      setOpenChatId(p => ({ ...p, [catId]: null }));
      setView('list');
    }
    sset('hcl_' + catId, nl);
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

  // ── Send ──────────────────────────────────────────────────────────────────

  async function send() {
    const text = input.trim();
    if (!text || loading || !activeChatId) return;

    const uiMsg = { role: 'user', content: text, time: ftime() };
    const newM  = [...activeMsgs, uiMsg];
    const newA  = [...activeApi, { role: 'user', content: text }];

    setMsgCache(p => ({ ...p, [activeChatId]: newM }));
    setApiCache(p => ({ ...p, [activeChatId]: newA }));
    setInput('');
    setLoading(true);
    setLastErr('');

    const ul = (chatLists[catId] || []).map(c =>
      c.id === activeChatId
        ? { ...c, preview: text.slice(0, 50) + (text.length > 50 ? '…' : '') }
        : c
    );
    setChatLists(p => ({ ...p, [catId]: ul }));
    sset('hcl_' + catId, ul);

    try {
      const reply = await callAPI(newA, getSys(catId, notesRef.current), deepMode);
      const aMsg  = { role: 'assistant', content: reply, time: ftime() };
      const fm    = [...newM, aMsg];
      const fa    = [...newA, { role: 'assistant', content: reply }];
      setMsgCache(p => ({ ...p, [activeChatId]: fm }));
      setApiCache(p => ({ ...p, [activeChatId]: fa }));
      sset('hm_' + activeChatId, fm);
      sset('ha_' + activeChatId, fa);
    } catch (err) {
      setLastErr(err.message);
      const em = { role: 'assistant', content: 'Something went wrong. Check the error bar above.', time: ftime() };
      setMsgCache(p => ({ ...p, [activeChatId]: [...newM, em] }));
    }

    setLoading(false);
    inputRef.current?.focus();
  }

  sendFnRef.current = send;

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // ── Loading screen ────────────────────────────────────────────────────────

  if (!loaded) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#2a2a2a', fontFamily: 'monospace', fontSize: '13px', animation: 'pulse 2s ease-in-out infinite' }}>loading...</span>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', background: '#0a0a0a', display: 'flex', color: '#ccc', fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: '14px', overflow: 'hidden' }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 2px; }
        ::-webkit-scrollbar-thumb { background: #181818; }
        button { cursor: pointer; font-family: inherit; }
        textarea { resize: none; font-family: inherit; }
        textarea:focus { outline: none; }

        /* Sidebar room button */
        .sb {
          background: transparent; border: none; width: 100%;
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: 3px;
          color: #444; font-size: 13px; text-align: left;
          transition: background 0.15s, color 0.15s;
        }
        .sb:hover { background: #0f0f0f; color: #888; }
        .sb.on { background: #111; color: #fff; border-left: 2px solid #fff !important; }

        /* Chat list row */
        .cr {
          padding: 10px 12px; border-bottom: 1px solid #080808;
          cursor: pointer; position: relative; padding-right: 32px;
          transition: background 0.12s;
        }
        .cr:hover { background: #0d0d0d; }

        /* Mode toggle */
        .mode-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 20px;
          border: 1px solid #1c1c1c; background: transparent;
          color: #3a3a3a; font-size: 11px; transition: all 0.2s;
          letter-spacing: 0.3px;
        }
        .mode-btn.on { border-color: #444; color: #ccc; background: #0f0f0f; }
        .mode-btn:hover { border-color: #2a2a2a; color: #666; }

        /* Speaker button */
        .speak-btn {
          background: none; border: none; padding: 3px 5px;
          border-radius: 3px; opacity: 0; transition: opacity 0.15s, background 0.15s;
          display: flex; align-items: center; gap: 3px;
          color: #333; font-size: 10px;
        }
        .msg-wrap:hover .speak-btn { opacity: 1; }
        .speak-btn.active { opacity: 1; color: #888; }
        .speak-btn:hover { background: #1a1a1a; color: #666; }

        /* Animations */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dot {
          0%,80%,100% { transform: scale(0.4); opacity: 0.2; }
          40%          { transform: scale(1);   opacity: 0.8; }
        }
        @keyframes pulse {
          0%,100% { opacity: 0.3; }
          50%      { opacity: 0.8; }
        }
        @keyframes deepGlow {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.08); }
          50%      { box-shadow: 0 0 0 4px rgba(255,255,255,0); }
        }
        @keyframes avatarBreathe {
          0%,100% { opacity: 0.9; filter: brightness(0.9); }
          50%      { opacity: 1;   filter: brightness(1.1); }
        }
        @keyframes waveBar {
          0%,100% { transform: scaleY(0.4); }
          50%      { transform: scaleY(1); }
        }
        @keyframes inputGlow {
          from { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          to   { box-shadow: 0 0 0 1px rgba(255,255,255,0.04); }
        }
        .msg-enter { animation: fadeUp 0.22s ease-out both; }
        .sidebar-enter { animation: fadeIn 0.3s ease-out both; }
      `}</style>

      {/* ── SIDEBAR ──────────────────────────────────────────────────────────── */}
      {sidebar && (
        <div className="sidebar-enter" style={{ width: '190px', minWidth: '190px', borderRight: '1px solid #0d0d0d', background: '#050505', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Header / Avatar */}
          <div style={{ padding: '16px 12px 12px', borderBottom: '1px solid #0d0d0d', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: '#0f0f0f', border: '1px solid #181818', borderRadius: '4px',
              padding: '5px 5px 2px',
              animation: 'avatarBreathe 4s ease-in-out infinite',
            }}>
              <Avatar sz={3} />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#e8e8e8', letterSpacing: '-0.3px' }}>Hamza</div>
              <div style={{ fontSize: '10px', color: '#1e1e1e', marginTop: '2px', letterSpacing: '0.5px' }}>personal advisor</div>
            </div>
          </div>

          {/* Rooms */}
          <div style={{ padding: '12px 4px 4px' }}>
            <div style={{ fontSize: '8px', color: '#1a1a1a', letterSpacing: '2.5px', textTransform: 'uppercase', paddingLeft: '10px', marginBottom: '5px' }}>Rooms</div>
            {CATS.map(c => {
              const on  = catId === c.id && view !== 'memory';
              const cnt = (chatLists[c.id] || []).length;
              return (
                <button
                  key={c.id}
                  className={'sb' + (on ? ' on' : '')}
                  style={{ borderLeft: on ? '2px solid #e0e0e0' : '2px solid transparent', fontWeight: on ? '600' : '400' }}
                  onClick={() => { setCatId(c.id); setView('list'); }}
                >
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {DEEP_ROOMS.includes(c.id) && (
                    <span style={{ fontSize: '7px', color: on ? '#2a2a2a' : '#1e1e1e' }}>◆</span>
                  )}
                  {cnt > 0 && (
                    <span style={{ fontSize: '10px', color: '#252525', background: '#0f0f0f', padding: '1px 5px', borderRadius: '8px' }}>{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ height: '1px', background: '#0d0d0d', margin: '8px 0' }} />

          {/* Memory */}
          <div style={{ padding: '0 4px 6px' }}>
            <button
              className={'sb' + (view === 'memory' ? ' on' : '')}
              style={{ borderLeft: view === 'memory' ? '2px solid #e0e0e0' : '2px solid transparent' }}
              onClick={() => setView('memory')}
            >
              Memory
            </button>
          </div>

          {/* Mode pill at bottom */}
          <div style={{ padding: '10px 12px 16px', marginTop: 'auto', borderTop: '1px solid #0a0a0a' }}>
            <div style={{ fontSize: '8px', color: '#181818', marginBottom: '7px', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Active mode</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '5px 8px', borderRadius: '3px',
              background: deepMode ? '#0d0d0d' : 'transparent',
              border: deepMode ? '1px solid #181818' : '1px solid transparent',
              transition: 'all 0.3s',
            }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: deepMode ? '#e0e0e0' : '#1e1e1e',
                display: 'inline-block', flexShrink: 0,
                transition: 'background 0.3s',
                animation: deepMode ? 'deepGlow 2s ease-in-out infinite' : 'none',
              }} />
              <div>
                <div style={{ fontSize: '11px', color: deepMode ? '#bbb' : '#333', transition: 'color 0.3s' }}>
                  {deepMode ? 'Deep · Sonnet' : 'Fast · Haiku'}
                </div>
                <div style={{ fontSize: '9px', color: '#1a1a1a', marginTop: '1px' }}>
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
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #0d0d0d', background: '#050505', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setSidebar(s => !s)}
            style={{ background: 'none', border: 'none', color: '#2a2a2a', fontSize: '14px', padding: '3px 5px', borderRadius: '3px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#555'}
            onMouseLeave={e => e.currentTarget.style.color = '#2a2a2a'}
          >&#9776;</button>

          {view === 'chat' && (
            <button
              onClick={() => setView('list')}
              style={{ background: 'none', border: 'none', color: '#333', fontSize: '12px', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#777'}
              onMouseLeave={e => e.currentTarget.style.color = '#333'}
            >&larr; {activeCat?.label}</button>
          )}

          <span style={{ color: '#444', fontWeight: '600', fontSize: '13px', letterSpacing: '-0.1px' }}>
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
                  style={{ background: '#111', border: '1px solid #222', color: '#ccc', borderRadius: '3px', padding: '3px 8px', fontSize: '12px', width: '110px', fontFamily: 'inherit' }}
                />
                <button onClick={() => saveRename(activeChatId)} style={{ background: 'none', border: 'none', color: '#444', fontSize: '11px' }}>save</button>
              </div>
            ) : (
              <button
                onClick={() => { setEditId(activeChatId); setEditName(activeChat?.name || ''); }}
                style={{ background: 'none', border: 'none', color: '#1e1e1e', fontSize: '11px', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#555'}
                onMouseLeave={e => e.currentTarget.style.color = '#1e1e1e'}
              >rename</button>
            )
          )}
        </div>

        {/* Error bar */}
        {lastErr && (
          <div style={{ background: '#110606', borderBottom: '1px solid #220a0a', padding: '6px 16px', fontSize: '10px', color: '#664040', fontFamily: 'monospace', wordBreak: 'break-all', animation: 'fadeIn 0.2s ease-out' }}>
            {lastErr}
            <button onClick={() => setLastErr('')} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#442020', fontSize: '10px', cursor: 'pointer' }}>dismiss</button>
          </div>
        )}

        {/* ── LIST VIEW ────────────────────────────────────────────────────── */}
        {view === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '14px' }}>
              <button
                onClick={newChat}
                style={{
                  width: '100%', padding: '11px', background: '#0d0d0d',
                  border: '1px solid #181818', borderRadius: '4px',
                  color: '#ccc', fontSize: '13px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: '7px',
                  transition: 'background 0.15s, border-color 0.15s',
                  letterSpacing: '0.1px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.borderColor = '#222'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0d0d0d'; e.currentTarget.style.borderColor = '#181818'; }}
              >
                <span style={{ fontSize: '18px', lineHeight: 1, color: '#555' }}>+</span> New Conversation
              </button>
            </div>
            <div style={{ padding: '0 14px 12px' }}>
              <div style={{ padding: '8px 10px', background: '#060606', border: '1px solid #0f0f0f', borderRadius: '3px', fontSize: '11px', color: '#2a2a2a', lineHeight: '1.5' }}>
                {activeCat?.sub}
              </div>
            </div>
            {(chatLists[catId] || []).length === 0
              ? <div style={{ padding: '50px 16px', textAlign: 'center', color: '#1a1a1a', fontSize: '13px' }}>No conversations yet.</div>
              : (chatLists[catId] || []).map((chat, i) => (
                <div
                  key={chat.id}
                  className="cr msg-enter"
                  style={{ animationDelay: i * 25 + 'ms' }}
                  onClick={() => openChat(chat.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '13px', color: '#aaa', fontWeight: '600' }}>{chat.name}</span>
                    <span style={{ fontSize: '9px', color: '#1e1e1e' }}>{fdate(chat.created)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#2a2a2a', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.preview}
                  </div>
                  <button
                    onClick={e => deleteChat(chat.id, e)}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#1a1a1a', fontSize: '13px', padding: '3px 6px', transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#555'}
                    onMouseLeave={e => e.currentTarget.style.color = '#1a1a1a'}
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
                      <div style={{ fontSize: '10px', color: '#222', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Avatar sz={1} />
                        <span>Hamza{msg.time !== '—' ? ' · ' + msg.time : ''}</span>
                      </div>
                    )}

                    <div style={{
                      maxWidth: '82%',
                      padding: msg.role === 'user' ? '10px 14px' : '13px 16px',
                      borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '2px 14px 14px 14px',
                      background: msg.role === 'user' ? '#dcdcdc' : '#0f0f0f',
                      border: msg.role === 'user' ? 'none' : '1px solid #181818',
                      color: msg.role === 'user' ? '#080808' : '#b0b0b0',
                      fontSize: '14px', lineHeight: '1.75', whiteSpace: 'pre-wrap',
                      boxShadow: msg.role === 'assistant' ? '0 1px 12px rgba(0,0,0,0.4)' : 'none',
                    }}>
                      {msg.content}
                    </div>

                    {/* Timestamp + speaker button row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                      {msg.role === 'user' && (
                        <div style={{ fontSize: '9px', color: '#1e1e1e' }}>{msg.time}</div>
                      )}
                      {msg.role === 'assistant' && (
                        <button
                          className={'speak-btn' + (isSpeaking ? ' active' : '')}
                          onClick={() => speak(msg.content, msgKey)}
                          title={isSpeaking ? 'Stop' : 'Listen to this'}
                        >
                          {isSpeaking ? (
                            // Animated equalizer bars when speaking
                            <span style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5px', height: '10px' }}>
                              {[0.3, 0.6, 1, 0.6, 0.3].map((delay, j) => (
                                <span key={j} style={{
                                  width: '2px', height: '10px', background: '#666', borderRadius: '1px',
                                  display: 'inline-block',
                                  animation: `waveBar 0.6s ease-in-out ${delay * 0.2}s infinite`,
                                  transformOrigin: 'bottom',
                                }} />
                              ))}
                            </span>
                          ) : (
                            // Speaker icon
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#2a2a2a" />
                              <path d="M15.54 8.46a5 5 0 010 7.07" stroke="#2a2a2a" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {loading && (
                <div className="msg-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#222', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Avatar sz={1} />
                    <span>Hamza · {deepMode ? 'thinking' : 'replying'}</span>
                  </div>
                  <div style={{ background: '#0f0f0f', border: '1px solid #181818', borderRadius: '2px 14px 14px 14px', padding: '14px 18px', display: 'flex', gap: '5px', alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{ width: '5px', height: '5px', background: '#2a2a2a', borderRadius: '50%', display: 'inline-block', animation: `dot 1.4s ease-in-out ${i * 0.18}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #0d0d0d', background: '#050505', maxWidth: '700px', width: '100%', margin: '0 auto' }}>
              <div style={{
                display: 'flex', gap: '8px', alignItems: 'flex-end',
                background: '#0a0a0a', border: '1px solid',
                borderColor: inputFocus ? '#242424' : '#141414',
                borderRadius: '6px', padding: '9px 11px',
                transition: 'border-color 0.2s',
                boxShadow: inputFocus ? '0 0 0 1px rgba(255,255,255,0.03)' : 'none',
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
                  onAutoSubmit={() => sendFnRef.current?.()}
                  disabled={loading}
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  style={{
                    width: '32px', height: '32px', borderRadius: '5px', flexShrink: 0, border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (input.trim() && !loading) ? '#d8d8d8' : '#111',
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
              <div style={{ textAlign: 'center', marginTop: '5px', fontSize: '9px', color: '#151515', letterSpacing: '0.5px' }}>
                Enter to send · Shift+Enter for new line · {deepMode ? 'Sonnet · deep' : 'Haiku · fast'}
              </div>
            </div>
          </>
        )}

        {/* ── MEMORY VIEW ──────────────────────────────────────────────────── */}
        {view === 'memory' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 18px', maxWidth: '540px', width: '100%', margin: '0 auto' }}>
            <div className="msg-enter" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: '#252525' }}>Notes you want Hamza to remember.</span>
              <button
                onClick={() => { setNotes(''); sset('hn', ''); }}
                style={{ background: 'none', border: 'none', fontSize: '11px', color: '#1e1e1e', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#555'}
                onMouseLeave={e => e.currentTarget.style.color = '#1e1e1e'}
              >Clear</button>
            </div>
            <textarea
              className="msg-enter"
              value={notes}
              onChange={e => { setNotes(e.target.value); sset('hn', e.target.value); }}
              placeholder="Nothing yet. Add notes here — Hamza will reference them in every conversation."
              style={{
                animationDelay: '50ms',
                width: '100%', minHeight: '220px',
                background: '#080808', border: '1px solid #141414',
                borderRadius: '4px', padding: '16px',
                fontSize: '13px', lineHeight: '1.85', color: '#3a3a3a',
                fontFamily: 'inherit', resize: 'vertical',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#202020'}
              onBlur={e => e.target.style.borderColor = '#141414'}
            />
            <div className="msg-enter" style={{ animationDelay: '100ms', marginTop: '16px', padding: '14px 16px', background: '#060606', border: '1px solid #0f0f0f', borderRadius: '4px' }}>
              <div style={{ fontSize: '9px', color: '#1a1a1a', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Built-in knowledge</div>
              <div style={{ fontSize: '12px', color: '#252525', lineHeight: '1.8' }}>
                Your full profile — life, modules, Glao, goals, patterns, Islamic context — is baked into every conversation. Notes above layer on top.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
