/**
 * ProxiSpeak V5 camera: physically expanded office world (2000×1200).
 * Every coordinate is a REAL multiplayer position, not a visual-only zoom.
 * Camera framing is independent from the 100px server proximity threshold.
 */
export const OFFICE_WIDTH = 2000
export const OFFICE_HEIGHT = 1200

// Source artwork was originally mapped at half the world size.
const SOURCE_ROOMS = [
  { id: 'focus-north', x: 162, y: 43, w: 72, h: 80 },
  { id: 'meeting-north', x: 249, y: 44, w: 120, h: 79 },
  { id: 'cafeteria', x: 383, y: 46, w: 211, h: 77 },
  { id: 'lounge-north', x: 611, y: 43, w: 121, h: 78 },
  { id: 'quiet-room', x: 750, y: 44, w: 75, h: 79 },
  { id: 'phone-booths', x: 164, y: 132, w: 69, h: 58 },
  { id: 'collab-west', x: 164, y: 199, w: 69, h: 67 },
  { id: 'focus-west', x: 164, y: 277, w: 69, h: 63 },
  { id: 'meeting-east', x: 755, y: 137, w: 70, h: 72 },
  { id: 'collab-east', x: 755, y: 217, w: 70, h: 59 },
  { id: 'focus-east', x: 755, y: 285, w: 70, h: 55 },
  { id: 'workstations-west', x: 261, y: 194, w: 122, h: 119 },
  { id: 'workstations-east', x: 600, y: 194, w: 111, h: 119 },
  { id: 'meeting-south', x: 163, y: 366, w: 141, h: 131 },
  { id: 'lounge-south', x: 328, y: 366, w: 100, h: 132 },
  { id: 'reception', x: 439, y: 378, w: 132, h: 138 },
  { id: 'kitchen-&-coffee', x: 586, y: 367, w: 108, h: 130 },
  { id: 'training-room', x: 710, y: 365, w: 113, h: 132 },
]

export const CAMERA_ROOMS = SOURCE_ROOMS.map(({ x, y, w, h, ...rest }) => ({
  ...rest, x: x * 2, y: y * 2, w: w * 2, h: h * 2,
}))

const FULL_OFFICE = { centerX: 1000, centerY: 600, zoom: 2, roomId: 'corridor' }
const FALLBACK_VIEWPORT = { width: 1000, height: 600 }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
function vp(viewport = FALLBACK_VIEWPORT) {
  return {
    width: Math.max(1, viewport.width || 1000),
    height: Math.max(1, viewport.height || 600),
  }
}

export function getBaseScale(viewport) {
  const { width, height } = vp(viewport)
  return Math.min(width / OFFICE_WIDTH, height / OFFICE_HEIGHT)
}

export function getCameraRoom(x, y) {
  return CAMERA_ROOMS.find(r =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  ) ?? null
}

export function getCameraTarget(x, y, viewport) {
  const { width, height } = vp(viewport)
  const base = getBaseScale(viewport)
  // Comfortable roaming window ~1050×640 world units, not a shrunken map.
  const roamScale = Math.min(width / 1050, height / 640)
  const room = getCameraRoom(x, y)
  if (!room) return {
    centerX: clamp(x, 0, OFFICE_WIDTH),
    centerY: clamp(y, 0, OFFICE_HEIGHT),
    zoom: roamScale / base,
    roomId: 'corridor',
  }
  // Focus on the entered room with breathing space; no nonuniform stretching.
  const fitScale = Math.min(width / (room.w + 130), height / (room.h + 100))
  const focusScale = Math.max(roamScale * 1.18, Math.min(fitScale, roamScale * 2.8))
  return {
    centerX: room.x + room.w / 2,
    centerY: room.y + room.h / 2,
    zoom: focusScale / base,
    roomId: room.id,
  }
}

export function createRoomCamera() { return { ...FULL_OFFICE } }

export function updateRoomCamera(camera, target, dt) {
  const ease = 1 - Math.exp(-4.8 * Math.max(0, Math.min(dt, .1)))
  camera.centerX += (target.centerX - camera.centerX) * ease
  camera.centerY += (target.centerY - camera.centerY) * ease
  camera.zoom += (target.zoom - camera.zoom) * ease
  camera.roomId = target.roomId
  return camera
}

function visibleCenter(camera, viewport) {
  const { width, height } = vp(viewport)
  const scale = getBaseScale(viewport) * Math.max(.001, camera.zoom)
  const halfW = width / (2 * scale)
  const halfH = height / (2 * scale)
  return {
    cx: halfW >= OFFICE_WIDTH / 2 ? OFFICE_WIDTH / 2 : clamp(camera.centerX, halfW, OFFICE_WIDTH - halfW),
    cy: halfH >= OFFICE_HEIGHT / 2 ? OFFICE_HEIGHT / 2 : clamp(camera.centerY, halfH, OFFICE_HEIGHT - halfH),
    scale,
  }
}

export function applyRoomCamera(ctx, camera, viewport) {
  const { width, height } = vp(viewport)
  const { cx, cy, scale } = visibleCenter(camera, viewport)
  ctx.translate(width / 2, height / 2)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)
}
export function screenToWorld(screenX, screenY, camera, viewport) {
  const { width, height } = vp(viewport)
  const { cx, cy, scale } = visibleCenter(camera, viewport)
  return {
    x: (screenX - width / 2) / scale + cx,
    y: (screenY - height / 2) / scale + cy,
  }
}
export function worldToScreen(x, y, camera, viewport) {
  const { width, height } = vp(viewport)
  const { cx, cy, scale } = visibleCenter(camera, viewport)
  return {
    x: width / 2 + (x - cx) * scale,
    y: height / 2 + (y - cy) * scale,
  }
}
