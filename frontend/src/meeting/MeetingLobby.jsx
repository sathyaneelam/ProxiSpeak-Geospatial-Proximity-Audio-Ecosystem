import { useMemo, useState } from 'react'
import './MeetingLobby.css'
import PreJoinCheck from './PreJoinCheck.jsx'
import { createRoomCode, formatRoomCode, inviteLink, roomIdFromCode } from './roomCodes.js'

const DEFAULT_COLOR = '#22d3ee'

function readProfileName() {
  try {
    const profile = JSON.parse(localStorage.getItem('proxispeak-avatar-profile') || '{}')
    return typeof profile.name === 'string' && profile.name !== 'Guest' ? profile.name : ''
  } catch { return '' }
}

function Icon({ name, size = 24 }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (name === 'plus') return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'link') return <svg {...props}><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1-1"/></svg>
  if (name === 'arrow') return <svg {...props}><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
  if (name === 'copy') return <svg {...props}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
  if (name === 'check') return <svg {...props}><path d="m5 12 4 4L19 6"/></svg>
  if (name === 'back') return <svg {...props}><path d="m15 18-6-6 6-6"/></svg>
  return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="4"/></svg>
}

function DeskSketch() {
  return (
    <div className="ml-sketch" aria-hidden="true">
      <div className="ml-sketch-halo" />
      <div className="ml-sketch-laptop"><div className="ml-sketch-screen"><span /><span /><span /><i /></div><div className="ml-sketch-keyboard" /></div>
      <div className="ml-sketch-desk" /><div className="ml-sketch-leg left" /><div className="ml-sketch-leg right" />
      <div className="ml-sketch-pot left"><i /><i /><i /></div><div className="ml-sketch-pot right"><i /><i /><i /></div>
    </div>
  )
}

