import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoomCode, formatRoomCode, inviteLink, roomIdFromCode } from './roomCodes.js'

test('normalizes valid codes without allowing confusing characters', () => {
  assert.equal(formatRoomCode('abcd-efgh'), 'ABCD-EFGH')
  assert.equal(formatRoomCode('ABCDE FGH'), null)
  assert.equal(formatRoomCode('ABCD-0000'), null)
  assert.equal(formatRoomCode('ABCD-OOOO'), null)
})

test('accepts meeting invite links and rejects unrelated URLs', () => {
  assert.equal(formatRoomCode('https://example.com/meetings.html?room=ABCD-EFGH'), 'ABCD-EFGH')
  assert.equal(formatRoomCode('https://example.com/unknown?room=ABCD-EFGH'), null)
  assert.equal(formatRoomCode('javascript:alert(1)'), null)
})

test('room ID uses a validated, predictable backend officeId', () => {
  assert.equal(roomIdFromCode('ABCD-EFGH'), 'meeting-ABCDEFGH')
  assert.equal(roomIdFromCode('bad code'), null)
})

test('invite links point to the lobby', () => {
  assert.equal(inviteLink('ABCD-EFGH', 'http://localhost:5173'), 'http://localhost:5173/meetings.html?room=ABCD-EFGH')
})

test('generated codes are valid and require cryptographically random bytes', () => {
  assert.match(createRoomCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.throws(() => createRoomCode(null), /Secure room code/)
})
