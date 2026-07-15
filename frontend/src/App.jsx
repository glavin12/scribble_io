import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import Canvas from './Canvas'
import LandingPage from './Landing'

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Request failed') }
  return r.json()
}

async function apiJson(path, body, token) {
  const r = await fetch(path, {
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

function ScoresTable({ scores, me }) {
  const sorted = Object.entries(scores || {}).sort((a, b) => b[1] - a[1])
  return (
    <table className="final-scores">
      <thead><tr><th>Player</th><th>Pts</th></tr></thead>
      <tbody>
        {sorted.map(([p, pts], i) => (
          <tr key={p}>
            <td>{i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}{p}{p === me ? ' (you)' : ''}</td>
            <td className="pts">{pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MainGameLayout({
  isDrawer, sendDraw, sendClear, guess, setGuess, submitGuess, timerLow,
  remoteStrokes, scores, username, drawerID, word, wordLength,
  gamePhase, roundNum, totalRounds, timer, events, onSkip,
  wrongMsg, setWrongMsg,
}) {
  return (
    <div className="game-layout">
      <div className="game-header">
        <span className="round-label">Round {roundNum}/{totalRounds}</span>
        <span className="word-display">
          {isDrawer && word ? word.toUpperCase()
            : gamePhase === 'drawing' ? '_ '.repeat(wordLength || 0).trim()
            : gamePhase === 'choosing' ? `${drawerID} is choosing…`
            : '🎨 Scribble.io'}
        </span>
        <span className={`timer${timerLow ? ' low' : ''}`}>{timer ?? '–'}</span>
      </div>

      <Canvas isDrawer={isDrawer} onDraw={sendDraw} onClear={sendClear} remoteStrokes={remoteStrokes} />

      <div className="side-panel">
        <div className="scores-box">
          <div className="box-title">Scores</div>
          {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([p, s]) => (
            <div key={p} className={`score-row${p === username ? ' me' : ''}`}>
              <span className="score-name">{p} {p === drawerID ? '✏️' : ''}</span>
              <span className="score-val">{s}</span>
            </div>
          ))}
        </div>

        {!isDrawer && gamePhase === 'drawing' && (
          <div className="guess-box">
            <div className="box-title">Your guess</div>
            {wrongMsg && (
              <div className="wrong-msg" onClick={() => setWrongMsg('')}>{wrongMsg} ✕</div>
            )}
            <form className="guess-input-row" onSubmit={submitGuess}>
              <input value={guess} onChange={e => setGuess(e.target.value)} placeholder="Type and press Enter…" autoFocus />
              <button className="btn btn-primary btn-sm" type="submit">→</button>
            </form>
          </div>
        )}

        {isDrawer && gamePhase === 'drawing' && (
          <button className="btn btn-outline btn-sm" onClick={onSkip}>Skip word</button>
        )}

        <div className="events-box" style={{ flex: 1 }}>
          <div className="box-title">Events</div>
          <ul className="events-list">
            {events.map(ev => <li key={ev.id} className={ev.cls}>{ev.msg}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function AuthScreen({ error, setError, setToken, setUsername, setScreen, setIsGuest, pushEvent }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', password: '', email: '' })
  const [guestNick, setGuestNick] = useState('')
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
    <div className="center fade">
      <div className="card">
        <h1>🎨 Scribble.io</h1>

        {/* Guest path — fast, no credentials */}
        <p className="sub">Jump right in</p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={playAsGuest}>
          <div className="field"><label>Nickname</label>
            <input value={guestNick} onChange={e => setGuestNick(e.target.value)} placeholder="Pick a name…" maxLength={20} required />
          </div>
          <button className="btn btn-success" type="submit">Play as Guest 🎮</button>
        </form>

        <div className="auth-divider"><span>or</span></div>

        {/* Login/Register path */}
        <p className="sub" style={{marginBottom:'.75rem'}}>{mode === 'login' ? 'Log in for saved stats' : 'Create an account'}</p>
        <form onSubmit={submit}>
          <div className="field"><label>Username</label>
            <input value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} required />
          </div>
          {mode === 'register' && (
            <div className="field"><label>Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
            </div>
          )}
          <div className="field"><label>Password</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Log In' : 'Register'}</button>
        </form>
        <p style={{textAlign:'center', marginTop:'1rem', fontSize:'.9rem', color:'var(--muted)'}}>
          {mode === 'login' ? 'No account? ' : 'Have an account? '}
          <button className="btn btn-sm btn-outline" style={{marginLeft:'.4rem'}} onClick={() => { setMode(m => m==='login'?'register':'login'); setError('') }}>
            {mode === 'login' ? 'Register' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  )
}

// ── Lobby ─────────────────────────────────────────────────────────────────────

function LobbyScreen({ error, setError, username, isGuest, send, setToken, setUsername, setIsGuest, setScreen }) {
  const [joinId, setJoinId] = useState('')

  const leave = () => {
    localStorage.clear(); setToken(''); setUsername(''); setIsGuest(false); setScreen('auth')
  }

  return (
    <div className="center fade">
      <div className="card">
        <h1>🎨 Scribble.io</h1>
        <p className="sub">Welcome, <strong>{username}</strong>{isGuest ? ' (Guest)' : ''}</p>
        {error && <div className="error-box">{error}</div>}
        <div className="lobby-actions">
          <button className="btn btn-primary" onClick={() => { setError(''); send('create_room') }}>
            Create Room
          </button>
          <div style={{display:'flex', gap:'.5rem'}}>
            <input
              placeholder="Room code"
              value={joinId}
              onChange={e => setJoinId(e.target.value.toUpperCase())}
              style={{flex:1, textTransform:'uppercase', letterSpacing:'.1em'}}
              maxLength={8}
            />
            <button className="btn btn-outline" onClick={() => { setError(''); send('join_room', { room_id: joinId }) }}>
              Join
            </button>
          </div>
          <button className="btn btn-sm" style={{background:'none', color:'var(--muted)', marginTop:'.5rem'}} onClick={leave}>
            {isGuest ? 'Change nickname' : 'Log out'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Room (lobby waiting screen) ──────────────────────────────────────────────

function RoomScreen({ room, error, isCreator, send, setRoom, setScreen }) {
  const ready = room?.status === 'ready'
  return (
    <div className="center fade">
      <div className="card">
        <h1>Room</h1>
        <p className="sub">Share this code with a friend</p>
        <div className="room-id-badge">{room?.room_id}</div>
        {error && <div className="error-box">{error}</div>}
        <ul className="player-list">
          {room?.players?.map(p => (
            <li key={p}>
              <span className={`status-dot ${ready ? 'dot-green' : 'dot-yellow'}`} />
              {p} {p === room.creator_id && '👑'}
            </li>
          ))}
        </ul>
        {!ready && <p style={{color:'var(--muted)', textAlign:'center', fontSize:'.9rem'}}>Waiting for opponent…</p>}
        {ready && isCreator && (
          <button className="btn btn-success" onClick={() => send('start_game')}>
            Start Game 🎮
          </button>
        )}
        {ready && !isCreator && (
          <p style={{color:'var(--green)', textAlign:'center', fontWeight:700}}>Ready! Waiting for host…</p>
        )}
        <button className="btn btn-sm btn-outline" style={{marginTop:'1rem'}} onClick={() => { send('leave_room'); setRoom(null); setScreen('lobby') }}>
          Leave Room
        </button>
      </div>
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
  // guess is lifted to App() — defined alongside other game state above.
  const isDrawer = drawerID === username

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

  const layout = (
    <MainGameLayout
      isDrawer={isDrawer} sendDraw={sendDraw} sendClear={sendClear}
      guess={guess} setGuess={setGuess} submitGuess={submitGuess}
      timerLow={timerLow}
      remoteStrokes={remoteStrokes} scores={scores} username={username}
      drawerID={drawerID} word={word} wordLength={wordLength}
      gamePhase={gamePhase} roundNum={roundNum} totalRounds={totalRounds}
      timer={timer} events={events}
      onSkip={() => send('skip')}
      onChooseWord={(w) => { send('choose_word', { word: w }); setCandidates([]) }}
      wrongMsg={wrongMsg} setWrongMsg={setWrongMsg}
    />
  )

  return (
    <>
      {layout}
      {gamePhase === 'choosing' && isDrawer && candidates.length > 0 && (
        <div className="overlay">
          <div className="choice-card fade">
            <h2>Choose a word</h2>
            <p className="sub">Pick one to draw. You have {timer}s.</p>
            <div className="word-choices">
              {candidates.map(w => (
                <button key={w} className="word-choice-btn"
                  onClick={() => { send('choose_word', { word: w }); setCandidates([]) }}>
                  {w}
                </button>
              ))}
            </div>
            <div className="choice-timer">{timer}</div>
          </div>
        </div>
      )}
      {gamePhase === 'round_end' && (
        <div className="overlay">
          <div className="choice-card fade">
            <h2>Round {roundNum} over!</h2>
            <p className="sub">The word was: <strong style={{color:'var(--accent)'}}>{word}</strong></p>
            <ScoresTable scores={scores} me={username} />
            {username === hostId ? (
              <button
                className="btn btn-success"
                style={{marginTop:'1rem'}}
                onClick={() => send('next_round')}
              >
                Start Next Round ▶
              </button>
            ) : (
              <p style={{color:'var(--muted)', marginTop:'1rem', fontSize:'.9rem'}}>Waiting for host to start next round…</p>
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
    <div className="center fade">
      <div className="card result-card">
        <h1>🏆 Game Over</h1>
        <div className="winner">{winner ? `${winner} wins!` : 'Draw!'}</div>
        {error && <div className="error-box">{error}</div>}
        <ScoresTable scores={s || {}} me={username} />
        <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={() => { setFinalResult(null); setScreen('lobby'); setRoom(null) }}>
          Play Again
        </button>
      </div>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────


export default function App() {
  // Auth
  const [token,    setToken]    = useState(() => localStorage.getItem('token') || '')
  const [username, setUsername] = useState(() => localStorage.getItem('username') || '')
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
    const ws = new WebSocket(`ws://${location.host}/ws/?${params}`)
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
