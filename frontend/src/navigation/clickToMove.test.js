import test from 'node:test'
import assert from 'node:assert/strict'
import { planClickPath, segmentIsWalkable } from './clickToMove.js'

const room = (x,y) => x < 0 || y < 0 || x > 500 || y > 500

test('clear destination uses direct path with no teleport', () => {
  assert.deepEqual(planClickPath({x:50,y:50},{x:300,y:200},room,{width:500,height:500}),[{x:300,y:200}])
})

test('rejects clicks outside the walkable map', () => {
  assert.deepEqual(planClickPath({x:50,y:50},{x:700,y:250},room,{width:500,height:500}),[])
})

test('finds a route around furniture and keeps every waypoint safe', () => {
  const blocked = (x,y) => room(x,y) || (x >= 190 && x <= 240 && y >= 0 && y <= 300)
  const start = {x:50,y:100}
  const end = {x:350,y:100}
  assert.equal(segmentIsWalkable(start,end,blocked), false)
  const path = planClickPath(start,end,blocked,{width:500,height:500,step:20})
  assert.ok(path.length >= 2, 'must route around barrier rather than stop or teleport')
  assert.deepEqual(path.at(-1),end)
  let last = start
  for (const point of path) {
    assert.ok(segmentIsWalkable(last,point,blocked), 'every segment stays outside furniture')
    last = point
  }
})

test('does not cross a fully blocked wall or a diagonal corner', () => {
  const blocked = (x,y) => room(x,y) || (x >= 190 && x <= 240 && y >= 0 && y <= 500)
  assert.deepEqual(planClickPath({x:50,y:100},{x:350,y:100},blocked,{width:500,height:500,step:20}),[])
})

test('never returns route to inside furniture', () => {
  const blocked = (x,y) => room(x,y) || (x > 100 && x < 200 && y > 100 && y < 200)
  assert.deepEqual(planClickPath({x:50,y:50},{x:160,y:160},blocked,{width:500,height:500}),[])
})