export default function MeetingLobby() {
  const initialCode = useMemo(() => formatRoomCode(new URLSearchParams(window.location.search).get('room') || ''), [])
  const [step, setStep] = useState(initialCode ? 'ready' : 'choose')
  const [intent, setIntent] = useState(initialCode ? 'join' : 'create')
  const [code, setCode] = useState(initialCode || '')
  const [input, setInput] = useState('')
  const [meetingName, setMeetingName] = useState('My workspace')
  const [displayName, setDisplayName] = useState(readProfileName)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')
  const link = code ? inviteLink(code, window.location.origin) : ''

  function navigate(nextStep) {
    setNotice('')
    setCopied('')
    setStep(nextStep)
  }

  function createMeeting(event) {
    event.preventDefault()
    if (!meetingName.trim()) return setNotice('Please give your space a name.')
    try {
      const generated = createRoomCode()
      setCode(generated)
      setIntent('create')
      window.history.replaceState(null, '', '/meetings.html')
      navigate('ready')
    } catch (error) { setNotice(error.message) }
  }

  function joinMeeting(event) {
    event.preventDefault()
    const parsed = formatRoomCode(input)
    if (!parsed) return setNotice('Enter an 8-character room code (e.g., ABCD-EFGH) or a valid invite link.')
    setCode(parsed)
    setIntent('join')
    window.history.replaceState(null, '', '/meetings.html')
    navigate('ready')
  }

  async function copyText(value, kind) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
    } catch {
      setNotice('Copy is unavailable here. Please select the text and copy manually.')
    }
  }

  function enterOffice() {
    const name = displayName.trim()
    if (name.length < 2 || name.length > 20) return setNotice('Display name must be 2–20 characters.')
    const roomId = roomIdFromCode(code)
    if (!roomId) return setNotice('Room code is invalid. Go back and try again.')
    // Only non-sensitive avatar preferences are saved. No passwords or auth tokens.
    try {
      const previous = JSON.parse(localStorage.getItem('proxispeak-avatar-profile') || '{}')
      const color = typeof previous.color === 'string' ? previous.color : DEFAULT_COLOR
      localStorage.setItem('proxispeak-avatar-profile', JSON.stringify({ name, color }))
    } catch {
      localStorage.setItem('proxispeak-avatar-profile', JSON.stringify({ name, color: DEFAULT_COLOR }))
    }
    window.location.assign(`/?room=${encodeURIComponent(code)}`)
  }

  return (
    <main className="ml-root">
      <header className="ml-header">
        <a href="/auth-playground.html" className="ml-brand" aria-label="ProxiSpeak welcome page"><span className="ml-brandmark"><span /></span><span>Proxi<span>Speak</span></span></a>
        <div className="ml-header-note"><span className="ml-online-dot"/> YOUR SPACE TO CONNECT</div>
      </header>
      <div className="ml-container">
        <section className="ml-copy">
          <div className="ml-overline"><span className="ml-online-dot"/> A SMALL SPACE FOR BIG IDEAS</div>
          <h1>Make room for<br/><em>being together.</em></h1>
          <p>Gather your people in a calm virtual workspace. A little closer, wherever you are.</p>
          <DeskSketch />
          <div className="ml-sketch-caption">One little workspace. So many possibilities.</div>
        </section>
        <section className="ml-panel" aria-label="Meeting options">
          {step === 'choose' && <>
            <span className="ml-card-eyebrow">LET'S GET STARTED</span>
            <h2>Your next conversation starts here.</h2>
            <p className="ml-subtitle">Create a space for your team, or enter one you've been invited to.</p>
            <div className="ml-choices">
              <button className="ml-choice" type="button" onClick={() => navigate('create')}>
                <span className="ml-choice-icon"><Icon name="plus" size={25}/></span>
                <span className="ml-choice-text"><strong>Create meeting</strong><small>Start a fresh virtual office space</small></span><Icon name="arrow" size={20}/>
              </button>
              <button className="ml-choice" type="button" onClick={() => navigate('join')}>
                <span className="ml-choice-icon join"><Icon name="link" size={24}/></span>
                <span className="ml-choice-text"><strong>Join meeting</strong><small>Enter using a room code or invite link</small></span><Icon name="arrow" size={20}/>
              </button>
            </div>
          </>}
          {step === 'create' && <>
            <button className="ml-back" type="button" onClick={() => navigate('choose')}><Icon name="back" size={16}/> All options</button>
            <span className="ml-card-eyebrow">YOUR OWN SPACE</span>
            <h2>Create a meeting.</h2>
            <p className="ml-subtitle">Give your little workspace a name. We'll generate an invite code.</p>
            <form onSubmit={createMeeting} className="ml-form">
              <label htmlFor="ml-name">Meeting name</label>
              <input id="ml-name" maxLength={60} autoFocus value={meetingName} onChange={e=>{setMeetingName(e.target.value); setNotice('')}} placeholder="e.g., Design team catch-up" required/>
              <button className="ml-primary" type="submit">Create meeting <Icon name="arrow" size={19}/></button>
            </form>
          </>}
          {step === 'join' && <>
            <button className="ml-back" type="button" onClick={() => navigate('choose')}><Icon name="back" size={16}/> All options</button>
            <span className="ml-card-eyebrow">YOU'RE INVITED</span>
            <h2>Join a meeting.</h2>
            <p className="ml-subtitle">Paste a meeting code or the link your teammate shared.</p>
            <form onSubmit={joinMeeting} className="ml-form">
              <label htmlFor="ml-code">Meeting code or link</label>
              <input id="ml-code" autoFocus value={input} onChange={e=>{setInput(e.target.value);setNotice('')}} placeholder="ABCD-EFGH or https://..." autoComplete="off" spellCheck="false" required />
              <button className="ml-primary" type="submit">Continue <Icon name="arrow" size={19}/></button>
            </form>
          </>}
          {step === 'ready' && <>
            <button className="ml-back" type="button" onClick={() => {window.history.replaceState(null,'','/meetings.html'); navigate('choose')}}><Icon name="back" size={16}/> All options</button>
            <span className="ml-card-eyebrow">{intent === 'create' ? 'YOUR MEETING IS READY' : 'READY TO JOIN'}</span>
            <h2>{intent === 'create' ? meetingName.trim() || 'Your workspace' : 'Welcome to the room.'}</h2>
            <p className="ml-subtitle">{intent === 'create' ? 'Share this invite with teammates before you head in.' : 'Confirm your name, then enter the virtual office.'}</p>
            <div className="ml-code-box"><span>ROOM CODE</span><div className="ml-code-line"><strong>{code}</strong><button type="button" onClick={()=>copyText(code,'code')} aria-label="Copy room code"><Icon name={copied === 'code' ? 'check' : 'copy'} size={20}/></button></div></div>
            <label className="ml-field-label" htmlFor="ml-link">Shareable invitation link</label>
            <div className="ml-link-box"><input id="ml-link" value={link} readOnly onFocus={e=>e.target.select()}/><button type="button" onClick={()=>copyText(link,'link')} aria-label="Copy invite link"><Icon name={copied === 'link' ? 'check' : 'copy'} size={20}/></button></div>
            {copied && <p className="ml-success" role="status">{copied === 'link' ? 'Invite link' : 'Room code'} copied!</p>}
            <label className="ml-field-label" htmlFor="ml-display-name">Your display name</label>
            <input id="ml-display-name" className="ml-display-input" value={displayName} maxLength={20} onChange={e=>{setDisplayName(e.target.value);setNotice('')}} placeholder="What should teammates call you?" autoComplete="nickname" />
            <PreJoinCheck />
            <button className="ml-primary" type="button" onClick={enterOffice}>Enter virtual office <Icon name="arrow" size={19}/></button>
          </>}
          {notice && <p className="ml-alert" role="alert">{notice}</p>}
          <p className="ml-disclaimer"><span className="ml-online-dot"/> Frontend preview: meeting codes route to Socket.io rooms; authentication, access controls and invitation verification are not yet implemented.</p>
        </section>
      </div>
      <footer className="ml-footer"><span>ProxiSpeak · Made for the moments in between.</span><span>Work · Connect · Be present</span></footer>
    </main>
  )
}
