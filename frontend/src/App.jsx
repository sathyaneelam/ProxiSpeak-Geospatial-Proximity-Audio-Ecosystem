import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useSocket } from './hooks/useSocket'

const WIDTH = 1000
const HEIGHT = 600
const SPEED = 220
const RADIUS = 100
const PLAYER_RADIUS = 18
const OFFICE_ID = 'office-01'
const AVATAR_COLORS = ['#22d3ee', '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#60a5fa']

function readProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem('proxispeak-avatar-profile') || '{}')
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 20) : 'Guest',
      color: AVATAR_COLORS.includes(parsed.color) ? parsed.color : AVATAR_COLORS[0],
    }
  } catch {
    return { name: 'Guest', color: AVATAR_COLORS[0] }
  }
}

const roomZones = [
  {
    x: 45,
    y: 45,
    w: 265,
    h: 205,
    title: 'WORKSTATION A',
    subtitle: 'Focus desks + quiet work',
    fill: '#13273a',
    stroke: '#2d5676',
  },
  {
    x: 690,
    y: 45,
    w: 265,
    h: 205,
    title: 'WORKSTATION B',
    subtitle: 'Team workspace',
    fill: '#15293d',
    stroke: '#315d7f',
  },
  {
    x: 45,
    y: 350,
    w: 300,
    h: 205,
    title: 'MEETING AREA',
    subtitle: 'Collaborative discussion zone',
    fill: '#18283a',
    stroke: '#3e5f82',
  },
  {
    x: 650,
    y: 350,
    w: 305,
    h: 205,
    title: 'LOUNGE',
    subtitle: 'Relax + informal talks',
    fill: '#1b2940',
    stroke: '#47688e',
  },
]

const staticPeople = [
  { x: 365, y: 125, name: 'Alex', color: '#a78bfa' },
  { x: 600, y: 275, name: 'Sam', color: '#34d399' },
  { x: 460, y: 485, name: 'Taylor', color: '#fb923c' },
]

