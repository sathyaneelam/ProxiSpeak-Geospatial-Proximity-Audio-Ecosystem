/**
 * ProxiSpeak authentication REST client.
 *
 * Implements the proposed /api/auth contract without changing the existing
 * preview UI. The backend endpoints must be implemented before wiring this
 * client to protected routes.
 *
 * The session belongs in an HttpOnly cookie managed by the backend; never
 * persist passwords or session tokens in localStorage.
 */

const DEFAULT_BACKEND_URL =
  import.meta.env?.VITE_AUTH_API_URL ||
  import.meta.env?.VITE_SOCKET_URL ||
  'http://localhost:3000'

export class AuthApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

/**
 * Create an independently testable API client.
 * baseUrl is the backend origin, for example http://localhost:3000.
 */
export function createAuthApi({ baseUrl = DEFAULT_BACKEND_URL, fetchImpl = globalThis.fetch } = {}) {
  const origin = String(baseUrl).replace(/\/+$/, '')

  async function request(path, { method = 'GET', body, signal } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new AuthApiError('Fetch is not available in this environment.')
    }

    const options = {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    }

    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }

    let response
    try {
      response = await fetchImpl(`${origin}/api/auth${path}`, options)
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new AuthApiError('Cannot reach the authentication server. Please check the backend connection.')
    }

    let data = null
    const contentType = response.headers?.get('content-type') || ''
    if (contentType.includes('application/json')) {
      try {
        data = await response.json()
      } catch {
        // A broken or empty JSON response is handled below.
      }
    }

    if (!response.ok) {
      const serverMessage = typeof data?.message === 'string' && data.message.trim()
        ? data.message.trim()
        : null
      const fallback = response.status === 401
        ? 'Your session is missing or has expired.'
        : `Authentication request failed (HTTP ${response.status}).`
      throw new AuthApiError(serverMessage || fallback, response.status)
    }

    return data
  }

  return {
    signup: ({ displayName, email, password }, options = {}) => request('/signup', {
      method: 'POST',
      body: { displayName, email, password },
      signal: options.signal,
    }),
    login: ({ email, password }, options = {}) => request('/login', {
      method: 'POST',
      body: { email, password },
      signal: options.signal,
    }),
    me: (options = {}) => request('/me', { signal: options.signal }),
    logout: (options = {}) => request('/logout', {
      method: 'POST',
      signal: options.signal,
    }),
  }
}

export const authApi = createAuthApi()
