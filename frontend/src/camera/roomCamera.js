
/**
 * ProxiSpeak — Smart Room Camera
 *
 * World coordinates: 1000 × 600 pixels.
 * Only changes the visual camera transform.
 * Never changes player coordinates, collisions or Socket.io events.
 */

export const OFFICE_WIDTH = 1000
export const OFFICE_HEIGHT = 600

export const CAMERA_ROOMS = [
  { id: 'workstation-a', x: 45, y: 45, w: 265, h: 205 },
  { id: 'workstation-b', x: 690, y: 45, w: 265, h: 205 },
  { id: 'meeting-area', x: 45, y: 350, w: 300, h: 205 },
  { id: 'lounge', x: 650, y: 350, w: 305, h: 205 },
]

const FULL_OFFICE = {
  centerX: OFFICE_WIDTH / 2,
  centerY: OFFICE_HEIGHT / 2,
  zoom: 1,
}

export function getCameraRoom(x, y) {
  return CAMERA_ROOMS.find(
    (room) =>
      x >= room.x &&
      x <= room.x + room.w &&
      y >= room.y &&
      y <= room.y + room.h
  ) ?? null
}

export function getCameraTarget(x, y) {
  const room = getCameraRoom(x, y)

  if (!room) {
    return { ...FULL_OFFICE, roomId: 'corridor' }
  }

  // Fit the selected room inside the 1000 × 600 viewport.
  // Padding allows room boundaries and furniture to remain visible.
  const horizontalZoom = OFFICE_WIDTH / (room.w + 90)
  const verticalZoom = OFFICE_HEIGHT / (room.h + 90)

  const zoom = Math.min(horizontalZoom, verticalZoom, 2.6)

  return {
    centerX: room.x + room.w / 2,
    centerY: room.y + room.h / 2,
    zoom,
    roomId: room.id,
  }
}

export function createRoomCamera() {
  return { ...FULL_OFFICE, roomId: 'corridor' }
}

export function updateRoomCamera(camera, target, dt) {
  // Frame-rate-independent smoothing.
  const smoothing = 1 - Math.exp(-5 * Math.max(0, dt))

  camera.centerX += (target.centerX - camera.centerX) * smoothing
  camera.centerY += (target.centerY - camera.centerY) * smoothing
  camera.zoom += (target.zoom - camera.zoom) * smoothing

  camera.roomId = target.roomId

  return camera
}

export function applyRoomCamera(ctx, camera) {
  // Call after clearing the canvas, before drawing the office.
  ctx.translate(OFFICE_WIDTH / 2, OFFICE_HEIGHT / 2)
  ctx.scale(camera.zoom, camera.zoom)
  ctx.translate(-camera.centerX, -camera.centerY)
}

export function screenToWorld(screenX, screenY, camera) {
  // Needed for avatar hover detection when zoomed.
  return {
    x: (screenX - OFFICE_WIDTH / 2) / camera.zoom + camera.centerX,
    y: (screenY - OFFICE_HEIGHT / 2) / camera.zoom + camera.centerY,
  }
}
