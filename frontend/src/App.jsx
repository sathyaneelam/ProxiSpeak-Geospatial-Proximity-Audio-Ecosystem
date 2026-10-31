import { useEffect, useRef, useState } from 'react'
import './App.css'
import { useProximityAudio } from './audio/index.js'

const WIDTH = 1000
const HEIGHT = 600
const SPEED = 220
const RADIUS = 100

const furniture = [
  { x: 80, y: 80, w: 180, h: 85, type: 'desk', label: 'WORKSTATION A', name: 'WORKSTATION A', isCollidable: true },
  { x: 740, y: 80, w: 180, h: 85, type: 'desk', label: 'WORKSTATION B', name: 'WORKSTATION B', isCollidable: true },
  { x: 80, y: 420, w: 180, h: 85, type: 'wall', label: 'MEETING AREA', name: 'MEETING AREA', isCollidable: true },
  { x: 740, y: 420, w: 180, h: 85, type: 'sofa', label: 'LOUNGE', name: 'LOUNGE', isCollidable: true },
]

const colleagues = [
  { id: 'Alex', x: 310, y: 150, name: 'Alex', color: '#a78bfa' },
  { id: 'Sam', x: 650, y: 300, name: 'Sam', color: '#34d399' },
  { id: 'Taylor', x: 400, y: 460, name: 'Taylor', color: '#fb923c' },
]

