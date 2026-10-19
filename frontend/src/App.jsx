import { useEffect, useMemo, useRef, useState } from 'react'

import './App.css'
import './CampusExperience.css'
import officeFloorplan from './assets/office-floorplan.png'

import { useSocket } from './hooks/useSocket'
import { useProximityAudio } from './audio/useProximityAudio'
import { createRoomCamera, getCameraTarget, updateRoomCamera, applyRoomCamera, screenToWorld, worldToScreen } from './camera/roomCamera'



const WIDTH = 2000

const HEIGHT = 1200

const SPEED = 260

const RADIUS = 100

// Authentic, larger 2000×1200 building with constant-sized player footprint.
// The 100px server proximity radius does NOT change.
const PLAYER_RADIUS = 13

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



// Each original artwork coordinate represents 2 world units in the expanded building.
// The image now occupies x=200..1800, y=0..1200 in a true 2000×1200 world.
// Keep authored image-aligned room definitions in source-space, then map precisely.
const referenceRoomZones = [
  { title: 'FOCUS NORTH', subtitle: 'Private quiet workspace', x: 162, y: 43, w: 72, h: 80 },
  { title: 'MEETING NORTH', subtitle: 'Six-person meeting room', x: 249, y: 44, w: 120, h: 79 },
  { title: 'CAFETERIA', subtitle: 'Food and coffee bar', x: 383, y: 46, w: 211, h: 77 },
  { title: 'LOUNGE NORTH', subtitle: 'Relaxed team lounge', x: 611, y: 43, w: 121, h: 78 },
  { title: 'QUIET ROOM', subtitle: 'Private relaxation space', x: 750, y: 44, w: 75, h: 79 },
  { title: 'PHONE BOOTHS', subtitle: 'Private calls', x: 164, y: 132, w: 69, h: 58 },
  { title: 'COLLAB WEST', subtitle: 'Team collaboration', x: 164, y: 199, w: 69, h: 67 },
  { title: 'FOCUS WEST', subtitle: 'Quiet solo work', x: 164, y: 277, w: 69, h: 63 },
  { title: 'MEETING EAST', subtitle: 'Small-group conference', x: 755, y: 137, w: 70, h: 72 },
  { title: 'COLLAB EAST', subtitle: 'Group discussion area', x: 755, y: 217, w: 70, h: 59 },
  { title: 'FOCUS EAST', subtitle: 'Independent work', x: 755, y: 285, w: 70, h: 55 },
  { title: 'WORKSTATIONS WEST', subtitle: 'Shared workstations', x: 261, y: 194, w: 122, h: 119 },
  { title: 'WORKSTATIONS EAST', subtitle: 'Shared workstations', x: 600, y: 194, w: 111, h: 119 },
  { title: 'MEETING SOUTH', subtitle: 'Large boardroom', x: 163, y: 366, w: 141, h: 131 },
  { title: 'LOUNGE SOUTH', subtitle: 'Breakout lounge', x: 328, y: 366, w: 100, h: 132 },
  { title: 'RECEPTION', subtitle: 'Welcome desk and entry', x: 439, y: 378, w: 132, h: 138 },
  { title: 'KITCHEN & COFFEE', subtitle: 'Casual coffee chats', x: 586, y: 367, w: 108, h: 130 },
  { title: 'TRAINING ROOM', subtitle: 'Team workshops', x: 710, y: 365, w: 113, h: 132 },
]

// Furniture approximations in logical units, mapped against artwork.
// These block walking through large desks and tables; visual pixels themselves
// cannot give us automatic collision, so doorways/walls need field validation.
const referenceObstacles = [
  { x: 285, y: 211, w: 19, h: 66, type: 'desk-bank' },
  { x: 342, y: 211, w: 18, h: 66, type: 'desk-bank' },
  { x: 624, y: 211, w: 19, h: 66, type: 'desk-bank' },
  { x: 682, y: 211, w: 18, h: 66, type: 'desk-bank' },
  { x: 460, y: 202, w: 77, h: 58, type: 'sofa-zone' },
  { x: 280, y: 71, w: 60, h: 32, type: 'conference' },
  { x: 450, y: 81, w: 101, h: 25, type: 'cafe-counter' },
  { x: 658, y: 68, w: 54, h: 45, type: 'sofa' },
  { x: 185, y: 230, w: 27, h: 21, type: 'collab' },
  { x: 786, y: 157, w: 22, h: 26, type: 'meeting' },
  { x: 785, y: 238, w: 20, h: 23, type: 'collab' },
  { x: 187, y: 409, w: 94, h: 52, type: 'meeting' },
  { x: 338, y: 401, w: 73, h: 65, type: 'lounge' },
  { x: 477, y: 416, w: 46, h: 32, type: 'welcome' },
  { x: 735, y: 416, w: 80, h: 49, type: 'training' },
]

