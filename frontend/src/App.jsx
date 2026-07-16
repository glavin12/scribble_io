import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import Canvas from './Canvas'
import LandingPage from './Landing'

// ── API helpers ─────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.PROD ? 'https://scribble-io-3qfw.onrender.com' : ''
const WS_BASE  = import.meta.env.PROD ? 'wss://scribble-io-3qfw.onrender.com'  : `ws://${location.host}`

async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Request failed') }
  return r.json()
}

async function apiJson(path, body, token) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Request failed') }
  return r.json()
}

// ── Module-level components ──────────────────────────────────────────────────
// IMPORTANT: ALL screen components must be defined OUTSIDE App() so React sees
// a stable component type on every render. Defining components inside a parent
// function causes React to unmount+remount them on every parent re-render,
// which resets their internal state (bug: canvas clearing, guess input blanking).

// DoodleDash color palette for the toolbar
const PALETTE_COLORS = [
  '#000000', '#ffffff', '#808080', '#ef4444', '#3b82f6',
  '#22c55e', '#facc15', '#f97316', '#a855f7', '#ec4899',
  '#92400e',
]

function GmScoresTable({ scores, me }) {
  const sorted = Object.entries(scores || {}).sort((a, b) => b[1] - a[1])
  return (
    <table className="gm-scores-table">
      <thead><tr><th>Player</th><th>Pts</th></tr></thead>
      <tbody>
        {sorted.map(([p, pts], i) => (
          <tr key={p}>
            <td>{i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}{p}{p === me ? ' (you)' : ''}</td>
            <td>{pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Avatar colors for sidebar player cards (reused by RoomScreen as AVATAR_COLORS)
const PLAYER_COLORS = ['#735c00', '#006491', '#006d3d', '#ba1a1a', '#9C27B0', '#FF9800', '#00897B', '#5C6BC0']

function MainGameLayout({
  isDrawer, sendDraw, sendClear, guess, setGuess, submitGuess, timerLow,
  remoteStrokes, scores, username, drawerID, word, wordLength,
  gamePhase, roundNum, totalRounds, timer, onSkip, onLeave,
  wrongMsg, setWrongMsg,
  brushColor, setBrushColor, brushSize, setBrushSize, activeTool, setActiveTool,
}) {
  // Timer SVG circle calculations
  const circumference = 2 * Math.PI * 24
  const timerMax = 80 // will be adjusted by actual draw_time later
  const timerOffset = timer != null ? circumference - (timer / timerMax) * circumference : 0

  return (
    <div className="gm-page">
      {/* Atmospheric BG doodles (decorative) */}
      <div className="gm-bg-doodles" aria-hidden="true">
        <span className="material-symbols-outlined" style={{fontSize:120,top:20,left:10,color:'#ffd54f',animationDelay:'0s'}}>brush</span>
        <span className="material-symbols-outlined" style={{fontSize:80,bottom:40,right:20,color:'#7bc9ff',animationDelay:'1s'}}>palette</span>
        <span className="material-symbols-outlined" style={{fontSize:100,top:'50%',left:'25%',color:'#74f1a5',animationDelay:'2s'}}>category</span>
        <span className="material-symbols-outlined" style={{fontSize:90,bottom:20,left:'50%',color:'#ffdad6',animationDelay:'1.5s'}}>edit</span>
      </div>

      {/* ── Top Nav Bar ── */}
      <header className="gm-nav" role="banner" aria-label="Game navigation">
        <div style={{display:'flex',alignItems:'center',gap:24}}>
          <div className="gm-nav-brand">DoodleDash</div>
          <div className="gm-nav-center">
            <div className="gm-round-info">
              <span className="gm-round-label-top">Current Game</span>
              <span className="gm-round-value">Round {roundNum}/{totalRounds}</span>
            </div>
          </div>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:24}}>
          {/* Circular Timer */}
          <div className={`gm-timer-circle${timerLow ? ' low' : ''}`} role="timer" aria-label={`${timer ?? 0} seconds remaining`}>
            <svg viewBox="0 0 56 56">
              <circle className="track" cx="28" cy="28" r="24" />
              <circle className="progress" cx="28" cy="28" r="24"
                strokeDasharray={circumference}
                strokeDashoffset={timerOffset}
              />
            </svg>
            <span className="gm-timer-text">{timer ?? '–'}</span>
          </div>

          <button className="gm-btn-leave" onClick={onLeave} aria-label="Leave game">
            <span className="material-symbols-outlined">logout</span>
            Leave
          </button>
        </div>
      </header>

      {/* ── Main Body ── */}
      <div className="gm-body">
        {/* ── Left Sidebar: Players ── */}
        <aside className="gm-sidebar" aria-label="Players list">
          <div className="gm-sidebar-title">PLAYERS</div>
          {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([p, s], i) => {
            const isCurrentDrawer = p === drawerID
            const isMe = p === username
            const avatarColor = PLAYER_COLORS[i % PLAYER_COLORS.length]
            return (
              <div key={p} className={`gm-player-card ${isCurrentDrawer ? 'is-drawer' : 'is-guesser'}`}>
                <div className="gm-player-avatar" style={{borderColor: avatarColor, background: avatarColor + '18'}}>
                  <span style={{color: avatarColor}}>{p[0]?.toUpperCase()}</span>
                  {isCurrentDrawer && (
                    <div className="drawer-icon">
                      <span className="material-symbols-outlined">edit</span>
                    </div>
                  )}
                </div>
                <div className="gm-player-info">
                  <span className="gm-player-name">
                    {isMe && isCurrentDrawer ? 'You (🎨 Drawing)'
                      : isMe ? 'You (Guessing)'
                      : p}
                  </span>
                  <span className="gm-player-pts">{s.toLocaleString()} pts</span>
                </div>
              </div>
            )
          })}

          <div className="gm-sidebar-bottom">
            <button className="gm-btn-invite" aria-label="Invite friends to this game">
              <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
              Invite Friends
            </button>
          </div>
        </aside>

        {/* ── Center: Canvas Area ── */}
        <section className="gm-center" role="main" aria-label="Drawing canvas and controls">
          {/* Header — varies by role */}
          {isDrawer && word ? (
            <div className="gm-secret-header">
              <div className="gm-secret-left">
                <div className="gm-secret-word-row">
                  <span className="gm-secret-label">Secret Word:</span>
                  <span className="gm-secret-word-badge">{word}</span>
                </div>
                <p className="gm-secret-hint">Draw the word without using letters, numbers, or symbols.</p>
              </div>
              <div className="gm-canvas-actions">
                <button className="gm-canvas-action-btn danger" onClick={sendClear} title="Clear canvas" aria-label="Clear canvas">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="gm-guesser-header">
              {gamePhase === 'drawing' ? (
                <>
                  <div className="gm-word-blanks" role="status" aria-live="polite" aria-label={`Word has ${wordLength || 0} letters`}>{'_ '.repeat(wordLength || 0).trim()}</div>
                  <div className="gm-hint-badge">
                    <span className="material-symbols-outlined">stars</span>
                    <span>GUESS QUICKLY FOR BONUS!</span>
                  </div>
                </>
              ) : gamePhase === 'choosing' ? (
                <div className="gm-choosing-msg">{drawerID} is choosing a word…</div>
              ) : (
                <div className="gm-choosing-msg">🎨 DoodleDash</div>
              )}
            </div>
          )}

          {/* Canvas */}
          <div className="gm-canvas-wrap" role="img" aria-label={isDrawer ? 'Drawing canvas - draw your word here' : 'Drawing canvas - watch the drawer'}>
            <div className="gm-canvas-ghost">
              <span className="material-symbols-outlined">gesture</span>
            </div>
            <Canvas
              isDrawer={isDrawer}
              onDraw={sendDraw}
              remoteStrokes={remoteStrokes}
              color={brushColor}
              size={brushSize}
              tool={activeTool}
            />
          </div>

          {/* Drawer: Toolbar */}
          {isDrawer && gamePhase === 'drawing' && (
            <div className="gm-toolbar" role="toolbar" aria-label="Drawing tools">
              {/* Tool buttons */}
              <div className="gm-tools-group">
                <button className={`gm-tool-btn${activeTool === 'pencil' ? ' active' : ''}`}
                  onClick={() => setActiveTool('pencil')} title="Pencil">
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button className={`gm-tool-btn${activeTool === 'brush' ? ' active' : ''}`}
                  onClick={() => setActiveTool('brush')} title="Brush">
                  <span className="material-symbols-outlined">brush</span>
                </button>
                <button className={`gm-tool-btn${activeTool === 'eraser' ? ' active' : ''}`}
                  onClick={() => setActiveTool('eraser')} title="Eraser">
                  <span className="material-symbols-outlined">ink_eraser</span>
                </button>
              </div>

              <div className="gm-toolbar-sep" />

              {/* Size slider */}
              <div className="gm-size-group">
                <span className="material-symbols-outlined" style={{fontSize:12}}>circle</span>
                <input
                  className="gm-size-slider"
                  type="range" min={1} max={50} value={brushSize}
                  onChange={e => setBrushSize(+e.target.value)}
                  aria-label={`Brush size: ${brushSize}`}
                />
                <span className="material-symbols-outlined" style={{fontSize:22}}>circle</span>
              </div>

              <div className="gm-toolbar-sep" />

              {/* Color palette */}
              <div className="gm-colors-group">
                {PALETTE_COLORS.map(c => (
                  <button
                    key={c}
                    className={`gm-color-swatch${brushColor === c ? ' active' : ''}`}
                    style={{background: c}}
                    onClick={() => { setBrushColor(c); if (activeTool === 'eraser') setActiveTool('pencil') }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Drawer: Skip button */}
          {isDrawer && gamePhase === 'drawing' && (
            <button className="gm-btn-skip" onClick={onSkip}>Skip word</button>
          )}

          {/* Guesser: Guess input */}
          {(!isDrawer) && gamePhase === 'drawing' && (
            <div className="gm-guess-area">
              {wrongMsg && (
                <div className="gm-wrong-msg" role="alert" aria-live="assertive" onClick={() => setWrongMsg('')}>
                  {wrongMsg}
                  <span className="material-symbols-outlined" style={{fontSize:16}}>close</span>
                </div>
              )}
              <form className="gm-guess-row" onSubmit={submitGuess} role="search" aria-label="Guess the word">
                <input
                  className="gm-guess-input"
                  value={guess}
                  onChange={e => setGuess(e.target.value)}
                  placeholder="Type your guess..."
                  aria-label="Type your guess"
                  autoFocus
                />
                <button className="gm-btn-send" type="submit">
                  SEND
                  <span className="material-symbols-outlined">send</span>
                </button>
              </form>
              <p className="gm-guess-tip">Tip: Spelling counts! Keep guessing until you get it right.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function AuthScreen({ error, setError, setToken, setUsername, setScreen, setIsGuest, pushEvent }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', password: '', email: '' })
  // ponytail: seed from localStorage so returning guests keep their name
  const [guestNick, setGuestNick] = useState(() => localStorage.getItem('guestNick') || '')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      if (mode === 'login') {
        const d = await apiPost('/auth/login', { username: form.username, password: form.password })
        localStorage.setItem('token', d.access_token)
        localStorage.setItem('username', form.username)
        setToken(d.access_token); setUsername(form.username); setIsGuest(false); setScreen('lobby')
      } else {
        await apiJson('/auth/register', form)
        setMode('login')
        setError('')
        pushEvent('Registered! Please log in.', 'system')
      }
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const playAsGuest = (e) => {
    e.preventDefault()
    const nick = guestNick.trim()
    if (!nick) { setError('Enter a nickname'); return }
    // ponytail: no token, just set nickname — WS will connect with ?nickname=
    localStorage.removeItem('token')
    localStorage.setItem('guestNick', nick)
    setToken(''); setUsername(nick); setIsGuest(true); setScreen('lobby')
  }

  return (
    <div className="auth-split" role="main">
      {/* ── Left: Login Form ── */}
      <section className="auth-left" aria-labelledby="auth-heading">
        {/* Brand */}
        <div className="auth-brand">
          <span className="material-symbols-outlined auth-brand-icon">brush</span>
          <h1 className="auth-brand-name">DoodleDash</h1>
        </div>

        <div className="auth-form-wrap">
          <header className="auth-header">
            <h2 id="auth-heading" className="auth-title">{mode === 'login' ? 'Welcome Back!' : 'Create Account'}</h2>
            <p className="auth-subtitle">
              {mode === 'login'
                ? "Ready to watch your friends draw a \"cat\" that looks suspiciously like a potato?"
                : "Join the fun — terrible art creates unforgettable moments."}
            </p>
          </header>

          {error && <div className="auth-error" role="alert" aria-live="assertive">{error}</div>}

          {/* Divider */}
          <div className="auth-divider-dd"><span>or email</span></div>

          {/* Email/Password Form */}
          <form className="auth-form" onSubmit={submit} aria-label={mode === 'login' ? 'Login form' : 'Registration form'}>
            <div className="auth-field">
              <label htmlFor="auth-username">Username</label>
              <input id="auth-username" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} placeholder="sketchy_artist" required />
            </div>
            {mode === 'register' && (
              <div className="auth-field">
                <label htmlFor="auth-email">Email Address</label>
                <input id="auth-email" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="sketchy@artist.com" required />
              </div>
            )}
            <div className="auth-field">
              <div className="auth-field-row">
                <label htmlFor="auth-password">Password</label>
                {mode === 'login' && <a className="auth-forgot" href="#">Forgot?</a>}
              </div>
              <input id="auth-password" type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="••••••••" required />
            </div>
            <button className="auth-btn-submit" type="submit" disabled={busy}>
              {busy ? '…' : mode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>

          {/* Toggle login/register */}
          <p className="auth-toggle">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button className="auth-toggle-btn" onClick={() => { setMode(m => m==='login'?'register':'login'); setError('') }}>
              {mode === 'login' ? 'Sign Up' : 'Log In'}
            </button>
          </p>

          {/* Guest Option */}
          <div className="auth-guest-section">
            <form className="auth-guest-form" onSubmit={playAsGuest} aria-label="Play as guest">
              <input value={guestNick} onChange={e => setGuestNick(e.target.value)} placeholder="Pick a nickname…" maxLength={20} className="auth-guest-input" required />
              <button className="auth-btn-guest" type="submit">
                <span className="material-symbols-outlined" style={{fontSize:18}}>person_search</span>
                Play Without Account
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── Right: Illustration ── */}
      <section className="auth-right" aria-hidden="true">
        {/* Floating background icons */}
        <div className="auth-bg-icon auth-bg-icon-1"><span className="material-symbols-outlined">draw</span></div>
        <div className="auth-bg-icon auth-bg-icon-2"><span className="material-symbols-outlined">palette</span></div>
        <div className="auth-bg-icon auth-bg-icon-3"><span className="material-symbols-outlined">star</span></div>

        <div className="auth-illust floating-auth">
          {/* Score badge top-left */}
          <div className="auth-badge auth-badge-top">
            <div className="auth-badge-avatar" style={{background:'var(--dd-primary-fixed)'}}>🐦</div>
            <div>
              <p className="auth-badge-name">ArtieMcDraw</p>
              <p className="auth-badge-pts">1,240 pts</p>
            </div>
          </div>
          {/* Score badge bottom-right */}
          <div className="auth-badge auth-badge-bot">
            <div className="auth-badge-avatar" style={{background:'var(--dd-tertiary-container)'}}>🐱</div>
            <div>
              <p className="auth-badge-name">ScribblePro</p>
              <p className="auth-badge-pts">950 pts</p>
            </div>
          </div>

          {/* Chat bubbles */}
          <div className="auth-bubble auth-bubble-1">Bird?</div>
          <div className="auth-bubble auth-bubble-2">Dragon?</div>
          <div className="auth-bubble auth-bubble-3">Dinosaur!</div>
          <div className="auth-bubble auth-bubble-4">Correct! ✨</div>

          {/* Canvas */}
          <div className="auth-canvas-card">
            <div className="auth-canvas-inner">
              <svg className="auth-dino-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path d="M30,120 C30,80 60,60 100,60 C140,60 170,80 170,120 L170,150 L30,150 Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4"/>
                <path d="M60,60 C60,40 50,20 80,20 C110,20 100,40 100,60" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4"/>
                <circle cx="85" cy="35" fill="currentColor" r="3"/>
                <path d="M110,70 L130,50 M130,80 L150,60 M150,90 L170,70" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3"/>
                <path d="M40,150 L30,180 M60,150 L55,180 M140,150 L145,180 M160,150 L170,180" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4"/>
              </svg>
            </div>
            <div className="auth-canvas-footer">
              <div className="auth-color-dots">
                <span style={{background:'#f87171'}}/>
                <span style={{background:'#60a5fa'}}/>
                <span style={{background:'#fbbf24'}}/>
              </div>
              <span className="auth-round-label">Round 4/10</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function LobbyScreen({ error, setError, username, isGuest, send, setToken, setUsername, setIsGuest, setScreen }) {
  const [joinId, setJoinId] = useState('')

  const leave = () => {
    localStorage.clear(); setToken(''); setUsername(''); setIsGuest(false); setScreen('auth')
  }

  return (
    <div className="lobby-dd">
      {/* BG doodle icons */}
      <div className="lobby-bg-icons" aria-hidden="true">
        <span className="material-symbols-outlined" style={{top:80,left:40,fontSize:60,transform:'rotate(12deg)'}}>brush</span>
        <span className="material-symbols-outlined" style={{top:'50%',left:80,fontSize:40,transform:'rotate(-45deg)'}}>star</span>
        <span className="material-symbols-outlined" style={{bottom:80,right:40,fontSize:70,transform:'rotate(-12deg)'}}>palette</span>
        <span className="material-symbols-outlined" style={{top:160,right:80,fontSize:50,transform:'rotate(90deg)'}}>ink_eraser</span>
      </div>

      {/* Navbar */}
      <header className="lobby-nav">
        <nav className="lobby-nav-inner" aria-label="Lobby navigation">
          <div className="lobby-logo">
            <span className="material-symbols-outlined" style={{fontSize:28,color:'var(--dd-primary)'}}>edit</span>
            <span>DoodleDash</span>
          </div>
          <div className="lobby-nav-right">
            <span className="lobby-user-badge">
              {username}{isGuest ? ' 👤' : ' ⭐'}
            </span>
            <button className="lobby-logout-btn" onClick={leave}>
              {isGuest ? 'Change Name' : 'Log Out'}
            </button>
          </div>
        </nav>
      </header>

      <main className="lobby-main">
        {/* Header */}
        <div className="lobby-header">
          <h1 className="lobby-title">Jump Right In!</h1>
          <p className="lobby-subtitle">
            Welcome, <strong>{username}</strong>! Pick a room and start embarrassing your artistic skills.
          </p>
        </div>

        {error && <div className="lobby-error">{error}</div>}

        {/* Split layout */}
        <div className="lobby-split">
          {/* Left: Whiteboard illustration */}
          <div className="lobby-whiteboard-wrap">
            <div className="lobby-whiteboard">
              {/* Timer overlay */}
              <div className="lobby-wb-timer">
                <span className="material-symbols-outlined" style={{fontSize:20}}>timer</span>
                <span>42s</span>
              </div>
              {/* Score overlay */}
              <div className="lobby-wb-score">
                <div className="lobby-wb-score-header">
                  <span>Score</span>
                  <span className="material-symbols-outlined" style={{fontSize:14}}>leaderboard</span>
                </div>
                <div className="lobby-wb-score-row"><span>You</span><span style={{color:'var(--dd-primary)',fontWeight:700}}>1,240</span></div>
                <div className="lobby-wb-score-row" style={{opacity:.7}}><span>Artie</span><span>980</span></div>
              </div>
              {/* Doodle SVG */}
              <div className="lobby-wb-doodle">
                <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="lobby-doodle-svg">
                  <ellipse cx="100" cy="100" rx="70" ry="40" fill="#ffd54f" stroke="#1f1b12" strokeWidth="3"/>
                  <path d="M160,90 Q180,70 175,100 Q180,130 160,110" fill="#74f1a5" stroke="#1f1b12" strokeWidth="2"/>
                  <path d="M40,95 Q20,80 35,100 Q20,120 40,105" fill="#74f1a5" stroke="#1f1b12" strokeWidth="2"/>
                  <circle cx="75" cy="92" r="4" fill="#1f1b12"/>
                  <path d="M85,105 Q100,115 115,105" fill="none" stroke="#1f1b12" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {/* Chat bubbles */}
                <div className="lobby-chat-bubble lobby-chat-1">It's a fish 🐟</div>
                <div className="lobby-chat-bubble lobby-chat-2">What is THAT? 🤨</div>
                <div className="lobby-chat-bubble lobby-chat-3">Banana! 🍌</div>
              </div>
              {/* Toolbox */}
              <div className="lobby-wb-toolbox">
                <span style={{background:'var(--dd-primary)'}}/>
                <span style={{background:'var(--dd-secondary)'}}/>
                <span style={{background:'var(--dd-error, #ba1a1a)'}}/>
                <span style={{background:'var(--dd-tertiary)'}}/>
                <span className="material-symbols-outlined" style={{fontSize:20,opacity:.5}}>brush</span>
              </div>
            </div>
          </div>

          {/* Right: Setup panel */}
          <div className="lobby-panel">
            <div className="lobby-panel-card">
              {/* Join room */}
              <div className="lobby-join-section">
                <label className="lobby-label">JOIN A ROOM</label>
                <div className="lobby-join-row">
                  <input
                    className="lobby-join-input"
                    placeholder="Enter room code…"
                    value={joinId}
                    onChange={e => setJoinId(e.target.value.toUpperCase())}
                    maxLength={8}
                  />
                  <button
                    className="lobby-btn-join"
                    onClick={() => { setError(''); send('join_room', { room_id: joinId }) }}
                  >
                    Join Room
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="lobby-divider"><span>or</span></div>

              {/* Create room */}
              <button
                className="lobby-btn-create"
                onClick={() => { setError(''); send('create_room') }}
              >
                Create Private Room
              </button>
            </div>
          </div>
        </div>

        {/* Game Tips */}
        <div className="lobby-tips">
          <div className="lobby-tip-card lobby-tip-1">
            <span className="lobby-tip-emoji">🎨</span>
            <h3>Draw clearly.</h3>
            <p>Even if you can only draw sticks, keep it simple for the guessers!</p>
          </div>
          <div className="lobby-tip-card lobby-tip-2">
            <span className="lobby-tip-emoji">⚡</span>
            <h3>Guess quickly.</h3>
            <p>The faster you type the right answer, the more points you snag.</p>
          </div>
          <div className="lobby-tip-card lobby-tip-3">
            <span className="lobby-tip-emoji">😂</span>
            <h3>Best Memories.</h3>
            <p>Bad drawings usually lead to the loudest laughs in the chat.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="lobby-footer">
        <div className="lobby-footer-inner">
          <div>
            <div className="lobby-footer-brand">DoodleDash</div>
            <div className="lobby-footer-copy">© 2025 DoodleDash — Draw. Laugh. Repeat.</div>
          </div>
          <div className="lobby-footer-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Support</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Waiting Room (full-page DoodleDash style) ───────────────────────────────

// Chair positions for up to 8 players around the semicircle
const CHAIR_POSITIONS = [
  { left: '8%',  bottom: '42%' },  // left-back
  { left: '5%',  bottom: '26%' },  // left-front
  { left: '22%', bottom: '14%' },  // center-left-front
  { left: '38%', bottom: '8%' },   // center-left
  { left: '54%', bottom: '8%' },   // center-right
  { left: '70%', bottom: '14%' },  // center-right-front
  { left: '85%', bottom: '26%' },  // right-front
  { left: '82%', bottom: '42%' },  // right-back
]

const AVATAR_COLORS = PLAYER_COLORS

function RoomScreen({ room, error, isCreator, send, setRoom, setScreen, username }) {
  const ready = room?.status === 'ready'
  const code = room?.room_id || ''
  const players = room?.players || []
  const [copied, setCopied] = useState(false)
  const [rounds, setRounds] = useState(3)
  const [drawTime, setDrawTime] = useState(80)

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  const startGame = () => {
    send('start_game', { rounds, draw_time: drawTime })
  }

  const leaveRoom = () => { send('leave_room'); setRoom(null); setScreen('lobby') }

  // Format seconds to display string
  const fmtTime = (s) => s >= 60 ? `${Math.floor(s/60)}m ${s%60 ? s%60 + 's' : ''}`.trim() : `${s}s`

  return (
    <div className="wr-page">
      {/* BG decorations */}
      <div className="wr-bg-decor" aria-hidden="true">
        <span className="material-symbols-outlined" style={{top:'10%',left:'5%',fontSize:48,color:'var(--dd-primary)',animationDelay:'0s'}}>star</span>
        <span className="material-symbols-outlined" style={{bottom:'20%',right:'8%',fontSize:64,color:'var(--dd-secondary)',animationDelay:'2s'}}>brush</span>
        <span className="material-symbols-outlined" style={{top:'50%',left:'20%',fontSize:36,color:'var(--dd-tertiary)',animationDelay:'1s'}}>palette</span>
      </div>

      {/* Nav */}
      <nav className="wr-nav" aria-label="Waiting room navigation">
        <div className="wr-nav-inner">
          <div className="wr-nav-brand">
            <span className="material-symbols-outlined" style={{fontSize:28,color:'var(--dd-primary)'}}>draw</span>
            <span>DoodleDash</span>
          </div>
          <div className="wr-nav-right">
            <button className="wr-btn-leave-nav" onClick={leaveRoom}>
              Leave Room
              <span className="material-symbols-outlined" style={{fontSize:18}}>logout</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="wr-main">
        {/* Left: Illustration + Players */}
        <div className="wr-left">
          {/* Classroom illustration with player avatars on chairs */}
          <div className="wr-classroom">
            {/* SVG classroom: whiteboard + chairs semicircle */}
            <svg className="wr-classroom-svg" viewBox="0 0 600 380" xmlns="http://www.w3.org/2000/svg">
              {/* Floor shadow */}
              <ellipse cx="300" cy="340" rx="280" ry="30" fill="#eae2d3" opacity=".5"/>
              {/* Whiteboard stand */}
              <line x1="240" y1="200" x2="210" y2="310" stroke="#a07d50" strokeWidth="4"/>
              <line x1="360" y1="200" x2="390" y2="310" stroke="#a07d50" strokeWidth="4"/>
              <line x1="250" y1="260" x2="350" y2="260" stroke="#a07d50" strokeWidth="3"/>
              {/* Whiteboard shelf */}
              <rect x="220" y="196" width="160" height="8" rx="2" fill="#a07d50"/>
              <rect x="260" y="198" width="20" height="4" rx="1" fill="#1f1b12"/>
              <rect x="285" y="198" width="14" height="4" rx="1" fill="#ba1a1a"/>
              {/* Whiteboard */}
              <rect x="180" y="60" width="240" height="140" rx="6" fill="#fff" stroke="#1f1b12" strokeWidth="3"/>
              <path d="M185,65 L415,65 L415,195 L185,195 Z" fill="url(#wb-grad)" opacity=".3"/>
              <defs><linearGradient id="wb-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e3f2fd"/><stop offset="1" stopColor="transparent"/></linearGradient></defs>
              {/* Doodle sparkles */}
              <text x="160" y="50" fontSize="20" opacity=".15" transform="rotate(-15 160 50)">✏️</text>
              <text x="430" y="80" fontSize="18" opacity=".15" transform="rotate(10 430 80)">⭐</text>
              <text x="450" y="140" fontSize="16" opacity=".12">💦</text>
              <text x="140" y="160" fontSize="14" opacity=".12" transform="rotate(-20 140 160)">✏️</text>
              <text x="300" y="40" fontSize="16" opacity=".12">✨</text>

              {/* Chairs - semicircle */}
              {CHAIR_POSITIONS.map((pos, i) => {
                const cx = parseFloat(pos.left) / 100 * 600
                const cy = 380 - parseFloat(pos.bottom) / 100 * 380
                const colors = ['#4285f4','#4285f4','#fbbc04','#ea4335','#34a853','#4285f4','#fbbc04','#4285f4']
                return (
                  <g key={i} opacity={i < players.length ? 1 : .3}>
                    {/* Chair back */}
                    <rect x={cx-14} y={cy-28} width={28} height={20} rx={3} fill={colors[i]} stroke="#1f1b12" strokeWidth="1.5"/>
                    {/* Chair seat */}
                    <rect x={cx-12} y={cy-8} width={24} height={6} rx={2} fill={colors[i]} stroke="#1f1b12" strokeWidth="1.5"/>
                    {/* Chair legs */}
                    <line x1={cx-10} y1={cy-2} x2={cx-12} y2={cy+14} stroke="#555" strokeWidth="1.5"/>
                    <line x1={cx+10} y1={cy-2} x2={cx+12} y2={cy+14} stroke="#555" strokeWidth="1.5"/>
                  </g>
                )
              })}
            </svg>

            {/* Player avatars overlaid on chairs */}
            {players.map((p, i) => {
              const pos = CHAIR_POSITIONS[i] || CHAIR_POSITIONS[CHAIR_POSITIONS.length - 1]
              const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
              return (
                <div key={p} className="wr-avatar-on-chair" style={{left: pos.left, bottom: pos.bottom, animationDelay: `${i * 0.5}s`}}>
                  <div className="wr-avatar-circle" style={{borderColor: color, background: color + '22'}}>
                    <span style={{color}}>{p[0]?.toUpperCase()}</span>
                  </div>
                  <span className="wr-avatar-name" style={{background: color}}>{p}</span>
                </div>
              )
            })}
          </div>

          {/* Player Cards Grid */}
          <div className="wr-players-section">
            <h2 className="wr-section-title">
              Artists
              <span className="wr-player-count">{players.length}/8</span>
            </h2>
            <div className="wr-player-grid">
              {players.map((p, i) => {
                const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
                return (
                  <div key={p} className="wr-player-card" style={{transform: `rotate(${(i % 3 - 1) * 1.5}deg)`}}>
                    <div className="wr-player-card-avatar" style={{borderColor: color, background: color + '22'}}>
                      <span style={{color, fontSize: 22, fontWeight: 700}}>{p[0]?.toUpperCase()}</span>
                    </div>
                    <span className="wr-player-card-name">{p}</span>
                    {p === room?.creator_id ? (
                      <span className="wr-host-badge">Host</span>
                    ) : (
                      <span className="wr-ready-badge">Ready</span>
                    )}
                  </div>
                )
              })}
              {/* Empty slots */}
              {Array.from({length: Math.max(0, 2 - Math.max(0, players.length - 2))}, (_, i) => (
                <div key={`empty-${i}`} className="wr-player-card wr-player-card-empty">
                  <span className="material-symbols-outlined" style={{fontSize: 28, color: '#7f7662', marginBottom: 6}}>person_add</span>
                  <span style={{fontSize: 10, fontWeight: 800, color: '#7f7662', textAlign: 'center', lineHeight: 1.2}}>
                    {['Waiting for an artist...', 'Probably still copying the code...'][i] || 'Open slot'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Room Info + Settings */}
        <div className="wr-right">
          {/* Room Code Panel */}
          <div className="wr-code-panel">
            <div className="wr-code-panel-header">
              <h3>Room Code</h3>
              <span className="wr-live-dot" />
            </div>
            <div className="wr-code-display">
              <span className="wr-code-text">{code}</span>
            </div>
            <div className="wr-code-actions">
              <button className="wr-code-btn" onClick={copyCode}>
                <span className="material-symbols-outlined" style={{fontSize: 18}}>
                  {copied ? 'check_circle' : 'content_copy'}
                </span>
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {error && <div className="wr-error">{error}</div>}

          {/* Game Settings */}
          <div className="wr-settings-panel">
            <div className="wr-settings-header">
              <span className="material-symbols-outlined" style={{color: 'var(--dd-primary)'}}>settings_suggest</span>
              <h3>Game Settings</h3>
            </div>

            {/* Rounds */}
            <div className="wr-setting-group">
              <label className="wr-setting-label">Rounds</label>
              <div className="wr-rounds-grid">
                {[3, 5, 7].map(r => (
                  <button
                    key={r}
                    className={`wr-round-btn ${rounds === r ? 'wr-round-active' : ''}`}
                    onClick={() => isCreator && setRounds(r)}
                    disabled={!isCreator}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Draw Time */}
            <div className="wr-setting-group">
              <label className="wr-setting-label">
                Draw Time: <strong>{fmtTime(drawTime)}</strong>
              </label>
              {isCreator ? (
                <div className="wr-time-control">
                  <input
                    type="range"
                    min={10}
                    max={600}
                    step={10}
                    value={drawTime}
                    onChange={e => setDrawTime(+e.target.value)}
                    className="wr-time-slider"
                  />
                  <div className="wr-time-labels">
                    <span>10s</span>
                    <span>5m</span>
                    <span>10m</span>
                  </div>
                </div>
              ) : (
                <div className="wr-time-readonly">{fmtTime(drawTime)} per round</div>
              )}
            </div>

            {/* Start Game CTA */}
            <div className="wr-cta-section">
              {isCreator ? (
                <button
                  className="wr-btn-start"
                  onClick={startGame}
                  disabled={!ready}
                >
                  <span className="material-symbols-outlined" style={{fontSize: 32}}>play_circle</span>
                  <span>{ready ? 'Start Game' : 'Need 2+ Players'}</span>
                </button>
              ) : (
                <div className="wr-waiting-msg">
                  <span className="material-symbols-outlined" style={{fontSize: 20, animation: 'room-pulse 1.5s infinite'}}>hourglass_top</span>
                  Waiting for the host to start…
                </div>
              )}
              <button className="wr-btn-leave-bottom" onClick={leaveRoom}>Leave Room</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Game screen ──────────────────────────────────────────────────────────────

function GameScreen({
  drawerID, username, send, guess, setGuess,
  remoteStrokes, scores, word, wordLength,
  gamePhase, roundNum, totalRounds, timer, events,
  candidates, setCandidates, hostId, wrongMsg, setWrongMsg,
}) {
  const isDrawer = drawerID === username

  // Drawing tool state — lives here so it persists across re-renders
  const [brushColor, setBrushColor] = useState('#000000')
  const [brushSize, setBrushSize]   = useState(6)
  const [activeTool, setActiveTool] = useState('pencil')

  // Stable callbacks — send is already stable (useCallback([]))
  const sendDraw  = useCallback((stroke) => send('draw', { stroke }), [send])
  const sendClear = useCallback(() => send('clear_canvas'), [send])

  const submitGuess = (e) => {
    e.preventDefault()
    if (!guess.trim()) return
    send('guess', { guess: guess.trim() })
    setGuess('')
  }

  const timerLow = timer !== null && timer <= 15

  return (
    <>
      <MainGameLayout
        isDrawer={isDrawer} sendDraw={sendDraw} sendClear={sendClear}
        guess={guess} setGuess={setGuess} submitGuess={submitGuess}
        timerLow={timerLow}
        remoteStrokes={remoteStrokes} scores={scores} username={username}
        drawerID={drawerID} word={word} wordLength={wordLength}
        gamePhase={gamePhase} roundNum={roundNum} totalRounds={totalRounds}
        timer={timer}
        onSkip={() => send('skip')}
        onLeave={() => { send('leave_room'); window.location.reload() }}
        wrongMsg={wrongMsg} setWrongMsg={setWrongMsg}
        brushColor={brushColor} setBrushColor={setBrushColor}
        brushSize={brushSize} setBrushSize={setBrushSize}
        activeTool={activeTool} setActiveTool={setActiveTool}
      />

      {/* Word choice overlay */}
      {gamePhase === 'choosing' && isDrawer && candidates.length > 0 && (
        <div className="gm-overlay">
          <div className="gm-modal">
            <h2>Choose a Word</h2>
            <p className="sub">Pick one to draw. You have {timer}s.</p>
            <div className="gm-word-choices">
              {candidates.map(w => (
                <button key={w} className="gm-word-choice-btn"
                  onClick={() => { send('choose_word', { word: w }); setCandidates([]) }}>
                  {w}
                </button>
              ))}
            </div>
            <div className="gm-choice-timer">{timer}</div>
          </div>
        </div>
      )}

      {/* Round end overlay */}
      {gamePhase === 'round_end' && (
        <div className="gm-overlay">
          <div className="gm-modal">
            <h2>Round {roundNum} Over!</h2>
            <p className="sub">The word was:</p>
            <div className="gm-round-word">{word}</div>
            <GmScoresTable scores={scores} me={username} />
            {username === hostId ? (
              <button className="gm-btn-next" onClick={() => send('next_round')}>
                Start Next Round ▶
              </button>
            ) : (
              <div className="gm-waiting-host">
                <span className="material-symbols-outlined" style={{animation:'room-pulse 1.5s infinite'}}>hourglass_top</span>
                Waiting for host to start next round…
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Game over ────────────────────────────────────────────────────────────────

function GameOverScreen({ finalResult, error, username, setFinalResult, setScreen, setRoom }) {
  const { scores: s, winner } = finalResult || {}
  return (
    <div className="gm-page" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh'}}>
      {/* BG doodles */}
      <div className="gm-bg-doodles" aria-hidden="true">
        <span className="material-symbols-outlined" style={{fontSize:120,top:20,left:10,color:'#ffd54f',animationDelay:'0s'}}>brush</span>
        <span className="material-symbols-outlined" style={{fontSize:80,bottom:40,right:20,color:'#7bc9ff',animationDelay:'1s'}}>palette</span>
        <span className="material-symbols-outlined" style={{fontSize:100,top:'50%',left:'25%',color:'#74f1a5',animationDelay:'2s'}}>emoji_events</span>
      </div>

      <div className="gm-modal" style={{maxWidth:520,position:'relative',zIndex:10}}>
        <div style={{fontSize:64,marginBottom:8}}>🏆</div>
        <h2>Game Over!</h2>
        <div style={{
          fontFamily:'Quicksand, sans-serif',
          fontSize:28, fontWeight:700,
          color: '#006d3d',
          margin:'8px 0 16px',
        }}>
          {winner ? `${winner} wins!` : "It's a Draw!"}
        </div>
        {error && (
          <div className="gm-wrong-msg" style={{justifyContent:'center',marginBottom:16}}>{error}</div>
        )}
        <GmScoresTable scores={s || {}} me={username} />
        <button
          className="gm-btn-next"
          style={{marginTop:16,width:'100%'}}
          onClick={() => { setFinalResult(null); setScreen('lobby'); setRoom(null) }}
        >
          🎨 Play Again
        </button>
      </div>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────


export default function App() {
  // Auth
  const [token,    setToken]    = useState(() => localStorage.getItem('token') || '')
  const [username, setUsername] = useState(() => localStorage.getItem('username') || localStorage.getItem('guestNick') || '')
  const [isGuest,  setIsGuest]  = useState(() => !localStorage.getItem('token') && !!localStorage.getItem('guestNick'))

  // Screens: welcome | auth | lobby | room | game | game_over
  // ponytail: welcome is the landing page, shown only when no session exists
  const [screen, setScreen] = useState(token || isGuest ? 'lobby' : 'welcome')
  const [error,  setError]  = useState('')

  // Room state
  const [room,       setRoom]       = useState(null)   // {room_id, players, status, ...}
  const [isCreator,  setIsCreator]  = useState(false)

  // Game state
  const [gamePhase,  setGamePhase]  = useState('waiting')  // waiting|choosing|drawing|round_end
  const [drawerID,   setDrawerID]   = useState(null)
  const [word,       setWord]       = useState(null)      // only set for drawer
  const [wordLength, setWordLength] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [scores,     setScores]     = useState({})
  const [timer,      setTimer]      = useState(null)
  const [roundNum,   setRoundNum]   = useState(0)
  const [totalRounds,setTotalRounds]= useState(3)
  const [events,     setEvents]     = useState([])     // chat/event log
  const [finalResult,setFinalResult]= useState(null)   // {scores, winner}
  const [guess,      setGuess]      = useState('')     // lifted up — survives game re-renders
  const [hostId,     setHostId]     = useState(null)   // who controls next-round
  const [wrongMsg,   setWrongMsg]   = useState('')     // wrong-guess feedback

  // Canvas
  const [remoteStrokes, setRemoteStrokes] = useState([])

  // WebSocket
  const wsRef = useRef(null)

  const pushEvent = useCallback((msg, cls = '') =>
    setEvents(ev => [...ev.slice(-49), { msg, cls, id: Date.now() + Math.random() }]),
  [])

  const send = useCallback((event, data = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ event, data }))
  }, [])

  // Connect WS once we have a token or a guest nickname
  useEffect(() => {
    if (!token && !isGuest) return
    // ponytail: logged-in uses ?token=, guest uses ?nickname=
    const params = token ? `token=${token}` : `nickname=${encodeURIComponent(username)}`
    const ws = new WebSocket(`${WS_BASE}/ws/?${params}`)
    wsRef.current = ws

    ws.onmessage = ({ data: raw }) => {
      const { event, data } = JSON.parse(raw)
      handleServerEvent(event, data)
    }
    ws.onerror = () => setError('WebSocket error — is the backend running?')
    ws.onclose = () => { /* reconnect handled by user action for now */ }

    return () => ws.close()
  }, [token, isGuest])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Server event handler ────────────────────────────────────────────────
  function handleServerEvent(event, data) {
    switch (event) {
      case 'connected':
        // Server confirms identity — update username if server assigned differently
        if (data.user_id) setUsername(data.user_id)
        break

      // Room events
      case 'room_created':
      case 'room_joined':
      case 'rejoined':
        setRoom(data.room)
        setIsCreator(event === 'room_created')
        setScreen('room')
        break

      case 'player_joined':
        setRoom(data.room)
        pushEvent(`${data.user_id} joined the room.`, 'system')
        break

      case 'player_left':
        setRoom(data.room)
        pushEvent(`${data.user_id} left.`, 'system')
        break

      case 'room_ready':
        setRoom(data.room)
        pushEvent('Room is ready! Waiting for game to start…', 'system')
        break

      case 'room_closed':
        setRoom(null); setScreen('lobby')
        setError('Room was closed.')
        break

      case 'opponent_reconnecting':
        pushEvent(`Opponent disconnected — ${data.grace_period}s grace period.`, 'system')
        break

      case 'opponent_reconnected':
        pushEvent('Opponent reconnected!', 'system')
        break

      // Game events
      case 'game_started':
        setScores(data.scores)
        setScreen('game')
        setGamePhase('waiting')
        pushEvent('Game started!', 'system')
        break

      case 'round_started':
        setRoundNum(data.round_number)
        setTotalRounds(data.total_rounds)
        setDrawerID(data.drawer_id)
        setTimer(data.choose_time)
        setRemoteStrokes([])
        setGamePhase('choosing')
        setWord(null); setWordLength(null); setCandidates([])
        pushEvent(`Round ${data.round_number} — ${data.drawer_id} is choosing a word…`, 'system')
        break

      case 'word_choices':
        // Only the drawer receives this
        setCandidates(data.candidates)
        setGamePhase('choosing')
        break

      case 'drawing_started':
        setDrawerID(data.drawer_id)
        setTimer(data.draw_time)
        setWordLength(data.word_length)
        setGamePhase('drawing')
        pushEvent(`${data.drawer_id} is drawing… (${data.word_length} letters)`, 'system')
        break

      case 'draw':
        setRemoteStrokes(s => [...s, data.stroke])
        break

      case 'canvas_cleared':
        setRemoteStrokes(s => [...s, { type: 'clear' }])
        break

      case 'player_guessed':
        setScores(data.scores)
        setWrongMsg('')  // clear any wrong-guess banner on correct guess
        pushEvent(`${data.player_id} guessed correctly! (+${data.earned})`, 'correct')
        break

      case 'wrong_guess':
        setWrongMsg(data.message || 'Wrong answer!')
        break

      case 'timer_tick':
        setTimer(data.remaining)
        break

      case 'round_ended':
        setScores(data.scores)
        setGamePhase('round_end')
        setTimer(null)
        setWord(data.word)
        setWrongMsg('')
        if (data.host_id) setHostId(data.host_id)
        pushEvent(`Round ended. Word was: ${data.word} (${data.reason})`, 'system')
        break

      case 'game_over':
        setFinalResult(data)
        setScreen('game_over')
        break

      case 'error':
        setError(`${data.code}: ${data.message}`)
        break

      default:
        console.log('Unhandled event:', event, data)
    }
  }

  // ── Route ───────────────────────────────────────────────────────────────
  // Conditional rendering — all screen components are stable module-level
  // references, so React will never unmount+remount them spuriously.
  if (screen === 'welcome') {
    return (
      <LandingPage
        onPlayGuest={() => setScreen('auth')}
        onLogin={() => setScreen('auth')}
      />
    )
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        error={error} setError={setError}
        setToken={setToken} setUsername={setUsername} setIsGuest={setIsGuest} setScreen={setScreen}
        pushEvent={pushEvent}
      />
    )
  }

  if (screen === 'lobby') {
    return (
      <LobbyScreen
        error={error} setError={setError}
        username={username} isGuest={isGuest} send={send}
        setToken={setToken} setUsername={setUsername} setIsGuest={setIsGuest} setScreen={setScreen}
      />
    )
  }

  if (screen === 'room') {
    return (
      <RoomScreen
        room={room} error={error} isCreator={isCreator}
        send={send} setRoom={setRoom} setScreen={setScreen}
        username={username}
      />
    )
  }

  if (screen === 'game_over') {
    return (
      <GameOverScreen
        finalResult={finalResult} error={error} username={username}
        setFinalResult={setFinalResult} setScreen={setScreen} setRoom={setRoom}
      />
    )
  }

  // Default: game screen
  return (
    <GameScreen
      drawerID={drawerID} username={username} send={send}
      guess={guess} setGuess={setGuess}
      remoteStrokes={remoteStrokes} scores={scores}
      word={word} wordLength={wordLength}
      gamePhase={gamePhase} roundNum={roundNum} totalRounds={totalRounds}
      timer={timer} events={events}
      candidates={candidates} setCandidates={setCandidates}
      hostId={hostId} wrongMsg={wrongMsg} setWrongMsg={setWrongMsg}
    />
  )
}
