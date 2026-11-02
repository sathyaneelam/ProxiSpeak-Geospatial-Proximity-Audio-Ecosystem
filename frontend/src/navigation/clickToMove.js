/**
 * Click-to-walk route planning in real office world coordinates.
 * No teleportation; only returns waypoints reachable without crossing blocked areas.
 * `blocked(x,y)` is the SAME collision predicate used for keyboard movement.
 */
export function segmentIsWalkable(a, b, blocked, sampleSpacing = 5) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return false
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  const samples = Math.max(1, Math.ceil(distance / sampleSpacing))
  for (let n = 0; n <= samples; n += 1) {
    const t = n / samples
    if (blocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false
  }
  return true
}

/** Returns [] if the click is blocked or a safe route cannot be found. */
export function planClickPath(start, destination, blocked, { step = 20, width = 2000, height = 1200 } = {}) {
  if (typeof blocked !== 'function' || !Number.isFinite(step) || step <= 0) return []
  if (![start?.x, start?.y, destination?.x, destination?.y].every(Number.isFinite)) return []
  if (blocked(start.x, start.y) || blocked(destination.x, destination.y)) return []
  if (Math.hypot(start.x - destination.x, start.y - destination.y) < 2) return []
  if (segmentIsWalkable(start, destination, blocked)) return [{ x: destination.x, y: destination.y }]

  // Integer lattice anchored at the real player position avoids a snap/teleport.
  const origin = { x: start.x, y: start.y }
  const pos = (ix, iy) => ({ x: origin.x + ix * step, y: origin.y + iy * step })
  const key = (ix, iy) => `${ix},${iy}`
  const starts = { ix: 0, iy: 0, g: 0, f: Math.hypot(destination.x - start.x, destination.y - start.y), id: '0,0' }
  const open = [starts]
  const best = new Map([['0,0', 0]])
  const cameFrom = new Map()
  const closed = new Set()
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  let solved = null
  let expansions = 0

  while (open.length > 0 && expansions < 12000) {
    open.sort((a, b) => b.f - a.f)
    const node = open.pop()
    if (closed.has(node.id)) continue
    closed.add(node.id)
    expansions += 1
    const here = pos(node.ix, node.iy)

    if (Math.hypot(here.x - destination.x, here.y - destination.y) <= step * 1.5 &&
      segmentIsWalkable(here, destination, blocked)) {
      solved = node
      break
    }

    for (const [di, dj] of neighbors) {
      const ix = node.ix + di
      const iy = node.iy + dj
      const target = pos(ix, iy)
      if (target.x < 0 || target.y < 0 || target.x > width || target.y > height) continue
      const id = key(ix, iy)
      if (closed.has(id) || !segmentIsWalkable(here, target, blocked)) continue
      const g = node.g + Math.hypot(di, dj) * step
      if (g >= (best.get(id) ?? Infinity)) continue
      best.set(id, g)
      cameFrom.set(id, node.id)
      const h = Math.hypot(destination.x - target.x, destination.y - target.y)
      open.push({ ix, iy, id, g, f: g + h })
    }
  }
  if (!solved) return []

  const latticePath = []
  let current = solved.id
  while (current !== '0,0') {
    const [ix, iy] = current.split(',').map(Number)
    latticePath.push(pos(ix, iy))
    current = cameFrom.get(current)
    if (!current) return []
  }
  latticePath.reverse()
  latticePath.push({ x: destination.x, y: destination.y })

  // Waypoint smoothing avoids a jittery grid-like walk, without cutting corners.
  const route = []
  let anchor = start
  let index = 0
  while (index < latticePath.length) {
    let lastVisible = index
    for (let j = index + 1; j < latticePath.length; j += 1) {
      if (segmentIsWalkable(anchor, latticePath[j], blocked)) lastVisible = j
    }
    const waypoint = latticePath[lastVisible]
    route.push(waypoint)
    anchor = waypoint
    index = lastVisible + 1
  }
  return route
}
