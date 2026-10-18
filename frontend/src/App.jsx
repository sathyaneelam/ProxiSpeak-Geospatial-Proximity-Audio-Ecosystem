import { useEffect, useMemo, useRef, useState } from 'react'

import './App.css'
import './CampusExperience.css'

import { useSocket } from './hooks/useSocket'
import { useProximityAudio } from './audio/useProximityAudio'
import { createRoomCamera, getCameraTarget, updateRoomCamera, applyRoomCamera, screenToWorld, worldToScreen } from './camera/roomCamera'



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

    fill: '#c8b99f',

    stroke: '#8a7965',

  },

  {

    x: 690,

    y: 45,

    w: 265,

    h: 205,

    title: 'WORKSTATION B',

    subtitle: 'Team workspace',

    fill: '#c8b99f',

    stroke: '#8a7965',

  },

  {

    x: 45,

    y: 350,

    w: 300,

    h: 205,

    title: 'MEETING AREA',

    subtitle: 'Collaborative discussion zone',

    fill: '#a7b1a9',

    stroke: '#697d72',

  },

  {

    x: 650,

    y: 350,

    w: 305,

    h: 205,

    title: 'LOUNGE',

    subtitle: 'Relax + informal talks',

    fill: '#afbaac',

    stroke: '#738678',

  },

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
        <rect width={WIDTH} height={HEIGHT} rx="22" fill="#e6dfd2" />
        <rect x="345" y="55" width="310" height="490" rx="8" fill="#d1d0c5" stroke="#a6a79a" strokeWidth="3" />
        {roomZones.map((zone) => (
          <g key={zone.title}>
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="6" fill={zone.fill} stroke={zone.stroke} strokeWidth="4" />
            <text x={zone.x + zone.w / 2} y={zone.y + zone.h / 2} fill="#3f4943" fontSize="18" fontWeight="600" textAnchor="middle">{zone.title.replace('WORKSTATION', 'DESK')}</text>
          </g>
        ))}
        {showPeers && members.map((member) => (
          <circle key={member.id} cx={member.x} cy={member.y} r="16" fill={member.color} stroke="#ffffff" strokeWidth="4" />
        ))}
        <circle cx={position.x} cy={position.y} r="20" fill={selfColor} stroke="#ffffff" strokeWidth="5" />
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

  const playerRef = useRef({ x: 500, y: 300 })

  const remotePlayersRef = useRef(new Map())

  const lastSyncTimeRef = useRef(0)



  const [profile, setProfile] = useState(readProfile)

  const [draftName, setDraftName] = useState(() => readProfile().name)

  const profileRef = useRef(profile)


  const [position, setPosition] = useState({ x: 500, y: 300 })
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



    // Day 9: Architectural top-down renderer. Visual-only: all collision geometry,
    // room boundaries, real-time positions and camera transforms remain untouched.
    function rounded(x, y, w, h, radius, fill, stroke, lineWidth = 1) {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2))
      if (fill) { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke() }
    }

    function ellipse(x, y, rx, ry, fill, stroke, width = 1) {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      if (fill) { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke() }
    }

    function woodGrain(x, y, w, h, color = 'rgba(102,72,45,0.13)', spacing = 13) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.lineWidth = 0.7
      ctx.strokeStyle = color
      for (let i = 0, fy = y + spacing; fy < y + h; i++, fy += spacing) {
        ctx.beginPath()
        ctx.moveTo(x, fy)
        ctx.lineTo(x + w, fy)
        ctx.stroke()
        for (let fx = x + ((i * 29 + 18) % 81); fx < x + w; fx += 81) {
          ctx.beginPath()
          ctx.moveTo(fx, fy)
          ctx.lineTo(fx, Math.min(y + h, fy + spacing))
          ctx.stroke()
        }
      }
      // Fine, deterministic grain; no random noise or texture downloads.
      ctx.strokeStyle = 'rgba(255,255,255,0.09)'
      for (let i = 0; i < 9; i++) {
        const gy = y + (i * 19 + 7) % Math.max(h, 1)
        ctx.beginPath()
        ctx.moveTo(x + 8, gy)
        ctx.lineTo(x + Math.max(8, w - 8), gy + 1.5)
        ctx.stroke()
      }
      ctx.restore()
    }


    function drawCampusLandscape() {
      // Original botanical border: all plants are decor on the impassable perimeter.
      ctx.save()
      const garden = ctx.createLinearGradient(0, 0, 0, HEIGHT)
      garden.addColorStop(0, '#455e45')
      garden.addColorStop(0.5, '#6b8160')
      garden.addColorStop(1, '#3f624b')
      rounded(3, 3, WIDTH - 6, HEIGHT - 6, 13, garden)

      function shrub(x, y, size, seed) {
        ctx.save()
        ctx.translate(x, y)
        ctx.shadowColor = 'rgba(20,37,23,0.24)'
        ctx.shadowBlur = 5
        ctx.shadowOffsetY = 2
        ellipse(1.5, 3.5, size * 0.94, size * 0.45, '#405341')
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0
        ellipse(0, 0, size * 0.85, size * 0.84, '#33563c')
        for (let leaf = 0; leaf < 6; leaf++) {
          const a = leaf * 2.4 + seed
          ellipse(
            Math.cos(a) * size * 0.38,
            Math.sin(a) * size * 0.35,
            size * (leaf % 2 ? 0.46 : 0.38),
            size * 0.34,
            ['#77956a', '#5b8258', '#8fa579', '#476f4c'][leaf % 4]
          )
        }
        ellipse(-size * 0.28, -size * 0.32, size * 0.16, size * 0.12, 'rgba(234,243,198,0.23)')
        ctx.restore()
      }

      // Two landscaped strips, with restrained trees rather than game-like tiles.
      for (let i = 0; i < 39; i++) {
        const x = 13 + i * 25.5
        const size = 9 + (i * 7 % 5)
        shrub(x, 18, size, i)
        shrub(x + 6, 583, size, i + 5)
      }
      for (let j = 2; j < 21; j++) {
        const y = 25 + j * 26.2
        shrub(17, y, 9 + (j % 4), j)
        shrub(981, y + 3, 9 + ((j + 2) % 4), j + 2)
      }
      ctx.restore()
    }

    function drawRoomDetails() {
      // Sightlines, wall art, rugs and task lamps. These are small visual decals,
      // not additional obstacles, so multiplayer collisions stay unchanged.
      roomZones.forEach((room, i) => {
        const { x, y, w, h } = room
        ctx.save()
        const artX = x + (i % 2 ? w - 36 : 16)
        rounded(artX, y + 62, 22, 14, 1, '#817e72', '#f1ede4', 1.5)
        rounded(artX + 2, y + 64, 18, 10, 1, i > 1 ? '#93a9a0' : '#9fac9d')
        ctx.fillStyle = '#d6cec0'
        ctx.beginPath()
        ctx.moveTo(artX + 2, y + 74)
        ctx.lineTo(artX + 10, y + 67)
        ctx.lineTo(artX + 15, y + 72)
        ctx.lineTo(artX + 20, y + 66)
        ctx.lineTo(artX + 20, y + 74)
        ctx.fill()
        // Low-profile planter: do not make a visual barrier to movement.
        const px = i % 2 ? x + 24 : x + w - 22
        const py = y + h - 21
        ellipse(px, py, 7, 7, '#bba68b', '#ece3d3', 1)
        ellipse(px, py, 4, 5, '#628268')
        ellipse(px - 3, py - 2, 3.5, 2.5, '#819d71')
        ellipse(px + 2, py - 3, 3.5, 2.6, '#507653')
        // Small task lights on free wall surfaces.
        rounded(x + w / 2 - 13, y + 13, 26, 3, 1.5, '#f5e5c1')
        ctx.fillStyle = 'rgba(251,239,208,0.1)'
        ctx.fillRect(x + w / 2 - 27, y + 17, 54, 16)
        ctx.restore()
      })
      // Reception signage in main hall.
      ctx.save()
      rounded(461, 294, 80, 18, 4, 'rgba(49,65,60,0.78)', '#dddbc7', 0.9)
      ctx.font = '700 8px Arial'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#f5f0e5'
      ctx.fillText('ATRIUM  •  01', 501, 306)
      ctx.restore()
    }

    function drawArchitecturalBase() {
      // Warm exhibition-board background instead of a neon gaming grid.
      const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
      background.addColorStop(0, '#dedbd3')
      background.addColorStop(0.55, '#c9c6bd')
      background.addColorStop(1, '#b4b6af')
      ctx.fillStyle = background
      // The garden ring remains visible around the inset architectural structure.
      ctx.fillRect(26, 31, WIDTH - 52, HEIGHT - 62)

      ctx.save()
      ctx.shadowColor = 'rgba(51,47,40,0.25)'
      ctx.shadowBlur = 23
      ctx.shadowOffsetY = 8
      rounded(30, 36, 940, 528, 9, '#ece6da', '#f8f5ec', 4)
      ctx.restore()

      // Fine stone speckles throughout the common area.
      ctx.save()
      ctx.beginPath()
      ctx.rect(32, 37, 936, 524)
      ctx.clip()
      for (let i = 0; i < 290; i++) {
        const px = 28 + (i * 67.97 % 940)
        const py = 26 + (i * 119.31 % 548)
        ctx.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.20)' : 'rgba(73,69,60,0.075)'
        ctx.fillRect(px, py, i % 5 === 0 ? 2 : 1, 1)
      }
      ctx.restore()

      // Architectural central atrium/corridor with stone-tile inlays.
      const stone = ctx.createLinearGradient(338, 38, 665, 570)
      stone.addColorStop(0, '#d7d5cb')
      stone.addColorStop(0.5, '#f0ede4')
      stone.addColorStop(1, '#c7c4bb')
      rounded(329, 28, 342, 544, 9, '#a5a397', '#a09f95', 1.5)
      rounded(335, 34, 330, 532, 6, stone, '#fefcf4', 1.5)
      ctx.save()
      ctx.strokeStyle = 'rgba(99,106,101,0.16)'
      ctx.lineWidth = 0.7
      for (let cy = 41; cy < 560; cy += 39) {
        ctx.beginPath()
        ctx.moveTo(340, cy)
        ctx.lineTo(660, cy)
        ctx.stroke()
      }
      for (let cx = 343; cx < 660; cx += 44) {
        ctx.beginPath()
        ctx.moveTo(cx, 40)
        ctx.lineTo(cx, 559)
        ctx.stroke()
      }
      ctx.restore()

      // Brass inlaid navigation strips rather than bright neon beams.
      ctx.fillStyle = '#a89a7c'
      ctx.fillRect(363, 56, 2, 488)
      ctx.fillRect(635, 56, 2, 488)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillRect(367, 56, 1, 488)
      ctx.fillRect(631, 56, 1, 488)

      // Atrium skylight pools drawn as subtle static radial lighting.
      for (const py of [156, 435]) {
        const light = ctx.createRadialGradient(501, py, 8, 501, py, 115)
        light.addColorStop(0, 'rgba(255,253,236,0.50)')
        light.addColorStop(1, 'rgba(255,253,236,0)')
        ctx.fillStyle = light
        ctx.fillRect(381, py - 116, 240, 232)
      }

      // Reception/corridor signage.
      ctx.fillStyle = '#6a706a'
      ctx.font = '600 10px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('PROXISPEAK  /  OFFICE 01', 500, 45)
      ctx.font = '500 9px Arial'
      ctx.fillStyle = '#8b8e84'
      ctx.fillText('CENTRAL ATRIUM', 500, 305)
      ctx.textAlign = 'left'
    }

    function drawPlant(x, y) {
      ctx.save()
      ctx.shadowColor = 'rgba(41,43,31,0.30)'
      ctx.shadowBlur = 7
      ctx.shadowOffsetY = 3
      ellipse(x, y, 12, 12, '#baa48b', '#f2e2cb', 1.4)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      ellipse(x, y, 9.5, 9.5, '#485044')
      for (let n = 0; n < 7; n++) {
        const angle = n * Math.PI * 2 / 7
        const lx = x + Math.cos(angle) * 5.5
        const ly = y + Math.sin(angle) * 5.5
        ctx.save()
        ctx.translate(lx, ly)
        ctx.rotate(angle + Math.PI / 2)
        ellipse(0, -2, 3.3, 8.2, n % 2 === 0 ? '#6d8561' : '#354e3c')
        ctx.restore()
      }
      ellipse(x, y, 2.5, 2.5, '#a0ad77')
      ctx.restore()
    }

    function drawAvatar(x, y, name, color) {
      // A restrained, top-down human marker instead of a glowing ball.
      ctx.save()
      ctx.shadowColor = 'rgba(27,38,39,0.28)'
      ctx.shadowBlur = 7
      ctx.shadowOffsetY = 4
      ellipse(x + 1, y + 7, 17, 12, 'rgba(26,35,37,0.17)')
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      ellipse(x, y, 18.5, 18.5, '#faf8f1', 'rgba(48,55,55,0.34)', 1)
      ellipse(x, y, 15.5, 15.5, color)
      // Top-down shoulders, head and front highlight.
      ellipse(x, y + 6, 10, 8, 'rgba(20,43,52,0.43)')
      ellipse(x, y - 3.5, 7.3, 7.3, '#f4d2b0', '#e8bb91', 0.8)
      ctx.beginPath()
      ctx.arc(x, y - 4.5, 7.4, Math.PI * 1.05, Math.PI * 1.93)
      ctx.strokeStyle = '#3f3730'
      ctx.lineWidth = 3
      ctx.stroke()
      ellipse(x - 2.1, y - 5.5, 1.2, 1.2, 'rgba(255,255,255,0.55)')
      ctx.restore()

      ctx.save()
      ctx.font = '600 11px Arial'
      ctx.textAlign = 'center'
      const labelWidth = Math.min(205, ctx.measureText(name).width + 21)
      ctx.shadowColor = 'rgba(11,20,25,0.23)'
      ctx.shadowBlur = 5
      rounded(x - labelWidth / 2, y - 45, labelWidth, 19, 6, 'rgba(33,42,44,0.92)', 'rgba(255,255,255,0.23)', 0.6)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#f8f8f4'
      ctx.fillText(name, x, y - 32)
      ctx.restore()
    }

    function drawRoom(zone) {
      const { x, y, w, h, title, subtitle } = zone
      ctx.save()
      ctx.shadowColor = 'rgba(56,46,36,0.24)'
      ctx.shadowBlur = 15
      ctx.shadowOffsetY = 5
      rounded(x, y, w, h, 5, '#e9e5dc', '#807c73', 3)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      // Layered warm wood planks, toned differently for each function.
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x + 7, y + 7, w - 14, h - 14, 3)
      ctx.clip()
      const plankBase = ctx.createLinearGradient(x, y, x + w, y + h)
      if (title === 'LOUNGE') {
        plankBase.addColorStop(0, '#b6b0a3')
        plankBase.addColorStop(0.6, '#dad4c7')
        plankBase.addColorStop(1, '#b5ad9f')
      } else {
        plankBase.addColorStop(0, '#e5c7a1')
        plankBase.addColorStop(0.55, '#ccaa81')
        plankBase.addColorStop(1, '#b68e67')
      }
      ctx.fillStyle = plankBase
      ctx.fillRect(x + 7, y + 7, w - 14, h - 14)
      woodGrain(x + 7, y + 7, w - 14, h - 14, title === 'LOUNGE' ? 'rgba(72,71,64,0.09)' : 'rgba(110,80,52,0.16)', 12)

      if (title === 'MEETING AREA' || title === 'LOUNGE') {
        // Large muted rug anchors the furniture and creates depth.
        ctx.shadowColor = 'rgba(49,45,38,0.15)'
        ctx.shadowBlur = 5
        rounded(x + 25, y + 72, w - 50, h - 94, 7,
          title === 'MEETING AREA' ? '#a1a9a4' : '#8a9c90', '#e6e2d5', 3)
        ctx.shadowBlur = 0
        rounded(x + 33, y + 80, w - 66, h - 110, 3, null, 'rgba(242,241,229,0.40)', 1)
      }
      ctx.restore()

      // An actual architectural wall, rather than a floating game HUD block.
      ctx.fillStyle = '#746b5f'
      ctx.fillRect(x + 2, y + 2, w - 4, 7)
      ctx.fillStyle = '#f7f1e5'
      ctx.fillRect(x + 5, y + 9, w - 10, 3)
      ctx.fillStyle = 'rgba(71,75,71,0.27)'
      ctx.fillRect(x + 5, y + h - 9, w - 10, 5)
      ctx.fillStyle = 'rgba(255,255,255,0.43)'
      ctx.fillRect(x + 10, y + 54, w - 20, 1)

      // Glass panels on corridor-side facade; passable geometry unchanged.
      const edge = x < WIDTH / 2 ? x + w - 7 : x + 7
      ctx.fillStyle = 'rgba(206,231,226,0.25)'
      ctx.fillRect(edge - 2, y + 64, 4, 49)
      ctx.fillRect(edge - 2, y + 149, 4, 42)
      ctx.strokeStyle = '#77908c'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(edge, y + 63)
      ctx.lineTo(edge, y + 113)
      ctx.moveTo(edge, y + 149)
      ctx.lineTo(edge, y + 191)
      ctx.stroke()

      // Minimal room label, with no bulky opaque HUD panel.
      ctx.textAlign = 'left'
      ctx.font = '700 12px Arial'
      ctx.fillStyle = '#39443f'
      ctx.fillText(title, x + 18, y + 27)
      ctx.font = '10px Arial'
      ctx.fillStyle = '#666d67'
      ctx.fillText(subtitle, x + 18, y + 42)
      ctx.fillStyle = '#8d8070'
      rounded(x + w - 32, y + 17, 15, 3, 1, '#978f7f')
      ctx.restore()
    }

    function drawOfficeChair(cx, cy, scale = 1, tint = '#414b4a') {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      ctx.shadowColor = 'rgba(38,32,29,0.25)'
      ctx.shadowBlur = 5
      ctx.shadowOffsetY = 2
      ellipse(0, 0, 10.2, 10.2, '#323a3b')
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      ellipse(0, -0.3, 7.3, 7.5, tint, '#7d8984', 0.9)
      rounded(-8, -9, 16, 4, 2, '#283333', '#74817e', 0.6)
      rounded(-10, -1, 3, 8, 1, '#2d3433')
      rounded(7, -1, 3, 8, 1, '#2d3433')
      ctx.restore()
    }

    function drawDesk(item) {
      const { x, y, w, h } = item
      ctx.save()
      ctx.shadowColor = 'rgba(45,34,28,0.28)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 3
      rounded(x + 1, y + 2, w - 2, h - 2, 3, '#6e5542', '#5b4738', 1)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      const oak = ctx.createLinearGradient(x, y, x + w, y + h)
      oak.addColorStop(0, '#edcea8')
      oak.addColorStop(0.55, '#cda476')
      oak.addColorStop(1, '#a37b51')
      rounded(x + 2, y + 1, w - 4, h - 5, 3, oak, 'rgba(255,246,227,0.8)', 0.7)
      ctx.fillStyle = 'rgba(83,62,43,0.2)'
      ctx.fillRect(x + 6, y + h - 5, w - 12, 1)

      // Flat-screen monitor, visible bezel, stand, tiny UI lines.
      rounded(x + 7, y + 4, 24, 13, 2, '#30393a', '#18252a', 0.8)
      rounded(x + 9, y + 5, 20, 10, 1, '#6f9696')
      ctx.fillStyle = '#d3e0d4'
      ctx.fillRect(x + 11, y + 7, 11, 1.5)
      ctx.fillStyle = '#aac0b2'
      ctx.fillRect(x + 11, y + 10, 7, 1)
      ctx.fillRect(x + 11, y + 12, 13, 1)
      ctx.fillStyle = '#424a47'
      ctx.fillRect(x + 18, y + 17, 2, 2)
      ctx.fillRect(x + 14, y + 19, 10, 1)
      // Compact keyboard with visible keys and mouse.
      rounded(x + 7, y + 21, 27, 4, 1, '#5a5f59')
      ctx.fillStyle = '#d6d8cf'
      for (let k = 0; k < 11; k++) ctx.fillRect(x + 9 + k * 2, y + 22, 1, 0.85)
      ellipse(x + 38, y + 22, 2.2, 3.5, '#4b5654')
      // Ceramic mug and notebook.
      rounded(x + 44, y + 5, 10, 14, 1, '#e4e2d6', '#9b927e', 0.6)
      ctx.strokeStyle = '#a6ada6'
      ctx.lineWidth = 0.65
      for (let ly = y + 9; ly <= y + 15; ly += 3) {
        ctx.beginPath(); ctx.moveTo(x + 46, ly); ctx.lineTo(x + 52, ly); ctx.stroke()
      }
      ellipse(x + 59, y + 9, 3.2, 3.2, '#faf7ed', '#bbb4a3', 0.7)
      ellipse(x + 59, y + 9, 1.7, 1.7, '#725f4b')

      // Chair occupies remaining collision footprint, not additional obstacles.
      drawOfficeChair(x + w - 8.5, y + h / 2 + 0.8, 0.63)
      ctx.restore()
    }

    function drawMeetingTable(item) {
      const { x, y, w, h } = item
      ctx.save()
      ctx.shadowColor = 'rgba(34,38,34,0.20)'
      ctx.shadowBlur = 11
      ctx.shadowOffsetY = 3
      rounded(x, y, w, h, 12, '#505a53', '#313e38', 1)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      // Chairs arranged along the two sides within collision footprint.
      for (let i = 0; i < 4; i++) {
        const cx = x + 26 + i * 26
        drawOfficeChair(cx, y + 10.5, 0.68, '#63716a')
        drawOfficeChair(cx, y + h - 9.5, 0.68, '#63716a')
      }
      const top = ctx.createLinearGradient(x + 9, y + 13, x + w - 9, y + h - 13)
      top.addColorStop(0, '#e4bd91')
      top.addColorStop(0.6, '#b58d64')
      top.addColorStop(1, '#99704f')
      rounded(x + 13, y + 14, w - 26, h - 28, 12, top, '#f1dbc0', 1)
      woodGrain(x + 23, y + 19, w - 46, h - 38, 'rgba(84,61,43,0.12)', 7)
      rounded(x + 37, y + h / 2 - 5, 21, 10, 2, '#343f40')
      rounded(x + 39, y + h / 2 - 4, 17, 7, 1, '#8aa4a2')
      ellipse(x + w - 38, y + h / 2, 5, 5, '#e6ddc9')
      ellipse(x + w - 38, y + h / 2, 2.5, 2.5, '#6b806c')
      ctx.restore()
    }

    function drawSofa(item) {
      const { x, y, w, h } = item
      ctx.save()
      ctx.shadowColor = 'rgba(37,47,40,0.30)'
      ctx.shadowBlur = 9
      ctx.shadowOffsetY = 4
      rounded(x, y, w, h, 8, '#475a50', '#31453b', 1)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      rounded(x + 5, y + 4, w - 10, h - 8, 5, '#b2c0ac', '#718577', 1)
      rounded(x + 5, y + 4, w - 10, 10, 3, '#6d8879', '#425d50', 0.8)
      const seat = (w - 22) / 3
      for (let i = 0; i < 3; i++) {
        rounded(x + 9 + i * seat, y + 15, seat - 3, h - 21, 3,
          i === 1 ? '#cad0be' : '#bec7b7', 'rgba(85,112,96,0.54)', 0.7)
      }
      rounded(x + 2, y + 8, 8, h - 14, 3, '#5f796c')
      rounded(x + w - 10, y + 8, 8, h - 14, 3, '#5f796c')
      ctx.restore()
    }

    function drawCoffeeTable(item) {
      const { x, y, w, h } = item
      ctx.save()
      ctx.shadowColor = 'rgba(45,43,38,0.21)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 3
      rounded(x + 1, y + 2, w - 2, h - 2, 8, '#a99175', '#6d6355', 1)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      const glass = ctx.createLinearGradient(x + 9, y + 5, x + w - 8, y + h - 6)
      glass.addColorStop(0, '#d6c6aa')
      glass.addColorStop(1, '#bba589')
      rounded(x + 11, y + 5, w - 22, h - 10, 13, glass, '#eee2ce', 1)
      ellipse(x + w / 2 - 11, y + h / 2, 7, 7, '#e5ddd0', '#a59e90', 0.8)
      ellipse(x + w / 2 - 11, y + h / 2, 4, 4, '#758e71')
      ellipse(x + w / 2 + 16, y + h / 2 - 2, 4.5, 4.5, '#f8f5e9', '#8d8577', 0.7)
      ellipse(x + w / 2 + 16, y + h / 2 - 2, 2.4, 2.4, '#7b6250')
      ctx.restore()
    }

    function drawCounter(item) {
      const { x, y, w, h } = item
      ctx.save()
      ctx.shadowColor = 'rgba(44,34,25,0.24)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 4
      rounded(x, y, w, h, 4, '#796c5a', '#5d5349', 0.8)
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      const top = ctx.createLinearGradient(x, y, x, y + h)
      top.addColorStop(0, '#ead7b8')
      top.addColorStop(1, '#bda483')
      rounded(x + 2, y + 1, w - 4, h - 4, 3, top, '#efe0ca', 0.6)
      rounded(x + 12, y + 5, 28, 13, 2, '#303e41', '#5f6b6b', 0.6)
      rounded(x + 15, y + 7, 22, 8, 1, '#779a99')
      rounded(x + 48, y + 7, 19, 9, 1, '#eeecdf', '#acaa98', 0.7)
      ellipse(x + w - 15, y + h / 2, 6, 6, '#6e8165')
      ctx.restore()
    }

    function drawObstacle(item) {
      if (item.type === 'desk') drawDesk(item)
      else if (item.type === 'table') drawMeetingTable(item)
      else if (item.type === 'sofa') drawSofa(item)
      else if (item.type === 'coffee') drawCoffeeTable(item)
      else if (item.type === 'counter') drawCounter(item)
    }

    function drawFloorDetails() {
      // Interior details are small and non-blocking; the obstacle map is unchanged.
      for (const [x, y] of [[293, 111], [57, 224], [944, 225], [711, 529]]) {
        drawPlant(x, y)
      }
      // Planters and subtle floor features in the atrium.
      for (const [x, y] of [[346, 83], [654, 83], [346, 516], [654, 516]]) {
        drawPlant(x, y)
      }
      // Small, architectural wall sconces by the reception area.
      for (const py of [91, 520]) {
        rounded(422, py, 15, 3, 1, '#f9e4aa')
        rounded(563, py, 15, 3, 1, '#f9e4aa')
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
      if (roomOnly) {
        ctx.beginPath()
        ctx.rect(focusedRoom.x - 7, focusedRoom.y - 7, focusedRoom.w + 14, focusedRoom.h + 14)
        ctx.clip()
      }

      // Day 9: premium architectural floorplan and top-down furniture.
      drawCampusLandscape()
      drawArchitecturalBase()
      roomZones.forEach(drawRoom)
      obstacles.forEach(drawObstacle)
      drawRoomDetails()
      drawFloorDetails()

      // Preserve original authoritative 100px earshot radius.
      ctx.save()
      ctx.beginPath()
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(74,117,120,0.055)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(50,105,108,0.38)'
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

          AVATAR_COLORS.includes(player.avatarColor) ? player.avatarColor : '#f472b6'

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

              <p>Architectural 2D office · Live shared workspace</p>

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
                  <span className="campus-brand-space">{currentRoom === 'CORRIDOR' ? 'OFFICE CAMPUS' : currentRoom}</span>
                </div>
                <div className="campus-live-badge" aria-label={connectionLabel}>
                  <span className={joinedOffice ? 'campus-online-light' : 'campus-offline-light'} />
                  {joinedOffice ? `${onlineMembers.length + 1} online` : connectionLabel}
                </div>
              </div>
              <div className="campus-member-rail" aria-label="People in this office">
                {[{ id: 'local', name: profile.name, color: profile.color, self: true }, ...onlineMembers]
                  .slice(0, 3)
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
                {onlineMembers.length > 2 && <div className="campus-member-more">+{onlineMembers.length - 2}</div>}
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
                    <span className="campus-room-notice">Exit the room to return to dashboard</span>
                  )}
                  <span className="campus-controls-divider" />
                  <span className="campus-walk-hint">W A S D <span>to walk</span></span>
                </div>
                {campusGuideOpen && (
                  <div className="campus-guide" role="status">
                    <strong>Explore ProxiSpeak</strong>
                    <span>Use WASD or arrow keys to walk.</span>
                    <span>Enter a room to open its immersive view.</span>
                    <span>Teammates and 100px proximity are live server data.</span>
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


