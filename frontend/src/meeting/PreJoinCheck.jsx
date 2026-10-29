import { useEffect, useState } from 'react'
import './PreJoinCheck.css'

// This is a pre-join connectivity/permission check, not authentication or a room reservation.
const SOCKET_SERVER = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

function StatusMark({ status }) {
  return <span className={`pj-dot pj-dot-${status}`} aria-hidden="true" />
}

export default function PreJoinCheck() {
  const [serverCycle, setServerCycle] = useState(0)
  const [server, setServer] = useState({ status: 'checking', text: 'Checking server connection…' })
  const [mic, setMic] = useState({ status: 'idle', text: 'Not checked yet' })

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    const timer = setTimeout(() => controller.abort(), 4500)

    async function verify() {
      try {
        const healthUrl = new URL('/health', SOCKET_SERVER)
        const response = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (alive) setServer({ status: 'ready', text: 'Office server is reachable' })
      } catch {
        if (alive) setServer({ status: 'error', text: 'Server not reachable. Check that the backend is running.' })
      } finally {
        clearTimeout(timer)
      }
    }

    verify()
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [serverCycle])

  function retryServer() {
    setServer({ status: 'checking', text: 'Checking server connection…' })
    setServerCycle((value) => value + 1)
  }

  async function checkMicrophone() {
    if (mic.status === 'checking') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic({ status: 'error', text: 'Microphone checking requires HTTPS or localhost in a supported browser.' })
      return
    }

    setMic({ status: 'checking', text: 'Requesting temporary microphone access…' })
    let stream
    try {
      // Permission is requested only after clicking the Check button.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const hasLiveMic = stream.getAudioTracks().some((track) => track.readyState === 'live')
      if (!hasLiveMic) throw new Error('No live microphone track')
      setMic({ status: 'ready', text: 'Microphone is available. No audio is being recorded.' })
    } catch (error) {
      let text = 'Microphone unavailable. Check browser and device settings.'
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        text = 'Microphone permission denied. Allow access in your browser settings.'
      } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
        text = 'No microphone detected. Connect a microphone and retry.'
      } else if (error?.name === 'NotReadableError') {
        text = 'Microphone is busy or unavailable. Close other apps using it.'
      }
      setMic({ status: 'error', text })
    } finally {
      // Never hold the microphone while the user is in the meeting lobby.
      stream?.getTracks().forEach((track) => track.stop())
    }
  }

  return (
    <section className="pj-wrap" aria-labelledby="pj-heading">
      <div className="pj-heading-row">
        <div>
          <h3 id="pj-heading">Before you enter</h3>
          <p>Quick device and connection checks</p>
        </div>
        <span className="pj-label">OPTIONAL</span>
      </div>

      <div className="pj-check-row">
        <div className="pj-check-title"><StatusMark status={server.status} /><strong>Connection</strong></div>
        <p role="status">{server.text}</p>
        <button type="button" onClick={retryServer} disabled={server.status === 'checking'}>
          Check again
        </button>
      </div>

      <div className="pj-check-row">
        <div className="pj-check-title"><StatusMark status={mic.status} /><strong>Microphone</strong></div>
        <p role="status">{mic.text}</p>
        <button type="button" onClick={checkMicrophone} disabled={mic.status === 'checking'}>
          {mic.status === 'ready' ? 'Test again' : 'Check microphone'}
        </button>
      </div>
      <p className="pj-footnote">Microphone access is requested only when you click Check. The test stops the stream immediately. You can still enter without testing.</p>
    </section>
  )
}
