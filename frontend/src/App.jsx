
import { useEffect, useRef, useState } from 'react'
import './App.css'

const WIDTH = 900
const HEIGHT = 520
const SPEED = 4

function App() {
  const canvasRef = useRef(null)
  const keys = useRef({})
  const position = useRef({ x: 450, y: 260 })
  const [coords, setCoords] = useState({ x: 450, y: 260 })

  useEffect(() => {
    const keyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault()
      }
      keys.current[e.key.toLowerCase()] = true
    }

    const keyUp = (e) => {
      keys.current[e.key.toLowerCase()] = false
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let frameId

    function draw() {
      const p = position.current
      const k = keys.current

      if (k['arrowup'] || k['w']) p.y -= SPEED
      if (k['arrowdown'] || k['s']) p.y += SPEED
      if (k['arrowleft'] || k['a']) p.x -= SPEED
      if (k['arrowright'] || k['d']) p.x += SPEED

      p.x = Math.max(18, Math.min(WIDTH - 18, p.x))
      p.y = Math.max(18, Math.min(HEIGHT - 18, p.y))

      ctx.fillStyle = '#111827'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      ctx.strokeStyle = '#243044'
      ctx.lineWidth = 1

      for (let x = 0; x < WIDTH; x += 40) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, HEIGHT)
        ctx.stroke()
      }

      for (let y = 0; y < HEIGHT; y += 40) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(WIDTH, y)
        ctx.stroke()
      }

      // Nearby communication radius
      ctx.beginPath()
      ctx.arc(p.x, p.y, 100, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)'
      ctx.stroke()

      // Player avatar
      ctx.beginPath()
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 13px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('YOU', p.x, p.y - 28)

      setCoords(previous => {
        const x = Math.round(p.x)
        const y = Math.round(p.y)
        return previous.x === x && previous.y === y
          ? previous
          : { x, y }
      })

      frameId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [])

  return (
    <main className="office-app">
      <header className="office-header">
        <div>
          <h1>ProxiSpeak</h1>
          <p>Geospatial Proximity Audio Ecosystem</p>
        </div>
        <span className="status">● Frontend Prototype</span>
      </header>

      <section className="office-panel">
        <div className="panel-heading">
          <h2>Virtual Office</h2>
          <span>WASD / Arrow Keys to move</span>
        </div>

        <div className="canvas-container">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
          />
        </div>

        <div className="coordinates">
          <span>X: {coords.x}</span>
          <span>Y: {coords.y}</span>
          <span>Audio radius: 100px</span>
        </div>
      </section>
    </main>
  )
}

export default App
