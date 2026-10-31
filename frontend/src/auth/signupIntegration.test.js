import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi, AuthApiError } from './authApi.js'

const apiBase = 'http://localhost:3000'
const respond = (data, status) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
})

test('real backend signup response is accepted without assuming a login session', async () => {
  let sent
  const api = createAuthApi({
    baseUrl: '',
    fetchImpl: async (url, options) => {
      sent = { url, options }
      return respond({
        status: 'success',
        message: 'Account created successfully',
        data: { id: '123', displayName: 'Zaid', email: 'zaid@example.com' },
      }, 201)
    },
  })
  const result = await api.signup({
    displayName: 'Zaid', email: 'zaid@example.com', password: 'testpassword',
  })
  assert.equal(sent.url, '/api/auth/signup')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.credentials, 'include')
  assert.equal(result.data.displayName, 'Zaid')
  assert.equal(result.user, undefined)
})

test('duplicate email (HTTP 409) is a visible API error', async () => {
  const api = createAuthApi({
    baseUrl: apiBase,
    fetchImpl: async () => respond({ status: 'error', message: 'Email is already registered' }, 409),
  })
  await assert.rejects(
    api.signup({ displayName: 'Zaid', email: 'zaid@example.com', password: 'testpassword' }),
    (error) => {
      assert.ok(error instanceof AuthApiError)
      assert.equal(error.status, 409)
      assert.equal(error.message, 'Email is already registered')
      return true
    },
  )
})