function App() {
  const canvasRef = useRef(null)
  const keysRef = useRef(new Set())
  const playerRef = useRef({ x: 500, y: 300 })
  const [position, setPosition] = useState({ x: 500, y: 300 })
  const [userId] = useState(() => {
    const id = globalThis.crypto?.randomUUID?.()
    return `user_${id || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
  })

  const signalingUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_URL) || 'http://localhost:3000'

  // ProxiSpeak Member 4: Spatial Audio & WebRTC with Obstacle Sound Blocking
  const {
    isAudioActive,
    isMuted,
    isDeafened,
    audioState,
    audioError,
    peerMetrics,
    isToneSimulationActive,
    startAudio,
    stopAudio,
    toggleMute,
    toggleDeafen,
    toggleToneSimulation,
  } = useProximityAudio({
    userId,
    officeId: 'floor_01',
    localPosition: position,
    peers: colleagues,
    obstacles: furniture,
    earshotRadius: RADIUS,
    signalingUrl,
    preferredTransport: 'socketio',
  })

  const isAudioActiveRef = useRef(false)
  const isToneActiveRef = useRef(false)
  useEffect(() => {
    isAudioActiveRef.current = isAudioActive
    isToneActiveRef.current = isToneSimulationActive
  }, [isAudioActive, isToneSimulationActive])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let frame
    let lastTime = 0
    let lastDisplay = 0

    const keydown = (e) => {
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        keysRef.current.add(e.key.toLowerCase())
      }
    }

    const keyup = (e) => {
      keysRef.current.delete(e.key.toLowerCase())
    }

    const clearKeys = () => keysRef.current.clear()

    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clearKeys)

    function drawAvatar(x, y, name, color) {
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowBlur = 22
      ctx.shadowColor = color
      ctx.fill()
      ctx.shadowBlur = 0

      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = '600 13px Arial'
      ctx.fillText(name, x, y - 29)
    }

    function render(time) {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0
      lastTime = time

      const p = playerRef.current
      const k = keysRef.current

      let dx = Number(k.has('d') || k.has('arrowright')) - Number(k.has('a') || k.has('arrowleft'))
      let dy = Number(k.has('s') || k.has('arrowdown')) - Number(k.has('w') || k.has('arrowup'))

      const length = Math.hypot(dx, dy)
      if (length > 0) {
        dx /= length
        dy /= length
        p.x = Math.max(20, Math.min(WIDTH - 20, p.x + dx * SPEED * dt))
        p.y = Math.max(20, Math.min(HEIGHT - 20, p.y + dy * SPEED * dt))
      }

      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.fillStyle = '#0b1325'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      ctx.strokeStyle = '#1c2c42'
      ctx.lineWidth = 1

      for (let x = 0; x <= WIDTH; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, HEIGHT)
        ctx.stroke()
      }

      for (let y = 0; y <= HEIGHT; y += 40) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(WIDTH, y)
        ctx.stroke()
      }

      furniture.forEach((item) => {
        ctx.fillStyle = '#1d3047'
        ctx.strokeStyle = '#3c5773'
        ctx.lineWidth = 2
        ctx.fillRect(item.x, item.y, item.w, item.h)
        ctx.strokeRect(item.x, item.y, item.w, item.h)

        ctx.fillStyle = '#9db4cf'
        ctx.font = '11px Arial'
        ctx.textAlign = 'center'
        ctx.fillText(item.name, item.x + item.w / 2, item.y + item.h / 2)
      })

      const hasAudioLive = isAudioActiveRef.current || isToneActiveRef.current

      // Proximity Earshot Radius
      ctx.beginPath()
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = hasAudioLive ? 'rgba(34, 211, 238, 0.12)' : 'rgba(34, 211, 238, 0.08)'
      ctx.fill()
      ctx.strokeStyle = hasAudioLive ? 'rgba(34, 211, 238, 0.7)' : 'rgba(34, 211, 238, 0.5)'
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])

      // Render Colleagues and Spatial Audio Links
      colleagues.forEach((person) => {
        const dist = Math.hypot(p.x - person.x, p.y - person.y)
        if (dist <= RADIUS && hasAudioLive) {
          // Draw energetic spatial link beam
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(person.x, person.y)
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)'
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.stroke()
          ctx.setLineDash([])

          // Draw earshot audio pulse ring around the peer
          ctx.beginPath()
          ctx.arc(person.x, person.y, 25, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        drawAvatar(person.x, person.y, person.name, person.color)
      })

      drawAvatar(p.x, p.y, 'YOU', '#22d3ee')

      if (time - lastDisplay > 80) {
        setPosition({ x: Math.round(p.x), y: Math.round(p.y) })
        lastDisplay = time
      }

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clearKeys)
    }
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">◉ <span>ProxiSpeak</span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="nav-active">◈ Virtual Office</div>
        <div className="nav-item">◉ Team Members</div>
        <div className="nav-item">♫ Spatial Audio</div>

        <div className="sidebar-bottom">
          <span className="status-dot" /> Spatial Audio Live
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE / VIRTUAL OFFICE</div>
            <h1>Virtual Office</h1>
            <p>Move around with WASD. Enter 100px earshot to connect spatial voice.</p>
          </div>
          <div className="live-pill">
            ● {isAudioActive ? 'VOICE CONNECTED' : 'SPATIAL READY'}
          </div>
        </header>

        <section className="office-card">
          <div className="office-toolbar">
            <div>
              <h2>Office Floor 01</h2>
              <p>Interactive 2D environment with real-time WebRTC audio</p>
            </div>
            <span className="controls-hint">W A S D / ARROW KEYS</span>
          </div>

          <div className="canvas-wrapper">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
          </div>

          <div className="office-footer">
            <div><small>YOUR POSITION</small><strong>X: {position.x} &nbsp; Y: {position.y}</strong></div>
            <div><small>PROXIMITY EARSHOT</small><strong>{RADIUS} PX</strong></div>
            <div>
              <small>AUDIO STATE</small>
              <strong style={{ color: isAudioActive ? '#67e8f9' : '#94a3b8' }}>
                {isAudioActive
                  ? `${isMuted ? 'MIC MUTED' : 'MIC LIVE'}${isDeafened ? ' • DEAFENED' : ''}`
                  : 'STANDBY'}
              </strong>
            </div>
          </div>
        </section>

        <div className="bottom-grid">
          {/* Nearby Colleagues Section with Live Spatial Gain & Stereo Pan */}
          <section className="info-card">
            <div className="section-title-wrap">
              <h3>Nearby People</h3>
              <p>Avatars and live spatial attenuation metrics.</p>
            </div>
            {colleagues.map((person) => {
              const metrics = peerMetrics[person.name] || {}
              const distance = metrics.distance ?? Math.round(Math.hypot(position.x - person.x, position.y - person.y))
              const isNearby = distance <= RADIUS
              const gain = metrics.gain ?? 0
              const pan = metrics.pan ?? 0
              const panLabel = pan === 0 ? 'Center' : pan < 0 ? `L ${Math.round(Math.abs(pan) * 100)}%` : `R ${Math.round(pan * 100)}%`

              return (
                <div className="person-row" key={person.name}>
                  <span className="person-dot" style={{ background: person.color }} />
                  <span className="person-name">{person.name}</span>
                  <span className="person-distance">{distance} px</span>

                  {(isAudioActive || isToneSimulationActive) && (
                    <span
                      className={`audio-metrics-tag ${metrics.isObstructed ? 'obstructed' : ''}`}
                      title={`Volume Gain: ${gain}%, Stereo Panning: ${panLabel}${metrics.isObstructed ? ` (Sound dampened by obstacle: ${metrics.obstacleAttenuation}% transmitted)` : ''}`}
                    >
                      Vol: {gain}% | Pan: {panLabel}{metrics.isObstructed ? ' 🧱' : ''}
                    </span>
                  )}

                  <span className={isNearby ? 'nearby' : 'faraway'}>
                    {isNearby ? 'In Earshot' : 'Out of range'}
                  </span>
                </div>
              )
            })}
          </section>

          {/* Real-time WebRTC & Web Audio Engine Controls */}
          <section className="info-card">
            <div className="section-title-wrap">
              <div className="card-header-flex">
                <h3>Spatial Audio Engine</h3>
                <span className={`audio-pill-badge ${audioState}`}>
                  ● {audioState === 'connected' ? (isMuted ? 'Muted' : 'Voice Active') : audioState === 'requesting' ? 'Connecting...' : 'Standby'}
                </span>
              </div>
              <p>WebRTC P2P audio with smooth Web Audio API GainNode and StereoPannerNode.</p>
            </div>

            {audioError && (
              <div className="audio-error-box" role="alert">
                ⚠️ {audioError}
              </div>
            )}

            <div className="audio-action-container">
              {!isAudioActive ? (
                <button
                  id="btn-start-audio"
                  className="btn-audio-primary"
                  onClick={startAudio}
                  disabled={audioState === 'requesting'}
                >
                  🎙️ {audioState === 'requesting' ? 'Requesting Mic...' : 'Connect Spatial Voice'}
                </button>
              ) : (
                <div className="btn-audio-group">
                  <button
                    id="btn-toggle-mute"
                    className={`btn-audio-action ${isMuted ? 'btn-unmute' : 'btn-mute'}`}
                    onClick={toggleMute}
                  >
                    {isMuted ? '🔇 Unmute Mic' : '🎙️ Mute Mic'}
                  </button>
                  <button
                    id="btn-toggle-deafen"
                    className={`btn-audio-action ${isDeafened ? 'btn-undeafen' : 'btn-deafen'}`}
                    onClick={toggleDeafen}
                    title={isDeafened ? 'Resume incoming spatial audio' : 'Mute all incoming spatial audio'}
                  >
                    {isDeafened ? '🔊 Undeafen' : '🔇 Deafen'}
                  </button>
                  <button
                    id="btn-stop-audio"
                    className="btn-audio-action btn-disconnect"
                    onClick={stopAudio}
                  >
                    ⏹️ Disconnect
                  </button>
                </div>
              )}

              <div className="audio-demo-divider" />

              <div className="tone-demo-row">
                <button
                  id="btn-test-tone"
                  className={`btn-tone-toggle ${isToneSimulationActive ? 'active' : ''}`}
                  onClick={() => toggleToneSimulation(colleagues[0])}
                >
                  ♫ {isToneSimulationActive ? 'Stop Spatial Tone (Alex)' : 'Test Spatial Audio (Alex)'}
                </button>
                <small className="tone-hint">
                  {isToneSimulationActive
                    ? 'Chime active at Alex (310, 150). Move left/right/away to hear stereo pan & distance fade!'
                    : 'Hear spatial attenuation & stereo panning immediately without a 2nd user.'}
                </small>
              </div>
            </div>

            <div className="audio-specs-row">
              <div className="spec-item">
                <small>EARSHOT</small>
                <strong>{RADIUS} px</strong>
              </div>
              <div className="spec-item">
                <small>ATTENUATION</small>
                <strong>Smoothstep</strong>
              </div>
              <div className="spec-item">
                <small>PANNING</small>
                <strong>StereoPanner</strong>
              </div>
              <div className="spec-item">
                <small>SIGNALING</small>
                <strong>Contract Ready</strong>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App