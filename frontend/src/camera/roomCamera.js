/**
 * ProxiSpeak Campus V3 camera.
 * World positions are ALWAYS authoritative 1000 × 600 units.
 * Viewport-specific transforms affect rendering, hover and framing only.
 */
export const OFFICE_WIDTH = 1000
export const OFFICE_HEIGHT = 600

export const CAMERA_ROOMS = [
  { id: 'workstation-a', x: 45, y: 45, w: 265, h: 205 },
  { id: 'workstation-b', x: 690, y: 45, w: 265, h: 205 },
  { id: 'meeting-area', x: 45, y: 350, w: 300, h: 205 },
  { id: 'lounge', x: 650, y: 350, w: 305, h: 205 },
]

const DEFAULT_VIEWPORT = { width: OFFICE_WIDTH, height: OFFICE_HEIGHT }
const FULL_OFFICE = { centerX: OFFICE_WIDTH / 2, centerY: OFFICE_HEIGHT / 2, zoom: 1, roomId: 'corridor' }

function getViewport(viewport = DEFAULT_VIEWPORT) {
  return {
    width: Math.max(1, viewport.width || OFFICE_WIDTH),
    height: Math.max(1, viewport.height || OFFICE_HEIGHT),
  }
}

export function getBaseScale(viewport) {
  const { width, height } = getViewport(viewport)
  return Math.min(width / OFFICE_WIDTH, height / OFFICE_HEIGHT)
}

export function getCameraRoom(x, y) {
  return CAMERA_ROOMS.find((room) =>
    x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h
  ) ?? null
}

export function getCameraTarget(x, y, viewport) {
  const room = getCameraRoom(x, y)
  if (!room) return { ...FULL_OFFICE }

  const { width, height } = getViewport(viewport)
  // Fit the WHOLE room inside the visible viewport without stretching.
  // 32px/28px architectural breathing room around the boundary.
  const roomPixelsPerWorldUnit = Math.min(
    width / (room.w + 32),
    height / (room.h + 28)
  )
  return {
    centerX: room.x + room.w / 2,
    centerY: room.y + room.h / 2,
    zoom: Math.min(roomPixelsPerWorldUnit / getBaseScale(viewport), 5),
    roomId: room.id,
  }
}

export function createRoomCamera() {
  return { ...FULL_OFFICE }
}

export function updateRoomCamera(camera, target, dt) {
  const smoothing = 1 - Math.exp(-5.5 * Math.max(0, dt))
  camera.centerX += (target.centerX - camera.centerX) * smoothing
  camera.centerY += (target.centerY - camera.centerY) * smoothing
  camera.zoom += (target.zoom - camera.zoom) * smoothing
  camera.roomId = target.roomId
  return camera
}

export function applyRoomCamera(ctx, camera, viewport) {
  const { width, height } = getViewport(viewport)
  const scale = getBaseScale(viewport) * camera.zoom
  ctx.translate(width / 2, height / 2)
  ctx.scale(scale, scale)
  ctx.translate(-camera.centerX, -camera.centerY)
}

export function screenToWorld(screenX, screenY, camera, viewport) {
  const { width, height } = getViewport(viewport)
  const scale = getBaseScale(viewport) * camera.zoom
  return {
    x: (screenX - width / 2) / scale + camera.centerX,
    y: (screenY - height / 2) / scale + camera.centerY,
  }
}

export function worldToScreen(x, y, camera, viewport) {
  const { width, height } = getViewport(viewport)
  const scale = getBaseScale(viewport) * camera.zoom
  return {
    x: width / 2 + (x - camera.centerX) * scale,
    y: height / 2 + (y - camera.centerY) * scale,
  }
}
