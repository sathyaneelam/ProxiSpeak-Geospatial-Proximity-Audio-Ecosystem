import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError, createAuthApi } from './authApi.js'

const BASE_URL = 'http://localhost:3000'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('signup sends the proposed fields and includes session cookies', async () => {
  let request
  const api = createAuthApi({
    baseUrl: `${BASE_URL}/`,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return jsonResponse({ user: { id: 'user-1' } }, 201)
    },
  })

  const result = await api.signup({
    displayName: 'Zaid',
    email: 'zaid@example.com',
    password: 'password123',
  })

  assert.equal(request.url, `${BASE_URL}/api/auth/signup`)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'include')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), {
    displayName: 'Zaid',
    email: 'zaid@example.com',
    password: 'password123',
  })
  assert.deepEqual(result, { user: { id: 'user-1' } })
})

test('login sends email and password without placing secrets in the URL', async () => {
  let request
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return jsonResponse({ user: { id: 'user-1' } })
    },
  })

  await api.login({ email: 'zaid@example.com', password: 'password123' })
  assert.equal(request.url, `${BASE_URL}/api/auth/login`)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'include')
  assert.deepEqual(JSON.parse(request.options.body), {
    email: 'zaid@example.com',
    password: 'password123',
  })
})

test('me checks the existing session with GET and no body', async () => {
  let request
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return jsonResponse({ user: { displayName: 'Zaid' } })
    },
  })

  const result = await api.me()
  assert.equal(request.url, `${BASE_URL}/api/auth/me`)
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.body, undefined)
  assert.equal(request.options.credentials, 'include')
  assert.equal(result.user.displayName, 'Zaid')
})

test('logout uses POST with credentials and accepts an empty response', async () => {
  let request
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(null, { status: 204 })
    },
  })

  assert.equal(await api.logout(), null)
  assert.equal(request.url, `${BASE_URL}/api/auth/logout`)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'include')
})

test('me surfaces 401 for missing or expired sessions', async () => {
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async () => jsonResponse({ message: 'Not authenticated' }, 401),
  })

  await assert.rejects(api.me(), (error) => {
    assert.ok(error instanceof AuthApiError)
    assert.equal(error.status, 401)
    assert.equal(error.message, 'Not authenticated')
    return true
  })
})

test('network errors give a clear error without exposing credentials', async () => {
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async () => { throw new TypeError('Failed to fetch') },
  })

  await assert.rejects(api.login({ email: 'x@y.com', password: 'secret' }), (error) => {
    assert.ok(error instanceof AuthApiError)
    assert.equal(error.status, 0)
    assert.match(error.message, /Cannot reach the authentication server/)
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
})

test('aborted requests preserve AbortError', async () => {
  const api = createAuthApi({
    baseUrl: BASE_URL,
    fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError') },
  })

  await assert.rejects(api.me(), { name: 'AbortError' })
})
