import { useEffect, useRef, useState } from 'react'
import { useSocket } from './hooks/useSocket'
import './App.css'

const WIDTH = 1000
const HEIGHT = 600
const SPEED = 220
const RADIUS = 100
const OFFICE_ID = 'office-01'

const furniture = [
  { x: 80, y: 80, w: 180, h: 85, name: 'WORKSTATION A' },
  { x: 740, y: 80, w: 180, h: 85, name: 'WORKSTATION B' },
  { x: 80, y: 420, w: 180, h: 85, name: 'MEETING AREA' },
  { x: 740, y: 420, w: 180, h: 85, name: 'LOUNGE' },
]

const colleagues = [
  { x: 310, y: 150, name: 'Alex', color: '#a78bfa' },
  { x: 650, y: 300, name: 'Sam', color: '#34d399' },
  { x: 400, y: 460, name: 'Taylor', color: '#fb923c' },
]

function App() {
  const { socketRef, isConnected, connectionError, moveAvatar } = useSocket()
  const canvasRef = useRef(null)
  const keysRef = useRef(new Set())
  const playerRef = useRef({ x: 500, y: 300 })
  const remotePlayersRef = useRef(new Map())
  const [remotePlayers, setRemotePlayers] = useState([])
  const [position, setPosition] = useState({ x: 500, y: 300 })

  // Register listeners BEFORE joining so we don't miss the initial office state.
  useEffect(() => {
    const socket = socketRef.current
    if (!isConnected || !socket) {
      remotePlayersRef.current.clear()
      return
    }

    const refreshPlayers = () => {
      setRemotePlayers([...remotePlayersRef.current.values()])
    }

    const handleOfficeState = ({ players = [] } = {}) => {
      remotePlayersRef.current.clear()
      players.forEach((player) => {
        if (player.userId && player.userId !== socket.id) {
          remotePlayersRef.current.set(player.userId, player)
        }
      })
      refreshPlayers()
      // Our local player might already have moved before the join completed.
      const { x, y } = playerRef.current
      socket.emit('move-avatar', { officeId: OFFICE_ID, x, y })
    }

    const handleUserJoined = (player) => {
      if (!player?.userId || player.userId === socket.id) return
      remotePlayersRef.current.set(player.userId, player)
      refreshPlayers()
    }

    const handleAvatarMoved = ({ userId, x, y } = {}) => {
      if (!userId || userId === socket.id) return
      const existing = remotePlayersRef.current.get(userId)
      if (!existing) return
      remotePlayersRef.current.set(userId, { ...existing, x, y })
      refreshPlayers()
    }

    const handleUserLeft = ({ userId } = {}) => {
      if (!userId) return
      remotePlayersRef.current.delete(userId)
      refreshPlayers()
    }

    socket.on('office-state', handleOfficeState)
    socket.on('user-joined', handleUserJoined)
    socket.on('avatar-moved', handleAvatarMoved)
    socket.on('user-left', handleUserLeft)
    socket.emit('join-office', { officeId: OFFICE_ID })

    return () => {
      socket.off('office-state', handleOfficeState)
      socket.off('user-joined', handleUserJoined)
      socket.off('avatar-moved', handleAvatarMoved)
      socket.off('user-left', handleUserLeft)
    }
  }, [isConnected, socketRef])

  useEffect(() => {
    if (!isConnected) {
      remotePlayersRef.current.clear()
      setRemotePlayers([])
    }
  }, [isConnected])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame
    let lastTime = 0
    let lastDisplay = 0
    let lastSyncTime = 0

    const keydown = (e) => {
      const key = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
        e.preventDefault()
        keysRef.current.add(key)
      }
    }

    const keyup = (e) => keysRef.current.delete(e.key.toLowerCase())
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

        // Limit network traffic to approximately 10 position updates per second.
        if (time - lastSyncTime >= 100 && socketRef.current?.connected) {
          moveAvatar(OFFICE_ID, p.x, p.y)
          lastSyncTime = time
        }
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

      ctx.beginPath()
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34, 211, 238, 0.08)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)'
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])

      remotePlayersRef.current.forEach((player) => {
        if (Number.isFinite(player.x) && Number.isFinite(player.y)) {
          drawAvatar(player.x, player.y, `Player ${String(player.userId).slice(0, 4)}`, '#f472b6')
        }
      })
      colleagues.forEach((person) => drawAvatar(person.x, person.y, person.name, person.color))
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
  }, [moveAvatar, socketRef])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">◉ <span>ProxiSpeak</span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="nav-active">◈ Virtual Office</div>
        <div className="nav-item">◉ Team Members</div>
        <div className="nav-item">♫ Spatial Audio</div>
        <div className="sidebar-bottom">
          <span className="status-dot" /> {isConnected ? 'Multiplayer Connected' : 'Frontend Prototype'}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE / VIRTUAL OFFICE</div>
            <h1>Virtual Office</h1>
            <p>Move around. Connect naturally.</p>
          </div>
          <div className="live-pill">● {isConnected ? 'LIVE MULTIPLAYER' : 'LOCAL DEMO'}</div>
        </header>

        <section className="office-card">
          <div className="office-toolbar">
            <div>
              <h2>Office Floor 01</h2>
              <p>Interactive 2D environment</p>
            </div>
            <span className="controls-hint">W A S D / ARROW KEYS</span>
          </div>
          <div className="canvas-wrapper">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
          </div>
          <div className="office-footer">
            <div><small>YOUR POSITION</small><strong>X: {position.x} &nbsp; Y: {position.y}</strong></div>
            <div><small>PROXIMITY RANGE</small><strong>100 PX</strong></div>
            <div><small>CONNECTION</small><strong>{isConnected ? 'CONNECTED' : connectionError ? 'OFFLINE' : 'CONNECTING...'}</strong></div>
          </div>
        </section>

        <div className="bottom-grid">
          <section className="info-card">
            <h3>Nearby People</h3>
            <p>Live players and demo avatars for proximity visualization.</p>
            {remotePlayers.map((person) => {
              const distance = Math.hypot(position.x - person.x, position.y - person.y)
              return (
                <div className="person-row" key={person.userId}>
                  <span className="person-dot" style={{ background: '#f472b6' }} />
                  <span>Player {String(person.userId).slice(0, 4)}</span>
                  <span className="person-distance">{Math.round(distance)} px</span>
                  <span className={distance <= RADIUS ? 'nearby' : 'faraway'}>
                    {distance <= RADIUS ? 'Nearby' : 'Out of range'}
                  </span>
                </div>
              )
            })}
            {colleagues.map((person) => {
              const distance = Math.hypot(position.x - person.x, position.y - person.y)
              return (
                <div className="person-row" key={person.name}>
                  <span className="person-dot" style={{ background: person.color }} />
                  <span>{person.name} (demo)</span>
                  <span className="person-distance">{Math.round(distance)} px</span>
                  <span className={distance <= RADIUS ? 'nearby' : 'faraway'}>
                    {distance <= RADIUS ? 'Nearby' : 'Out of range'}
                  </span>
                </div>
              )
            })}
          </section>

          <section className="info-card">
            <h3>Audio Engine</h3>
            <p>Spatial audio integration is planned for Week 3.</p>
            <div className="audio-placeholder">◉ &nbsp; WebRTC + Web Audio API</div>
            <div className="audio-note">No microphone or live audio is connected yet.</div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
