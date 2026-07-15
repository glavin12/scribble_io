// ponytail: single-file landing page component, no extra deps
import './Landing.css'

export default function LandingPage({ onPlayGuest, onLogin }) {
  return (
    <div className="landing">
      {/* Background doodle pattern + floating icons */}
      <div className="lp-bg-icons">
        <div className="doodle-bg" style={{ position: 'absolute', inset: 0, opacity: .05 }} />
        <span className="material-symbols-outlined" style={{ top: 80, left: '10%', fontSize: 60, transform: 'rotate(12deg)' }}>draw</span>
        <span className="material-symbols-outlined" style={{ top: '40%', right: '5%', fontSize: 80, transform: 'rotate(-12deg)' }}>auto_awesome</span>
        <span className="material-symbols-outlined" style={{ bottom: '20%', left: '15%', fontSize: 70, transform: 'rotate(45deg)' }}>palette</span>
        <span className="material-symbols-outlined" style={{ top: '70%', right: '12%', fontSize: 50, transform: 'rotate(6deg)' }}>sentiment_very_satisfied</span>
      </div>

      {/* ── Navbar ── */}
      <header className="lp-nav">
        <nav className="lp-nav-inner">
          <div className="lp-logo">
            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 36 }}>edit</span>
            <span>DoodleDash</span>
          </div>
          <div className="lp-nav-links">
            <a href="#how" className="active">How it Works</a>
            <a href="#features">Gallery</a>
            <a href="#modes">Community</a>
          </div>
          <div className="lp-nav-right">
            <span className="material-symbols-outlined lp-nav-icon">code</span>
            <span className="material-symbols-outlined lp-nav-icon">dark_mode</span>
            <button className="lp-btn-nav interactive-press hard-drop-primary" onClick={onLogin}>
              Login
            </button>
          </div>
        </nav>
      </header>

      <main style={{ position: 'relative', zIndex: 10, maxWidth: 'var(--container-max)', margin: '0 auto', padding: '0 var(--margin-mobile)' }}>

        {/* ── Hero ── */}
        <section className="lp-hero lp-fade">
          <div className="lp-hero-text">
            <span className="lp-badge">FREE TO PLAY 🎨</span>
            <h1 className="font-display">
              Draw. Guess. <br /><span className="highlight">Laugh.</span>
            </h1>
            <p className="font-body-lg lp-hero-sub">
              The online multiplayer drawing game where terrible art creates unforgettable moments. No fancy tools, just you and your mouse.
            </p>
            <div className="lp-hero-btns">
              <button className="lp-btn lp-btn-guest hard-drop-primary interactive-press" onClick={onPlayGuest}>
                Play as Guest
              </button>
              <button className="lp-btn lp-btn-login hard-drop-secondary interactive-press" onClick={onLogin}>
                Login
              </button>
            </div>
            <p className="lp-hero-note">No account required to join a match.</p>
          </div>

          {/* Game Preview Illustration */}
          <div className="lp-preview">
            <div className="lp-preview-card hard-drop-tertiary">
              <div className="lp-preview-topbar">
                <div className="lp-preview-dots">
                  <span className="lp-preview-dot" style={{ background: 'var(--error)' }} />
                  <span className="lp-preview-dot" style={{ background: 'var(--primary-container)' }} />
                  <span className="lp-preview-dot" style={{ background: 'var(--tertiary)' }} />
                </div>
                <div className="lp-preview-timer">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>timer</span>
                  56s
                </div>
              </div>
              <div className="lp-preview-board sketch-border">
                <img src="/cat-doodle.png" alt="A charmingly bad doodle of a cat" />
                <div className="lp-chat-bubble lp-chat-r hard-drop-secondary">Is that a potato? 🥔</div>
                <div className="lp-chat-bubble lp-chat-l hard-drop-tertiary">No... it's a cat 😂</div>
              </div>
              <div className="lp-preview-players">
                <div className="lp-avatar-stack">
                  <div className="lp-avatar" style={{ background: 'var(--primary-container)' }}>
                    <img src="/avatar1.png" alt="Player avatar" />
                  </div>
                  <div className="lp-avatar" style={{ background: 'var(--secondary-container)' }}>
                    <img src="/avatar2.png" alt="Player avatar" />
                  </div>
                  <div className="lp-avatar-more">+3</div>
                </div>
                <div className="lp-pts">1,250 pts</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="lp-features lp-fade lp-fade-d1">
          <div className="lp-features-title">
            <h2 className="font-display">Why DoodleDash?</h2>
            <div className="lp-features-bar" />
          </div>
          <div className="lp-features-grid">
            <div className="lp-feature-card hard-drop-primary floating" style={{ animationDelay: '0s' }}>
              <div className="lp-feature-icon primary">
                <span className="material-symbols-outlined icon-filled" style={{ fontSize: 36, color: 'var(--on-primary-container)' }}>brush</span>
              </div>
              <h3 className="font-headline">Draw Anything</h3>
              <p>Simple tools that let your imagination run wild. Whether you're a pro or can't draw a stick figure.</p>
            </div>
            <div className="lp-feature-card hard-drop-secondary floating" style={{ animationDelay: '0.5s' }}>
              <div className="lp-feature-icon secondary">
                <span className="material-symbols-outlined icon-filled" style={{ fontSize: 36, color: 'var(--on-secondary-container)' }}>lightbulb</span>
              </div>
              <h3 className="font-headline">Guess Fast</h3>
              <p>Type your answers as quick as you can. The faster you guess, the more points you rack up!</p>
            </div>
            <div className="lp-feature-card hard-drop-tertiary floating" style={{ animationDelay: '1s' }}>
              <div className="lp-feature-icon tertiary">
                <span className="material-symbols-outlined icon-filled" style={{ fontSize: 36, color: 'var(--on-tertiary-container)' }}>emoji_events</span>
              </div>
              <h3 className="font-headline">Win Big</h3>
              <p>Climb the leaderboard and unlock wacky avatars, badges, and exclusive custom drawing tools.</p>
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how" className="lp-steps lp-fade lp-fade-d2">
          <h2 className="font-display">Quick Start Guide</h2>
          <div className="lp-steps-row">
            <div className="lp-steps-line" />
            {[
              { icon: 'meeting_room', label: 'Step 1', color: 'var(--primary)', title: 'Create Room', desc: 'Set your rules and topic' },
              { icon: 'group_add', label: 'Step 2', color: 'var(--secondary)', title: 'Invite Friends', desc: 'Send a link or join a public lobby' },
              { icon: 'edit', label: 'Step 3', color: 'var(--tertiary)', title: 'Draw It', desc: 'Unleash your inner Picasso' },
              { icon: 'question_mark', label: 'Step 4', color: 'var(--on-error-container)', title: 'Guess It', desc: 'Crack the code of the doodle' },
              { icon: 'star', label: 'Step 5', color: 'var(--on-primary-container)', title: 'Win!', desc: 'Celebrate your masterpiece', gold: true },
            ].map((s, i) => (
              <div className="lp-step" key={i}>
                <div className={`lp-step-circle${s.gold ? ' gold' : ''}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 30 }}>{s.icon}</span>
                </div>
                <span className="lp-step-label" style={{ color: s.color }}>{s.label}</span>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Game Modes ── */}
        <section id="modes" className="lp-modes lp-fade lp-fade-d3">
          <div className="lp-modes-grid">
            <div className="lp-mode-card secondary" onClick={onPlayGuest}>
              <div className="lp-mode-badge" style={{ background: 'var(--secondary)', transform: 'rotate(12deg)' }}>
                <span className="material-symbols-outlined">bolt</span>
              </div>
              <h3 style={{ color: 'var(--secondary)' }}>Quick Match</h3>
              <p>Jump into a random room with players from around the world. Instant action.</p>
              <div className="lp-mode-link" style={{ color: 'var(--secondary)' }}>
                Play Now <span className="material-symbols-outlined">arrow_forward</span>
              </div>
            </div>
            <div className="lp-mode-card primary" onClick={onPlayGuest}>
              <div className="lp-mode-badge" style={{ background: 'var(--primary)', transform: 'rotate(-12deg)' }}>
                <span className="material-symbols-outlined">lock</span>
              </div>
              <h3 style={{ color: 'var(--primary)' }}>Private Room</h3>
              <p>Create a password-protected space for you and your friends. No strangers allowed.</p>
              <div className="lp-mode-link" style={{ color: 'var(--primary)' }}>
                Invite Friends <span className="material-symbols-outlined">arrow_forward</span>
              </div>
            </div>
            <div className="lp-mode-card tertiary" onClick={onPlayGuest}>
              <div className="lp-mode-badge" style={{ background: 'var(--tertiary)', transform: 'rotate(6deg)' }}>
                <span className="material-symbols-outlined">settings_suggest</span>
              </div>
              <h3 style={{ color: 'var(--tertiary)' }}>Custom Lobby</h3>
              <p>Tweak everything from round timers to word lists. The ultimate playground.</p>
              <div className="lp-mode-link" style={{ color: 'var(--tertiary)' }}>
                Configure <span className="material-symbols-outlined">arrow_forward</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="lp-cta">
          <div className="lp-cta-inner">
            <div className="lp-cta-dots" />
            <h2 className="font-display">Ready to prove your <br />artistic genius?</h2>
            <div className="lp-cta-btns">
              <button className="lp-cta-btn-start hard-drop-primary interactive-press" onClick={onPlayGuest}>
                Start Playing
              </button>
              <button className="lp-cta-btn-private interactive-press" onClick={onPlayGuest}>
                Create Private Room
              </button>
            </div>
            <div className="lp-cta-stats">
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="lp-pulse" /> 2,401 Players Online
              </span>
              <span className="lp-cta-desktop">•</span>
              <span className="lp-cta-desktop">142 Active Games</span>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>edit</span>
            DoodleDash
          </div>
          <div className="lp-footer-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Support</a>
            <a href="#">Twitter</a>
          </div>
          <p className="lp-footer-copy">© 2024 DoodleDash. Let's get sketching!</p>
        </div>
      </footer>
    </div>
  )
}