// Doubling the world footprint creates real additional navigation distance.
// Unlike CSS zoom, avatars/proximity are NOT enlarged with the furniture.
const upscaleArea = (area) => ({
  ...area,
  x: area.x * 2, y: area.y * 2,
  w: area.w * 2, h: area.h * 2,
})
const roomZones = referenceRoomZones.map(upscaleArea)
const obstacles = referenceObstacles.map(upscaleArea)
const ARTWORK = { x: 200, y: 0, w: 1600, h: 1200 }

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
  // Prevent wandering into the black border outside the building artwork.
  // Old authored walkable boundary × 2. The surrounding landscape is visual only.
  if (x < 332 || x > 1666 || y < 96 || y > 1092) return true
  return obstacles.some((rect) => circleIntersectsRect(x, y, PLAYER_RADIUS, rect))
}



function getRoom(x, y) {
  const zone = roomZones.find((room) =>
    x >= room.x && x <= room.x + room.w &&
    y >= room.y && y <= room.y + room.h
  )
  return zone?.title || 'CORRIDOR'
}

function MiniMap({ position, members, selfColor, showPeers }) {
  return (
    <div className="day7-minimap" role="img" aria-label={`Office mini map. Your position: ${position.x}, ${position.y}. ${showPeers ? members.length : 0} other members visible.`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width={WIDTH} height={HEIGHT} fill="#10151a" />
        <image href={officeFloorplan} x={ARTWORK.x} y={ARTWORK.y} width={ARTWORK.w} height={ARTWORK.h} preserveAspectRatio="xMidYMid meet" />
        {/* Viewport footprint follows your location, not a fixed screenshot. */}
        <rect
          x={clamp(position.x - 510, 0, WIDTH - 1020)}
          y={clamp(position.y - 310, 0, HEIGHT - 620)}
          width="1020" height="620" rx="18"
          fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.95)"
          strokeWidth="5" strokeDasharray="17 12" pointerEvents="none"
        />
        {showPeers && members.map((member) => (
          <circle key={member.id} cx={member.x} cy={member.y} r="7" fill={member.color} stroke="#fff" strokeWidth="3" />
        ))}
        <circle cx={position.x} cy={position.y} r="9" fill={selfColor} stroke="#fff" strokeWidth="4" />
      </svg>
      <div className="day7-map-legend"><span><i style={{ backgroundColor: selfColor }} /> You</span><span><i style={{ backgroundColor: '#f472b6' }} /> Teammates</span></div>
    </div>
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
  const cameraRef = useRef(createRoomCamera())
  const tooltipRef = useRef(null)
  const hoveredPeerIdRef = useRef(null)

  const keysRef = useRef(new Set())

  const playerRef = useRef({ x: 1000, y: 600 })

  const remotePlayersRef = useRef(new Map())

  const lastSyncTimeRef = useRef(0)



  const [profile, setProfile] = useState(readProfile)

  const [draftName, setDraftName] = useState(() => readProfile().name)

  const profileRef = useRef(profile)


  const [position, setPosition] = useState({ x: 1000, y: 600 })
  const [hoveredPeer, setHoveredPeer] = useState(null)
  const [isImmersiveMode, setIsImmersiveMode] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  const [campusGuideOpen, setCampusGuideOpen] = useState(false)
  const [immersiveRoom, setImmersiveRoom] = useState(null)



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

    profileRef.current = profile
    localStorage.setItem('proxispeak-avatar-profile', JSON.stringify(profile))

  }, [profile])

  const [remotePeerRecords, setRemotePeerRecords] = useState([])
  const [selfSocketId, setSelfSocketId] = useState(null)

  const [joinedOffice, setJoinedOffice] = useState(false)

  const [nearbyPeerIds, setNearbyPeerIds] = useState(() => new Set())
  const [activity, setActivity] = useState([])
  const [hasJoinedBefore, setHasJoinedBefore] = useState(false)





  // Keep live multiplayer presence separate from the static demo colleagues.

  useEffect(() => {

    const socket = socketRef.current

  // Only observable server events are logged: no simulated users or fake activity.
  function addActivity(kind, message) {
    setActivity((old) => [{
      id: `${Date.now()}-${Math.random()}`,
      kind,
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }, ...old].slice(0, 8))
  }

    if (!isConnected || !socket) {

      remotePlayersRef.current.clear()

      setRemotePeerRecords(Array.from(remotePlayersRef.current.values()))

      setNearbyPeerIds(new Set())

      setJoinedOffice(false)
      setSelfSocketId(null)

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

      setRemotePeerRecords(Array.from(remotePlayersRef.current.values()))
      // Snapshot contains authoritative server earshot results, even before a fresh move.
      setNearbyPeerIds(new Set((payload.peers || [])
        .filter((peer) => isOtherPlayer(peer) && peer.isWithinEarshot === true)
        .map((peer) => peer.socketId)))
      setJoinedOffice(true)
      setSelfSocketId(socket.id)
      setHasJoinedBefore(true)
      addActivity('connection', 'Connected to the virtual office')

      console.log('Joined office:', payload.officeId, 'peers:', payload.peers?.length ?? 0)

    }



    const handleUserJoined = (peer) => {

      if (!isOtherPlayer(peer)) return

      remotePlayersRef.current.set(peer.socketId, peer)

      setRemotePeerRecords(Array.from(remotePlayersRef.current.values()))
      addActivity('join', `${peer.displayName || 'A member'} joined the office`)

    }



    const handleAvatarMoved = (peer) => {

      if (!isOtherPlayer(peer)) return

      const previous = remotePlayersRef.current.get(peer.socketId)

      if (!previous) return // Initial presence comes from office:joined / user:joined.

      remotePlayersRef.current.set(peer.socketId, { ...previous, ...peer })

      setRemotePeerRecords(Array.from(remotePlayersRef.current.values()))

    }



    const handleUserLeft = ({ socketId } = {}) => {

      if (!socketId) return

      const departing = remotePlayersRef.current.get(socketId)
      if (!departing) return
      remotePlayersRef.current.delete(socketId)
      addActivity('leave', `${departing.displayName || 'A member'} left the office`)

      setNearbyPeerIds((previous) => {

        const next = new Set(previous)

        next.delete(socketId)

        return next

      })

      setRemotePeerRecords(Array.from(remotePlayersRef.current.values()))

    }



    const handleProximityEnter = ({ peerSocketId } = {}) => {

      if (!peerSocketId) return

      setNearbyPeerIds((previous) => new Set(previous).add(peerSocketId))
      const person = remotePlayersRef.current.get(peerSocketId)
      if (person) addActivity('near', `${person.displayName || 'A member'} entered your 100px range`)

    }



    const handleProximityLeave = ({ peerSocketId } = {}) => {

      if (!peerSocketId) return

      setNearbyPeerIds((previous) => {

        const next = new Set(previous)

        next.delete(peerSocketId)

        return next

      })
      const person = remotePlayersRef.current.get(peerSocketId)
      if (person) addActivity('far', `${person.displayName || 'A member'} moved out of range`)

    }

    const handleDisconnected = () => {
      addActivity('connection', 'Connection lost — waiting for server')
    }

    socket.on('disconnect', handleDisconnected)

    socket.on('office:joined', handleOfficeJoined)

    socket.on('user:joined', handleUserJoined)

    socket.on('avatar:moved', handleAvatarMoved)

    socket.on('user:left', handleUserLeft)

    socket.on('proximity:enter', handleProximityEnter)

    socket.on('proximity:leave', handleProximityLeave)



    return () => {

      socket.off('disconnect', handleDisconnected)
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

      joinOffice(OFFICE_ID, x, y, profile.name, profile.color)

    }

  }, [isConnected, joinOffice, profile.name, profile.color])



  useEffect(() => {

    const canvas = canvasRef.current

    const ctx = canvas.getContext('2d')

    let frame

    let lastTime = 0

    let lastDisplay = 0

    const officeImage = new window.Image()
    officeImage.decoding = 'async'
    officeImage.src = officeFloorplan


    // CSS decides the viewport size. The Canvas backing store follows it at
    // device pixel ratio; no nonuniform scaling/stretch on fullscreen entry.
    const viewport = { width: WIDTH, height: HEIGHT, dpr: 1 }
    const measureCanvas = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      if (width < 2 || height < 2) return
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const pixelWidth = Math.round(width * dpr)
      const pixelHeight = Math.round(height * dpr)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      viewport.width = width
      viewport.height = height
      viewport.dpr = dpr
    }
    const viewportObserver = new ResizeObserver(measureCanvas)
    viewportObserver.observe(canvas.parentElement)
    window.addEventListener('resize', measureCanvas)
    measureCanvas()



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

    const handleCanvasMouseMove = (event) => {
      const bounds = canvas.getBoundingClientRect()
      const sx = event.clientX - bounds.left
      const sy = event.clientY - bounds.top
      const { x, y } = screenToWorld(sx, sy, cameraRef.current, viewport)
      let nearest = null
      let nearestDistance = 32
      for (const peer of remotePlayersRef.current.values()) {
        if (!Number.isFinite(peer.x) || !Number.isFinite(peer.y)) continue
        const distance = Math.hypot(peer.x - x, peer.y - y)
        if (distance < nearestDistance) {
          nearest = peer.socketId
          nearestDistance = distance
        }
      }
      hoveredPeerIdRef.current = nearest
      setHoveredPeer((previous) => previous === nearest ? previous : nearest)
    }
    const handleCanvasMouseLeave = () => {
      hoveredPeerIdRef.current = null
      setHoveredPeer(null)
    }



    window.addEventListener('keydown', keydown)

    window.addEventListener('keyup', keyup)

    window.addEventListener('blur', clearKeys)
    canvas.addEventListener('mousemove', handleCanvasMouseMove)
    canvas.addEventListener('mouseleave', handleCanvasMouseLeave)



    // Campus V4: the selected office PNG is the actual map artwork.
    // Real-time avatars remain Canvas overlays, not part of a static mock-up.
    // Compact human markers leave walkable rooms visually open.
    // Names are shown for you and nearby / hovered peers; distant labels
    // are available in the online list, hover tooltip and proximity panel.
    function drawAvatar(x, y, name, color, showLabel = true) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.32)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 2
      ctx.beginPath()
      ctx.ellipse(x + 1, y + 8, 11, 4, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(16,24,25,0.26)'
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      ctx.beginPath()
      ctx.arc(x, y, 11.5, 0, Math.PI * 2)
      ctx.fillStyle = '#fbfbf7'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, 9, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y - 1.7, 4.4, 0, Math.PI * 2)
      ctx.fillStyle = '#f1d1b4'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y - 3, 4.1, Math.PI * 1.07, Math.PI * 1.92)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#302c2a'
      ctx.stroke()
      if (showLabel) {
        ctx.font = '600 9px system-ui, sans-serif'
        const tw = Math.min(138, ctx.measureText(name).width + 14)
        ctx.beginPath()
        ctx.roundRect(x - tw / 2, y - 30, tw, 14, 4)
        ctx.fillStyle = 'rgba(10,21,22,0.88)'
        ctx.fill()
        ctx.textAlign = 'center'
        ctx.fillStyle = '#fff'
        ctx.fillText(name, x, y - 20)
      }
      ctx.restore()
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



      // Camera changes only how the world is drawn, not positions or collisions.
      // Reset transform each frame so zoom does not accumulate.
      // Paint the full SCREEN (not the world) before entering the world transform.
      ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)
      const backdrop = ctx.createLinearGradient(0, 0, viewport.width, viewport.height)
      backdrop.addColorStop(0, '#e7e4d9')
      backdrop.addColorStop(0.65, '#d3d4c8')
      backdrop.addColorStop(1, '#a9b6a7')
      ctx.fillStyle = backdrop
      ctx.fillRect(0, 0, viewport.width, viewport.height)
      // Very subtle screen-space draft grid: makes letterbox areas intentional.
      ctx.strokeStyle = 'rgba(83,108,90,0.07)'
      ctx.lineWidth = 1
      for (let gx = 0; gx < viewport.width; gx += 42) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, viewport.height); ctx.stroke()
      }
      updateRoomCamera(cameraRef.current, getCameraTarget(p.x, p.y, viewport), dt)
      // Position the HTML tooltip outside React render using the live camera.
      // This follows zoom animation smoothly and avoids reading refs in JSX.
      const hoveredId = hoveredPeerIdRef.current
      const hovered = hoveredId ? remotePlayersRef.current.get(hoveredId) : null
      if (tooltipRef.current && hovered && Number.isFinite(hovered.x) && Number.isFinite(hovered.y)) {
        const screen = worldToScreen(hovered.x, hovered.y, cameraRef.current, viewport)
        tooltipRef.current.style.left = `${(screen.x / viewport.width) * 100}%`
        tooltipRef.current.style.top = `${(screen.y / viewport.height) * 100}%`
      }
      ctx.save()
      applyRoomCamera(ctx, cameraRef.current, viewport)

      // During an immersive room view, keep the camera on THAT room only.
      // Clipping the world prevents neighboring rooms/corridor from appearing
      // in the fullscreen frame; backing landscape remains beautifully neutral.
      const focusedRoom = roomZones.find((room) => room.title === getRoom(p.x, p.y))
      const roomOnly = Boolean(focusedRoom && cameraRef.current.zoom > 1.18)
      // No hard clipping: the high-resolution image remains visible across
      // smooth transitions. Room focus is controlled by the camera only.

      // Premium visual surround beyond the office image: landscaping, not fake rooms.
      // Only visible near the edges of the map when walking toward the building perimeter.
      const surround = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
      surround.addColorStop(0, '#1a2824')
      surround.addColorStop(0.5, '#324a39')
      surround.addColorStop(1, '#182722')
      ctx.fillStyle = surround
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      for (let sy = 34; sy < HEIGHT; sy += 74) {
        for (const sx of [85, 1915]) {
          ctx.beginPath()
          ctx.arc(sx + Math.sin(sy * 0.04) * 17, sy, 28, 0, Math.PI * 2)
          ctx.fillStyle = '#4a6347'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(sx - 6 + Math.sin(sy * 0.04) * 17, sy - 7, 19, 0, Math.PI * 2)
          ctx.fillStyle = '#76916d'
          ctx.fill()
        }
      }

      // The same selected architectural artwork, drawn at its original 4:3 ratio.
      // Room / furniture footprints now occupy DOUBLE the world coordinates.
      if (officeImage.complete && officeImage.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(officeImage, ARTWORK.x, ARTWORK.y, ARTWORK.w, ARTWORK.h)
      } else {
        ctx.fillStyle = '#1d2829'
        ctx.fillRect(ARTWORK.x, ARTWORK.y, ARTWORK.w, ARTWORK.h)
        ctx.fillStyle = '#ecf0e7'
        ctx.font = '600 18px Arial'
        ctx.textAlign = 'center'
        ctx.fillText('Loading expanded office interior…', 1000, 600)
      }

      // Preserve original authoritative 100px earshot radius.
      ctx.save()
      ctx.beginPath()
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(74,117,120,0.018)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(50,105,108,0.15)'
      ctx.lineWidth = 1.2
      ctx.setLineDash([4, 7])
      ctx.stroke()
      ctx.restore()

      // Multiplayer remote players (same authoritative positions).

      remotePlayersRef.current.forEach((player) => {

        if (typeof player.x !== 'number' || typeof player.y !== 'number') return
        if (roomOnly && getRoom(player.x, player.y) !== focusedRoom.title) return



        drawAvatar(

          player.x,

          player.y,

          player.displayName && player.displayName !== 'Guest'

            ? player.displayName

            : `Player ${String(player.socketId).slice(0, 4)}`,

          AVATAR_COLORS.includes(player.avatarColor) ? player.avatarColor : '#f472b6',
          Math.hypot(player.x - p.x, player.y - p.y) <= 75 ||
            hoveredPeerIdRef.current === player.socketId

        )

      })



      // You

      drawAvatar(p.x, p.y, `${profileRef.current.name} (YOU)`, profileRef.current.color)



      // Restore unscaled canvas for the next frame.
      ctx.restore()

      if (time - lastDisplay > 80) {

        setPosition((previous) => {

          const x = Math.round(p.x)

          const y = Math.round(p.y)

          return previous.x === x && previous.y === y ? previous : { x, y }

        })
        const detectedRoom = getRoom(p.x, p.y)
        const shouldImmerse = detectedRoom !== 'CORRIDOR'
        setIsImmersiveMode((previous) => previous === shouldImmerse ? previous : shouldImmerse)
        setImmersiveRoom((previous) => {
          const nextRoom = shouldImmerse ? detectedRoom : null
          return previous === nextRoom ? previous : nextRoom
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
      canvas.removeEventListener('mousemove', handleCanvasMouseMove)
      canvas.removeEventListener('mouseleave', handleCanvasMouseLeave)
      viewportObserver.disconnect()
      window.removeEventListener('resize', measureCanvas)

    }

  }, [moveAvatar, socketRef])



  const onlineMembers = useMemo(() => {
    if (!joinedOffice) return []
    return remotePeerRecords
      .filter((peer) => Number.isFinite(peer.x) && Number.isFinite(peer.y))
      .map((peer) => ({
        id: peer.socketId,
        name: peer.displayName || `Player ${peer.socketId.slice(0, 4)}`,
        userId: peer.userId,
        color: AVATAR_COLORS.includes(peer.avatarColor) ? peer.avatarColor : '#f472b6',
        x: peer.x,
        y: peer.y,
      }))
  }, [remotePeerRecords, joinedOffice])

  const currentRoom = useMemo(() => getRoom(position.x, position.y), [position.x, position.y])
  const roomCounts = useMemo(() => {
    const all = Object.fromEntries([...roomZones.map((room) => room.title), 'CORRIDOR'].map((name) => [name, 0]))
    if (!joinedOffice) return all
    all[currentRoom] += 1
    for (const peer of onlineMembers) all[getRoom(peer.x, peer.y)] += 1
    return all
  }, [joinedOffice, currentRoom, onlineMembers])
  const activeHoveredPeer = hoveredPeer && joinedOffice
    ? onlineMembers.find((peer) => peer.id === hoveredPeer)
    : null

  const nearbyPeople = useMemo(() => onlineMembers.map((peer) => ({
    ...peer,
    distance: Math.hypot(position.x - peer.x, position.y - peer.y),
    serverInEarshot: nearbyPeerIds.has(peer.id),
  })), [onlineMembers, position.x, position.y, nearbyPeerIds])

  // The server is authoritative for earshot. Local distances are displayed for context.
  const liveNearbyPeers = useMemo(() => nearbyPeople
    .filter((peer) => peer.serverInEarshot)
    .map((peer) => ({
      socketId: peer.id,
      distance: peer.distance,
      dx: peer.x - position.x,
      dy: peer.y - position.y,
    })), [nearbyPeople, position.x, position.y])

  const connectionLabel = joinedOffice
    ? 'Live multiplayer'
    : isConnected
      ? 'Joining office…'
      : hasJoinedBefore
        ? 'Reconnecting…'
        : 'Offline'

  const isFocusView = isImmersiveMode || presentationMode

  const audioPeers = useMemo(() => onlineMembers.map((peer) => ({
    id: peer.id, name: peer.name, x: peer.x, y: peer.y,
  })), [onlineMembers])

  // Reuse Sathya's audio hook; do not reimplement the WebRTC or audio engines.
  // Starting live voice remains gated because the audio transport and backend
  // currently disagree on voice:join and WebRTC payload shapes.
  const audio = useProximityAudio({
    userId: selfSocketId || 'disconnected',
    officeId: OFFICE_ID,
    localPosition: position,
    peers: audioPeers,
    earshotRadius: RADIUS,
    signalingUrl: 'http://localhost:3000',
    preferredTransport: 'socketio',
  })

  return (

    <div
      className={`app-shell${isFocusView ? ' immersive-mode' : ''} campus-v2`}
      data-active-room={immersiveRoom || 'CORRIDOR'}
    >

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

          <p className="profile-note">Avatar colors are sent on join, but require backend relay support for cross-client sync.</p>

        </div>



        <div className="sidebar-bottom">

          <span className="status-dot" />{' '}

            {connectionLabel}

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

            {connectionLabel}

          </div>

        </header>
        {!joinedOffice && (
          <div className="day6-recovery" role="status">
            <span className="day6-recovery-pulse" aria-hidden="true" />
            <div>
              <strong>{isConnected ? 'Rejoining office' : hasJoinedBefore ? 'Connection interrupted' : 'Connecting to office'}</strong>
              <p>{isConnected ? 'Waiting for the server to confirm your office session.' : 'We will keep trying to reconnect automatically. Your avatar stays here.'}</p>
            </div>
          </div>
        )}

        <section className="office-card">

          <div className="office-toolbar">

            <div>

              <h2>Office Floor 01</h2>

              <p>Expanded 2000 × 1200 architectural campus · Live workspace</p>

            </div>

            <span className="controls-hint">W A S D / ARROW KEYS</span>

          </div>



          <div className="canvas-wrapper day7-canvas-wrap">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Virtual office map, use arrow keys or WASD to move" />
            <div className="campus-hud">
              <div className="campus-hud-top">
                <div className="campus-brand-chip">
                  <span className="campus-chip-dot" />
                  <span className="campus-brand-name">PROXISPEAK</span>
                  <span className="campus-brand-slash">/</span>
                  <span className="campus-brand-space">{currentRoom === 'CORRIDOR' ? 'OFFICE HQ' : currentRoom}</span>
                </div>
                <div className="campus-live-badge" aria-label={connectionLabel}>
                  <span className={joinedOffice ? 'campus-online-light' : 'campus-offline-light'} />
                  {joinedOffice ? `${onlineMembers.length + 1} online` : connectionLabel}
                </div>
              </div>
              <div className="campus-member-rail" aria-label="People in this office">
                {[{ id: 'local', name: profile.name, color: profile.color, self: true }, ...onlineMembers]
                  .slice(0, 2)
                  .map((member) => (
                    <div className={`campus-member-card${member.self ? ' is-self' : ''}`} key={member.id}>
                      <div className="campus-person-portrait" style={{ '--person-accent': member.color }} aria-hidden="true">
                        <span className="campus-portrait-head" />
                        <span className="campus-portrait-hair" />
                        <span className="campus-portrait-body" />
                      </div>
                      <span className="campus-member-name" title={member.name}>{member.self ? 'YOU' : member.name}</span>
                      <span className="campus-person-status" title={member.self ? 'Your avatar' : 'Connected teammate'} />
                    </div>
                  ))}
                {onlineMembers.length > 1 && <div className="campus-member-more">+{onlineMembers.length - 1}</div>}
              </div>
              {isImmersiveMode && (
                <aside className="campus-room-inspector" aria-label="Current room information">
                  <span className="campus-inspector-kicker">NOW EXPLORING</span>
                  <h3>{immersiveRoom}</h3>
                  <p>{roomZones.find((room) => room.title === immersiveRoom)?.subtitle}</p>
                  <div className="campus-inspector-divider" />
                  <div className="campus-inspector-stat">
                    <span>Room occupancy</span>
                    <strong>{joinedOffice ? roomCounts[immersiveRoom] ?? 0 : '—'}</strong>
                  </div>
                  <div className="campus-inspector-stat">
                    <span>Nearby teammates</span>
                    <strong>{liveNearbyPeers.length}</strong>
                  </div>
                  <div className="campus-inspector-foot">100 PX PROXIMITY · LIVE WORLD</div>
                </aside>
              )}
              <div className="campus-hud-bottom">
                <div className="campus-controls">
                  <button
                    type="button"
                    className="campus-hud-button"
                    onClick={() => setCampusGuideOpen((old) => !old)}
                    aria-expanded={campusGuideOpen}
                    aria-label={campusGuideOpen ? 'Close controls guide' : 'Open controls guide'}
                  >
                    ? <span>Help</span>
                  </button>
                  {!isImmersiveMode ? (
                    <button
                      type="button"
                      className="campus-hud-button campus-focus-toggle"
                      onClick={() => setPresentationMode((old) => !old)}
                      aria-pressed={presentationMode}
                    >
                      {presentationMode ? '↙' : '⤢'} <span>{presentationMode ? 'Dashboard' : 'Focus view'}</span>
                    </button>
                  ) : (
                    <span className="campus-room-notice">Walk out of this zone to return to dashboard</span>
                  )}
                  <span className="campus-controls-divider" />
                  <span className="campus-walk-hint">W A S D <span>to walk</span></span>
                </div>
                {campusGuideOpen && (
                  <div className="campus-guide" role="status">
                    <strong>Explore ProxiSpeak</strong>
                    <span>Use WASD or arrow keys to explore the expanded campus.</span>
                    <span>The camera follows you. Enter a room to open its immersive view.</span>
                    <span>2000×1200 world · 100px proximity (server-authoritative).</span>
                    <span>Use the minimap outline to understand your viewing area.</span>
                    <span>Voice calling remains disabled until signaling integration is complete.</span>
                  </div>
                )}
              </div>
              {isFocusView && (
                <div className="campus-floating-map">
                  <div className="campus-floating-map-header"><span>OFFICE MAP</span><span>LIVE</span></div>
                  <MiniMap position={position} members={onlineMembers} selfColor={profile.color} showPeers={joinedOffice} />
                </div>
              )}
            </div>
            {activeHoveredPeer && (
              <div ref={tooltipRef} className="day7-peer-tooltip" style={{ left: '50%', top: '50%' }} role="status">
                <strong>{activeHoveredPeer.name}</strong>
                <span>{getRoom(activeHoveredPeer.x, activeHoveredPeer.y)}</span>
                <small>{Math.round(Math.hypot(position.x - activeHoveredPeer.x, position.y - activeHoveredPeer.y))} px away · Online</small>
              </div>
            )}
          </div>



          <div className="office-footer">

            <div>

              <small>YOUR POSITION</small>

              <strong>

                X: {position.x}   Y: {position.y}

              </strong>

            </div>



            <div>

              <small>PROXIMITY RANGE</small>

              <strong>100 PX</strong>

            </div>



            <div>

              <small>CONNECTION</small>

              <strong>{connectionLabel}</strong>

            </div>

          </div>

        </section>



        <div className="day7-overview-grid">
          <section className="info-card day7-overview-card">
            <div className="day7-card-heading"><div><h3>Live Mini Map</h3><p>Office positions, updated as teammates move.</p></div><span className="day7-chip">LIVE</span></div>
            <MiniMap position={position} members={onlineMembers} selfColor={profile.color} showPeers={joinedOffice} />
            <p className="day7-footnote">Hover over a teammate on the main map to see their details.</p>
          </section>
          <section className="info-card day7-overview-card">
            <div className="day7-card-heading"><div><h3>Room Occupancy</h3><p>Live distribution across the office.</p></div><span className="day7-chip">{joinedOffice ? onlineMembers.length + 1 : 0} ONLINE</span></div>
            <div className="day7-current-room"><small>YOUR CURRENT AREA</small><strong>{currentRoom}</strong></div>
            <div className="day7-room-list">
              {[...roomZones.map((room) => room.title), 'CORRIDOR'].map((name) => (
                <div className="day7-room-row" key={name}>
                  <span>{name}</span><strong>{roomCounts[name]} <small>{roomCounts[name] === 1 ? 'person' : 'people'}</small></strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="bottom-grid">

          <section className="info-card">

            <h3>Nearby People</h3>

            <p>Distance updates as you move through the office.</p>



            {!joinedOffice && <p>Connect to the backend to view live proximity.</p>}
            {joinedOffice && nearbyPeople.length === 0 && <p>No other members in this office.</p>}
            {nearbyPeople.map((person) => (
              <div className="person-row" key={person.id}>
                <span className="person-dot" style={{ background: person.color }} />
                <span>{person.name}</span>
                <span className="person-distance">{Math.round(person.distance)} px</span>
                <span className={person.serverInEarshot ? 'nearby' : 'faraway'}>
                  {person.serverInEarshot ? 'Nearby (server)' : 'Out of range'}
                </span>
              </div>
            ))}
          </section>



          <section className="info-card">
            <h3>Online Members ({joinedOffice ? onlineMembers.length + 1 : 0})</h3>
            <p>Live office presence from the backend — demo users removed.</p>
            {joinedOffice && <div className="person-row"><span className="person-dot" style={{ background: profile.color }} /><span>{profile.name} (You)</span><span className="nearby">Online</span></div>}
            {joinedOffice && onlineMembers.length === 0 && <p>No other members online.</p>}
            {onlineMembers.map((person) => (
              <div className="person-row" key={person.id}>
                <span className="person-dot" style={{ background: person.color }} />
                <span className="day6-member-name">{person.name}<small>{Math.round(Math.hypot(position.x - person.x, position.y - person.y))}px away</small></span>
                <span className={nearbyPeerIds.has(person.id) ? 'nearby' : 'faraway'}>
                  {nearbyPeerIds.has(person.id) ? 'In range' : 'Online'}
                </span>
              </div>
            ))}
          </section>

          <section className="info-card day6-activity">
            <div className="day6-feed-heading">
              <h3>Live Activity</h3>
              <span className="day6-live-indicator">SERVER EVENTS</span>
            </div>
            <p>Latest joins, departures and proximity changes.</p>
            {activity.length === 0 && <p className="day6-empty">Activity will appear when members connect or move nearby.</p>}
            <div className="day6-feed" aria-live="polite" aria-relevant="additions">
              {activity.map((event) => (
                <div className={`day6-event day6-event-${event.kind}`} key={event.id}>
                  <span className="day6-event-mark" aria-hidden="true">●</span>
                  <span className="day6-event-message">{event.message}</span>
                  <time>{event.time}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="info-card">

            <h3>Audio Engine</h3>

            <p>Prepared for Week 3 spatial audio integration.</p>

            <div className="audio-placeholder">◉ &nbsp; Sathya audio hook loaded — {audio.audioState}</div>
            <button className="audio-start-pending" disabled title="Backend signaling payload contract needs alignment">Start Voice — awaiting signaling alignment</button>

            <div className="audio-note">

              {connectionError

                ? `Connection issue: ${connectionError}`

                : `Server-confirmed nearby peers: ${liveNearbyPeers.length}. Audio signaling is not yet compatible with Pranav's backend.`}

            </div>

          </section>

        </div>

      </main>

    </div>

  )

}



export default App


