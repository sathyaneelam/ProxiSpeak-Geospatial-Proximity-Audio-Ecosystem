import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useSocket } from './hooks/useSocket'
import { useProximityAudio } from './hooks/useProximityAudio'
import { AudioControls } from './components/AudioControls'

const WIDTH = 1000
const HEIGHT = 600
const SPEED = 220
const RADIUS = 100
const PLAYER_RADIUS = 18
const OFFICE_ID = 'office-01'

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

  const [position, setPosition] = useState({ x: 500, y: 300 })
  const [remotePlayers, setRemotePlayers] = useState(new Map())

  const {
    isAudioActive,
    isMicMuted,
    audioContextState,
    permissionState,
    audioError,
    activePeers,
    startAudio,
    stopAudio,
    toggleMute,
    resumeAudio,
    updateSpatialPositions,
  } = useProximityAudio({
    socketRef,
    myPosition: position,
    earshotRadius: RADIUS,
  })

  useEffect(() => {
    if (!isConnected || !socketRef.current) return

    const socket = socketRef.current

    const handleOfficeJoined = (data) => {
      const peers = data?.peers || data?.players || []
      remotePlayersRef.current.clear()

      peers.forEach((peer) => {
        const id = peer.socketId || peer.userId
        if (id && id !== socket.id) {
          remotePlayersRef.current.set(id, peer)
        }
      })

      setRemotePlayers(new Map(remotePlayersRef.current))
      updateSpatialPositions(remotePlayersRef.current)
      console.log('Office peers synced:', peers.length)
    }

    const handleUserJoined = (peer) => {
      const id = peer.socketId || peer.userId
      if (!id || id === socket.id) return

      remotePlayersRef.current.set(id, peer)
      setRemotePlayers(new Map(remotePlayersRef.current))
      updateSpatialPositions(remotePlayersRef.current)
      console.log('Peer joined:', id)
    }

    const handleAvatarMoved = (peer) => {
      const id = peer.socketId || peer.userId
      if (!id || id === socket.id) return

      const existing = remotePlayersRef.current.get(id)
      const updated = {
        ...(existing || {}),
        ...peer,
      }
      remotePlayersRef.current.set(id, updated)
      setRemotePlayers(new Map(remotePlayersRef.current))
      updateSpatialPositions(remotePlayersRef.current)
    }

    const handleUserLeft = (data) => {
      const id = data?.socketId || data?.userId
      if (id) {
        remotePlayersRef.current.delete(id)
        setRemotePlayers(new Map(remotePlayersRef.current))
        updateSpatialPositions(remotePlayersRef.current)
        console.log('Peer left:', id)
      }
    }

    // Backend official events
    socket.on('office:joined', handleOfficeJoined)
    socket.on('user:joined', handleUserJoined)
    socket.on('avatar:moved', handleAvatarMoved)
    socket.on('user:left', handleUserLeft)

    // Legacy fallback events
    socket.on('office-state', handleOfficeJoined)
    socket.on('user-joined', handleUserJoined)
    socket.on('avatar-moved', handleAvatarMoved)
    socket.on('user-left', handleUserLeft)

    return () => {
      socket.off('office:joined', handleOfficeJoined)
      socket.off('user:joined', handleUserJoined)
      socket.off('avatar:moved', handleAvatarMoved)
      socket.off('user:left', handleUserLeft)
      socket.off('office-state', handleOfficeJoined)
      socket.off('user-joined', handleUserJoined)
      socket.off('avatar-moved', handleAvatarMoved)
      socket.off('user-left', handleUserLeft)
    }
  }, [isConnected, socketRef, updateSpatialPositions])

  useEffect(() => {
    if (isConnected) {
      joinOffice(OFFICE_ID, {
        userId: socketRef.current?.id,
        displayName: 'You',
        x: position.x,
        y: position.y,
      })
      console.log('Joining ProxiSpeak office:', OFFICE_ID)
    }
  }, [isConnected, joinOffice, position.x, position.y, socketRef])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let frame
    let lastTime = 0
    let lastDisplay = 0

    const keydown = (e) => {
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
            updateSpatialPositions(remotePlayersRef.current)
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
          `Player ${String(player.userId).slice(0, 4)}`,
          '#f472b6'
        )
      })

      // Demo static colleagues
      staticPeople.forEach((person) => {
        drawAvatar(person.x, person.y, person.name, person.color)
      })

      // You
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
  }, [moveAvatar, socketRef, updateSpatialPositions])

  const nearbyPeople = useMemo(() => {
    const dynamicPlayers = Array.from(remotePlayers.values()).map((player) => ({
      name: player.displayName || `Player ${String(player.userId || player.socketId || '').slice(0, 4)}`,
      color: '#f472b6',
      x: player.x,
      y: player.y,
    }))

    return [...staticPeople, ...dynamicPlayers].map((person) => {
      const distance = Math.hypot(position.x - person.x, position.y - person.y)
      return {
        ...person,
        distance,
      }
    })
  }, [position.x, position.y, remotePlayers])

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

        <div className="sidebar-bottom">
          <span className="status-dot" />{' '}
          {isConnected ? 'Live Multiplayer Active' : connectionError ? `Error: ${connectionError}` : 'Frontend Prototype'}
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
            {isConnected ? '● LIVE MULTIPLAYER' : connectionError ? '● OFFLINE' : '● LOCAL DEMO'}
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
              <strong>{isConnected ? 'LIVE MULTIPLAYER' : 'LOCAL ONLY'}</strong>
            </div>
          </div>
        </section>

        <div className="bottom-grid">
          <section className="info-card">
            <h3>Nearby People</h3>
            <p>Distance updates as you move through the office.</p>

            {nearbyPeople.map((person) => (
              <div className="person-row" key={person.name}>
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
            <h3>Proximity Audio Engine</h3>
            <p>Spatial WebRTC peer audio with 100px earshot attenuation & stereo panning.</p>
            <AudioControls
              isAudioActive={isAudioActive}
              isMicMuted={isMicMuted}
              audioContextState={audioContextState}
              permissionState={permissionState}
              audioError={audioError}
              activePeers={activePeers}
              onStartAudio={startAudio}
              onStopAudio={stopAudio}
              onToggleMute={toggleMute}
              onResumeAudio={resumeAudio}
              isConnected={isConnected}
            />
          </section>
        </div>
      </main>
    </div>
  )
}

export default App