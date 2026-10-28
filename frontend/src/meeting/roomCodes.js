// A human-readable client-generated room code. This is NOT a secret or an authorization token.
// The current backend accepts any nonempty office ID and stores room presence in memory.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const VALID_CODE = /^[A-HJ-NP-Z2-9]{8}$/

export function formatRoomCode(raw) {
  if (typeof raw !== 'string') return null
  const input = raw.trim()
  let code = input
  if (/^https?:\/\//i.test(input)) {
    let url
    try { url = new URL(input) } catch { return null }
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.pathname.endsWith('/meetings.html')) return null
    code = url.searchParams.get('room') || ''
  }
  const compact = code.trim().toUpperCase().replace(/-/g, '')
  if (!VALID_CODE.test(compact)) return null
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

export function createRoomCode(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) {
    throw new Error('Secure room code generation requires HTTPS or localhost.')
  }
  // Rejection sampling avoids modulo bias: 224 is divisible by 32.
  const bytes = new Uint8Array(16)
  let result = ''
  while (result.length < 8) {
    cryptoProvider.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte < 224) result += ALPHABET[byte % ALPHABET.length]
      if (result.length === 8) break
    }
  }
  return formatRoomCode(result)
}

export function roomIdFromCode(code) {
  const formatted = formatRoomCode(code)
  return formatted ? `meeting-${formatted.replace('-', '')}` : null
}

export function inviteLink(code, baseUrl) {
  const formatted = formatRoomCode(code)
  if (!formatted) return null
  const link = new URL('/meetings.html', baseUrl)
  link.searchParams.set('room', formatted)
  return link.toString()
}
