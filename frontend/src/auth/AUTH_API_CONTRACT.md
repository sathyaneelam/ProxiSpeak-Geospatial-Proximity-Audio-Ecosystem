# Frontend authentication API preparation

This module prepares the React frontend for the authentication contract proposed
by backend teammate Sai Pranav. **The endpoints are not implemented yet** and
this commit does **not** enable real signup, login or protected routes.

## Proposed endpoints

| Client method | Request | Purpose |
| --- | --- | --- |
| `authApi.signup({ displayName, email, password })` | `POST /api/auth/signup` | Create account; response format to be confirmed |
| `authApi.login({ email, password })` | `POST /api/auth/login` | Start session |
| `authApi.me()` | `GET /api/auth/me` | Check session; expect 401 when logged out |
| `authApi.logout()` | `POST /api/auth/logout` | Invalidate session and clear cookie |

The `authApi.js` client uses `credentials: 'include'` for all requests, so the
browser can send session cookies. It does not use localStorage for tokens or
passwords. Configure backend origin using `VITE_AUTH_API_URL`, falling back to
`VITE_SOCKET_URL`, then `http://localhost:3000`.

## Before enabling authentication

1. Backend teammate implements and tests the endpoints and final JSON responses.
2. Agree whether signup creates a session or requires a separate login.
3. Backend configures credentialed CORS, secure HttpOnly/SameSite cookies and CSRF safeguards appropriate to deployment.
4. Confirm Socket.IO handshake validation uses the same session and does not change event payloads.
5. Wire login/signup UI, `/me`, logout and route protection only after the backend contract is finalized.
6. Run end-to-end tests (frontend login, session persistence, authenticated Socket.IO, logout, expiry and failure states).

## Test

From the `frontend/` directory:

```bash
node --test src/auth/authApi.test.js
```

This only tests the frontend HTTP client using mocked responses; it does not
prove backend authentication works.
