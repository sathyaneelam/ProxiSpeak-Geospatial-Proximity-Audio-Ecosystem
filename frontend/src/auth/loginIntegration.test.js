import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi, AuthApiError } from './authApi.js'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('backend login verifies credentials without asserting a persistent session', async () => {
  let sent
  const api = createAuthApi({
    baseUrl: '',
    fetchImpl: async (url, options) => {
      sent = { url, options }
      return jsonResponse({
        status: 'success',
        message: 'Login successful',
        data: { id: 'user-1', displayName: 'Zaid', email: 'zaid@example.com' },
      })
    },
  })

  const result = await api.login({ email: 'zaid@example.com', password: 'testpassword' })
  assert.equal(sent.url, '/api/auth/login')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.credentials, 'include')
  assert.deepEqual(JSON.parse(sent.options.body), {
    email: 'zaid@example.com', password: 'testpassword',
  })
  assert.equal(result.data.id, 'user-1')
  assert.equal(result.session, undefined)
  assert.equal(result.token, undefined)
})

test('wrong login password returns a clear 401 message', async () => {
  const api = createAuthApi({
    baseUrl: '',
    fetchImpl: async () => jsonResponse({ status: 'error', message: 'Invalid email or password' }, 401),
  })

  await assert.rejects(
    api.login({ email: 'zaid@example.com', password: 'incorrect' }),
    (error) => {
      assert.ok(error instanceof AuthApiError)
      assert.equal(error.status, 401)
      assert.equal(error.message, 'Invalid email or password')
      return true
    },
  )
})

test('login network failure reports connection error', async () => {
  const api = createAuthApi({
    baseUrl: '',
    fetchImpl: async () => { throw new Error('Network unavailable') },
  })
  await assert.rejects(
    api.login({ email: 'zaid@example.com', password: 'testpassword' }),
    /Cannot reach the authentication server/,
  )
})
