import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MeetingLobby from './meeting/MeetingLobby.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MeetingLobby />
  </StrictMode>,
)