const obstacles = [
  // Workstation A desks
  { x: 78, y: 92, w: 72, h: 28, type: 'desk' },
  { x: 172, y: 92, w: 72, h: 28, type: 'desk' },
  { x: 78, y: 160, w: 72, h: 28, type: 'desk' },
  { x: 172, y: 160, w: 72, h: 28, type: 'desk' },

  // Workstation B desks
  { x: 724, y: 92, w: 72, h: 28, type: 'desk' },
  { x: 818, y: 92, w: 72, h: 28, type: 'desk' },
  { x: 724, y: 160, w: 72, h: 28, type: 'desk' },
  { x: 818, y: 160, w: 72, h: 28, type: 'desk' },

  // Meeting room table
  { x: 130, y: 412, w: 130, h: 58, type: 'table' },

  // Lounge sofa + table
  { x: 700, y: 420, w: 95, h: 34, type: 'sofa' },
  { x: 808, y: 420, w: 95, h: 34, type: 'sofa' },
  { x: 755, y: 485, w: 92, h: 34, type: 'coffee' },

  // Decorative side tables / counters
  { x: 445, y: 72, w: 110, h: 24, type: 'counter' },
  { x: 438, y: 520, w: 126, h: 20, type: 'counter' },
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function circleIntersectsRect(cx, cy, radius, rect) {
  const nearestX = clamp(cx, rect.x, rect.x + rect.w)
  const nearestY = clamp(cy, rect.y, rect.y + rect.h)

  const dx = cx - nearestX
  const dy = cy - nearestY

  return dx * dx + dy * dy < radius * radius
}

function isBlocked(x, y) {
  if (
    x - PLAYER_RADIUS < 10 ||
    x + PLAYER_RADIUS > WIDTH - 10 ||
    y - PLAYER_RADIUS < 10 ||
    y + PLAYER_RADIUS > HEIGHT - 10
  ) {
    return true
  }

  return obstacles.some((rect) =>
    circleIntersectsRect(x, y, PLAYER_RADIUS, rect)
  )
}

function App() {
  const {
    socketRef,
    isConnected,
    connectionError,
    joinOffice,
    moveAvatar,
  } = useSocket()

  const canvasRef = useRef(null)
  const keysRef = useRef(new Set())
  const playerRef = useRef({ x: 500, y: 300 })
  const remotePlayersRef = useRef(new Map())
  const lastSyncTimeRef = useRef(0)

  const [profile, setProfile] = useState(readProfile)
  const [draftName, setDraftName] = useState(() => readProfile().name)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const [position, setPosition] = useState({ x: 500, y: 300 })

  function saveName(event) {
    event.preventDefault()
    const cleanName = draftName.trim().slice(0, 20) || 'Guest'
    setDraftName(cleanName)
    setProfile((previous) => ({ ...previous, name: cleanName }))
  }

  function selectColor(color) {
    setProfile((previous) => ({ ...previous, color }))
  }

  useEffect(() => {
    localStorage.setItem('proxispeak-avatar-profile', JSON.stringify(profile))
  }, [profile])
  const [remoteRevision, setRemoteRevision] = useState(0)
  const [joinedOffice, setJoinedOffice] = useState(false)
  const [nearbyPeerIds, setNearbyPeerIds] = useState(() => new Set())

  // Keep live multiplayer presence separate from the static demo colleagues.
  useEffect(() => {
    const socket = socketRef.current
    if (!isConnected || !socket) {
      remotePlayersRef.current.clear()
      setRemoteRevision((version) => version + 1)
      setNearbyPeerIds(new Set())
      setJoinedOffice(false)
      return
    }

    const isOtherPlayer = (player) =>
      Boolean(player?.socketId && player.socketId !== socket.id)

    const handleOfficeJoined = (payload = {}) => {
      if (payload.status !== 'success' || payload.officeId !== OFFICE_ID) {
        console.warn('Office join was not successful:', payload)
        setJoinedOffice(false)
        return
      }

      remotePlayersRef.current.clear()
      for (const peer of payload.peers || []) {
        if (isOtherPlayer(peer)) {
          remotePlayersRef.current.set(peer.socketId, peer)
        }
      }
      setRemoteRevision((version) => version + 1)
      setJoinedOffice(true)
      console.log('Joined office:', payload.officeId, 'peers:', payload.peers?.length ?? 0)
    }

    const handleUserJoined = (peer) => {
      if (!isOtherPlayer(peer)) return
      remotePlayersRef.current.set(peer.socketId, peer)
      setRemoteRevision((version) => version + 1)
    }

    const handleAvatarMoved = (peer) => {
      if (!isOtherPlayer(peer)) return
      const previous = remotePlayersRef.current.get(peer.socketId)
      if (!previous) return // Initial presence comes from office:joined / user:joined.
      remotePlayersRef.current.set(peer.socketId, { ...previous, ...peer })
      setRemoteRevision((version) => version + 1)
    }

    const handleUserLeft = ({ socketId } = {}) => {
      if (!socketId) return
      remotePlayersRef.current.delete(socketId)
      setNearbyPeerIds((previous) => {
        const next = new Set(previous)
        next.delete(socketId)
        return next
      })
      setRemoteRevision((version) => version + 1)
    }

    const handleProximityEnter = ({ peerSocketId } = {}) => {
      if (!peerSocketId) return
      setNearbyPeerIds((previous) => new Set(previous).add(peerSocketId))
    }

    const handleProximityLeave = ({ peerSocketId } = {}) => {
      if (!peerSocketId) return
      setNearbyPeerIds((previous) => {
        const next = new Set(previous)
        next.delete(peerSocketId)
        return next
      })
    }

    socket.on('office:joined', handleOfficeJoined)
    socket.on('user:joined', handleUserJoined)
    socket.on('avatar:moved', handleAvatarMoved)
    socket.on('user:left', handleUserLeft)
    socket.on('proximity:enter', handleProximityEnter)
    socket.on('proximity:leave', handleProximityLeave)

    return () => {
      socket.off('office:joined', handleOfficeJoined)
      socket.off('user:joined', handleUserJoined)
      socket.off('avatar:moved', handleAvatarMoved)
      socket.off('user:left', handleUserLeft)
      socket.off('proximity:enter', handleProximityEnter)
      socket.off('proximity:leave', handleProximityLeave)
    }
  }, [isConnected, socketRef])

  // Listener registration above runs before this effect, so join replies are not missed.
  useEffect(() => {
    if (isConnected) {
      const { x, y } = playerRef.current
      joinOffice(OFFICE_ID, x, y, profile.name)
    }
  }, [isConnected, joinOffice, profile.name])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let frame
    let lastTime = 0
    let lastDisplay = 0

    const keydown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      const key = e.key.toLowerCase()
      if (
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)
      ) {
        e.preventDefault()
        keysRef.current.add(key)
      }
    }

    const keyup = (e) => {
      keysRef.current.delete(e.key.toLowerCase())
    }

    const clearKeys = () => keysRef.current.clear()

    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clearKeys)

    function drawRoundedRect(x, y, w, h, r, fill, stroke) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    function drawPlant(x, y) {
      ctx.beginPath()
      ctx.arc(x, y, 10, 0, Math.PI * 2)
      ctx.fillStyle = '#27484f'
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(x, y - 4)
      ctx.quadraticCurveTo(x - 7, y - 22, x - 1, y - 10)
      ctx.quadraticCurveTo(x + 1, y - 22, x + 8, y - 5)
      ctx.strokeStyle = '#3ddc97'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    function drawAvatar(x, y, name, color) {
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowBlur = 22
      ctx.shadowColor = color
      ctx.fill()
      ctx.shadowBlur = 0

      ctx.beginPath()
      ctx.arc(x, y, 22, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = '600 13px Arial'
      ctx.fillText(name, x, y - 29)
    }

    function drawRoom(zone) {
      drawRoundedRect(zone.x, zone.y, zone.w, zone.h, 20, zone.fill, zone.stroke)

      const glow = ctx.createLinearGradient(zone.x, zone.y, zone.x + zone.w, zone.y + zone.h)
      glow.addColorStop(0, 'rgba(255,255,255,0.07)')
      glow.addColorStop(1, 'rgba(255,255,255,0.01)')
      drawRoundedRect(zone.x + 6, zone.y + 6, zone.w - 12, zone.h - 12, 16, glow)

      ctx.fillStyle = '#dbeafe'
      ctx.font = '700 14px Arial'
      ctx.textAlign = 'left'
      ctx.fillText(zone.title, zone.x + 18, zone.y + 26)

      ctx.fillStyle = '#9ab2ca'
      ctx.font = '11px Arial'
      ctx.fillText(zone.subtitle, zone.x + 18, zone.y + 44)
    }

    function drawObstacle(item) {
      if (item.type === 'desk') {
        drawRoundedRect(item.x, item.y, item.w, item.h, 8, '#375f86', '#6ea8d6')
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(item.x + 8, item.y + 5, item.w - 16, 4)
      } else if (item.type === 'table') {
        drawRoundedRect(item.x, item.y, item.w, item.h, 12, '#5f7b95', '#a4c0d8')
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fillRect(item.x + 16, item.y + 10, item.w - 32, 5)
      } else if (item.type === 'sofa') {
        drawRoundedRect(item.x, item.y, item.w, item.h, 12, '#4f657d', '#91aac5')
      } else if (item.type === 'coffee') {
        drawRoundedRect(item.x, item.y, item.w, item.h, 10, '#6a7c8f', '#b6c7d8')
      } else {
        drawRoundedRect(item.x, item.y, item.w, item.h, 8, '#3a5068', '#738ba4')
      }
    }

    function render(time) {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0
      lastTime = time

      const p = playerRef.current
      const k = keysRef.current

      let dx =
        Number(k.has('d') || k.has('arrowright')) -
        Number(k.has('a') || k.has('arrowleft'))
      let dy =
        Number(k.has('s') || k.has('arrowdown')) -
        Number(k.has('w') || k.has('arrowup'))

      const length = Math.hypot(dx, dy)

      if (length > 0) {
        dx /= length
        dy /= length

        const nextX = p.x + dx * SPEED * dt
        const nextY = p.y + dy * SPEED * dt

        if (!isBlocked(nextX, p.y)) {
          p.x = nextX
        }

        if (!isBlocked(p.x, nextY)) {
          p.y = nextY
        }

        if (socketRef.current?.connected) {
          const now = performance.now()
          if (now - lastSyncTimeRef.current >= 100) {
            moveAvatar(OFFICE_ID, p.x, p.y)
            lastSyncTimeRef.current = now
          }
        }
      }

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
      bg.addColorStop(0, '#081120')
      bg.addColorStop(0.55, '#0d1728')
      bg.addColorStop(1, '#0b1220')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      // Soft lighting blobs
      const glow1 = ctx.createRadialGradient(170, 120, 10, 170, 120, 180)
      glow1.addColorStop(0, 'rgba(34, 211, 238, 0.12)')
      glow1.addColorStop(1, 'rgba(34, 211, 238, 0)')
      ctx.fillStyle = glow1
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const glow2 = ctx.createRadialGradient(830, 460, 10, 830, 460, 220)
      glow2.addColorStop(0, 'rgba(139, 92, 246, 0.11)')
      glow2.addColorStop(1, 'rgba(139, 92, 246, 0)')
      ctx.fillStyle = glow2
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      // Subtle grid
      ctx.strokeStyle = 'rgba(104, 126, 160, 0.13)'
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

      // Central corridor
      drawRoundedRect(345, 55, 310, 490, 24, 'rgba(18, 33, 50, 0.72)', '#294158')

      roomZones.forEach(drawRoom)
      obstacles.forEach(drawObstacle)

      // decor
      drawPlant(336, 84)
      drawPlant(664, 84)
      drawPlant(336, 522)
      drawPlant(664, 522)

      // Proximity radius
      ctx.beginPath()
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34, 211, 238, 0.08)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)'
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])

      // Multiplayer remote players
      remotePlayersRef.current.forEach((player) => {
        if (typeof player.x !== 'number' || typeof player.y !== 'number') return

        drawAvatar(
          player.x,
          player.y,
          player.displayName && player.displayName !== 'Guest'
            ? player.displayName
            : `Player ${String(player.socketId).slice(0, 4)}`,
          '#f472b6'
        )
      })

      // Demo static colleagues (not real network peers)
      staticPeople.forEach((person) => {
        drawAvatar(person.x, person.y, person.name, person.color)
      })

      // You
      drawAvatar(p.x, p.y, `${profileRef.current.name} (YOU)`, profileRef.current.color)

      if (time - lastDisplay > 80) {
        setPosition((previous) => {
          const x = Math.round(p.x)
          const y = Math.round(p.y)
          return previous.x === x && previous.y === y ? previous : { x, y }
        })
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

  const nearbyPeople = useMemo(() => {
    const dynamicPlayers = Array.from(remotePlayersRef.current.values()).map((player) => ({
      id: player.socketId,
      name: player.displayName && player.displayName !== 'Guest'
        ? player.displayName
        : `Player ${String(player.socketId).slice(0, 4)}`,
      color: '#f472b6',
      x: player.x,
      y: player.y,
      live: true,
    }))

    const demoPeople = staticPeople.map((person) => ({
      ...person,
      id: `demo-${person.name}`,
      name: `${person.name} (Demo)`,
      live: false,
    }))

    return [...dynamicPlayers, ...demoPeople].map((person) => ({
      ...person,
      distance: Math.hypot(position.x - person.x, position.y - person.y),
    }))
  }, [position.x, position.y, remoteRevision])

  // Audio developer can later consume relative offsets for live peers only.
  const liveNearbyPeers = useMemo(() => nearbyPeople
    .filter((person) => person.live && person.distance <= RADIUS)
    .map((person) => ({
      socketId: person.id,
      distance: person.distance,
      dx: person.x - position.x,
      dy: person.y - position.y,
      serverInEarshot: nearbyPeerIds.has(person.id),
    })), [nearbyPeople, nearbyPeerIds, position.x, position.y])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          ◉ <span>ProxiSpeak</span>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        <div className="nav-active">◈ Virtual Office</div>
        <div className="nav-item">◉ Team Members</div>
        <div className="nav-item">♫ Spatial Audio</div>

        <div className="profile-panel">
          <div className="profile-title">YOUR AVATAR</div>
          <div className="profile-preview">
            <span className="profile-orb" style={{ background: profile.color, boxShadow: `0 0 18px ${profile.color}66` }} />
            <div><strong>{profile.name}</strong><small>Customize identity</small></div>
          </div>
          <form className="profile-name-form" onSubmit={saveName}>
            <label htmlFor="avatar-name">Display name</label>
            <div className="profile-name-row">
              <input id="avatar-name" value={draftName} maxLength={20} onChange={(e) => setDraftName(e.target.value)} placeholder="Your name" />
              <button type="submit">Save</button>
            </div>
          </form>
          <span className="profile-color-label">Avatar color</span>
          <div className="profile-colors" role="group" aria-label="Choose avatar color">
            {AVATAR_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className={color === profile.color ? 'profile-color selected' : 'profile-color'}
                style={{ background: color }}
                aria-label={`Select ${color} avatar color`}
                aria-pressed={color === profile.color}
                onClick={() => selectColor(color)}
              />
            ))}
          </div>
          <p className="profile-note">Names sync with teammates. Avatar colors are local until backend support is added.</p>
        </div>

        <div className="sidebar-bottom">
          <span className="status-dot" />{' '}
          {joinedOffice ? 'Live Multiplayer Active' : isConnected ? 'Joining Office...' : 'Backend Disconnected'}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE / VIRTUAL OFFICE</div>
            <h1>Virtual Office</h1>
            <p>
              Walk through beautifully designed zones, avoid furniture, and connect naturally.
            </p>
          </div>
          <div className="live-pill">
            {joinedOffice ? '● LIVE MULTIPLAYER' : isConnected ? '● JOINING OFFICE' : '● OFFLINE'}
          </div>
        </header>

        <section className="office-card">
          <div className="office-toolbar">
            <div>
              <h2>Office Floor 01</h2>
              <p>Interactive 2D environment with furniture collision</p>
            </div>
            <span className="controls-hint">W A S D / ARROW KEYS</span>
          </div>

          <div className="canvas-wrapper">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
          </div>

          <div className="office-footer">
            <div>
              <small>YOUR POSITION</small>
              <strong>
                X: {position.x} &nbsp; Y: {position.y}
              </strong>
            </div>

            <div>
              <small>PROXIMITY RANGE</small>
              <strong>100 PX</strong>
            </div>

            <div>
              <small>CONNECTION</small>
              <strong>{joinedOffice ? 'LIVE MULTIPLAYER' : isConnected ? 'JOINING OFFICE' : 'DISCONNECTED'}</strong>
            </div>
          </div>
        </section>

        <div className="bottom-grid">
          <section className="info-card">
            <h3>Nearby People</h3>
            <p>Distance updates as you move through the office.</p>

            {nearbyPeople.map((person) => (
              <div className="person-row" key={person.id}>
                <span
                  className="person-dot"
                  style={{ background: person.color }}
                />
                <span>{person.name}</span>
                <span className="person-distance">
                  {Math.round(person.distance)} px
                </span>
                <span
                  className={person.distance <= RADIUS ? 'nearby' : 'faraway'}
                >
                  {person.distance <= RADIUS ? 'Nearby' : 'Out of range'}
                </span>
              </div>
            ))}
          </section>

          <section className="info-card">
            <h3>Audio Engine</h3>
            <p>Prepared for Week 3 spatial audio integration.</p>
            <div className="audio-placeholder">◉ &nbsp; WebRTC + Web Audio API</div>
            <div className="audio-note">
              {connectionError
                ? `Connection issue: ${connectionError}`
                : `Live peers in range: ${liveNearbyPeers.length}. Voice is not connected yet.`}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
