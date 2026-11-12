import React from 'react'
import { createRoot } from 'react-dom/client'
import MiniOfficeWelcome from './auth/MiniOfficeWelcome.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MiniOfficeWelcome onEnter={() => window.location.assign('/meetings.html')} />
  </React.StrictMode>,
)
