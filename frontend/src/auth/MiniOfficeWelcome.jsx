import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import './MiniOfficeWelcome.css'
import { createAuthApi } from './authApi.js'

// Use Vite's same-origin /api proxy; avoid cross-origin cookie/CORS surprises.
const signupApi = createAuthApi({ baseUrl: '' })

const PALETTE = {
  ink: '#27334a',
  black: '#202939',
  cream: '#f8f5ee',
  wood: '#c5a789',
  woodLeg: '#967960',
  green: '#668c76',
  pot: '#ece6da',
  suit: '#657585',
  skin: '#e9bf9b',
}

function Plant({ position, scale = 1 }) {
  const leaves = [
    { x: 0.14, y: 0.58, z: 0, rz: 0.55, ry: -0.2 },
    { x: -0.14, y: 0.6, z: 0, rz: -0.55, ry: 0.1 },
    { x: 0, y: 0.74, z: 0.1, rz: 0.04, ry: 0 },
    { x: 0.08, y: 0.65, z: -0.13, rz: 0.3, ry: 0.9 },
    { x: -0.07, y: 0.63, z: 0.16, rz: -0.22, ry: -0.6 },
  ]
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.36, 24]} />
        <meshStandardMaterial color={PALETTE.pot} roughness={0.83} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.185, 0.185, 0.02, 24]} />
        <meshStandardMaterial color="#b8a58d" />
      </mesh>
      <mesh position={[0, 0.53, 0]}>
        <cylinderGeometry args={[0.018, 0.023, 0.43, 8]} />
        <meshStandardMaterial color="#799578" />
      </mesh>
      {leaves.map(({ x, y, z, rz, ry }, index) => (
        <mesh
          key={index}
          castShadow
          position={[x, y, z]}
          rotation={[0, ry, rz]}
          scale={[0.075, 0.21, 0.045]}
        >
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color={index % 2 ? '#769a80' : PALETTE.green} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function LaptopDisplay() {
  const bars = useRef([])
  const dots = useRef([])
  const cursor = useRef(null)
  const status = useRef(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    bars.current.forEach((bar, index) => {
      if (bar) bar.scale.y = 0.55 + 0.4 * (1 + Math.sin(t * 2.1 + index * 0.77)) / 2
    })
    dots.current.forEach((dot, index) => {
      if (dot) dot.material.opacity = 0.33 + 0.6 * (1 + Math.sin(t * 1.7 + index * 1.6)) / 2
    })
    if (cursor.current) cursor.current.visible = Math.sin(t * 3.8) > -0.25
    if (status.current) status.current.position.x = 0.18 + 0.02 * Math.sin(t * 0.7)
  })

  const neutral = '#7f9a92'
  return (
    <group position={[0, 0.34, 0.038]}>
      <mesh>
        <planeGeometry args={[0.693, 0.581]} />
        <meshBasicMaterial color="#283b41" />
      </mesh>
      {/* A restrained living dashboard: status / chart / message activity. */}
      <mesh position={[-0.27, 0.205, 0.003]}>
        <planeGeometry args={[0.1, 0.018]} />
        <meshBasicMaterial color="#b4c8c0" />
      </mesh>
      <mesh ref={status} position={[0.18, 0.204, 0.004]}>
        <circleGeometry args={[0.016, 12]} />
        <meshBasicMaterial color="#a4d2b6" />
      </mesh>
      <mesh position={[0, 0.159, 0.002]}>
        <planeGeometry args={[0.59, 0.003]} />
        <meshBasicMaterial color="#59726d" transparent opacity={0.45} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
        <mesh
          key={index}
          ref={(node) => { bars.current[index] = node }}
          position={[-0.22 + index * 0.059, -0.024, 0.007]}
        >
          <planeGeometry args={[0.033, 0.175]} />
          <meshBasicMaterial color={index % 3 === 0 ? '#a8c7bd' : neutral} />
        </mesh>
      ))}
      <mesh position={[-0.185, -0.162, 0.006]}>
        <planeGeometry args={[0.18, 0.017]} />
        <meshBasicMaterial color="#8faea5" />
      </mesh>
      <mesh position={[-0.16, -0.196, 0.006]}>
        <planeGeometry args={[0.23, 0.012]} />
        <meshBasicMaterial color="#617e79" />
      </mesh>
      <mesh position={[0.11, -0.162, 0.006]}>
        <planeGeometry args={[0.12, 0.017]} />
        <meshBasicMaterial color="#8ba69b" />
      </mesh>
      <mesh ref={cursor} position={[0.188, -0.162, 0.008]}>
        <planeGeometry args={[0.006, 0.025]} />
        <meshBasicMaterial color="#d6e4da" />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} ref={(node) => { dots.current[index] = node }} position={[0.11 + index * 0.055, -0.228, 0.009]}>
          <circleGeometry args={[0.011, 12]} />
          <meshBasicMaterial color="#b9cfbf" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function Workspace() {
  return (
    <group>
      {/* One desk with one laptop, and only two small plants around it. */}
      <mesh castShadow receiveShadow position={[-1.54, 0.72, -0.68]}>
        <boxGeometry args={[2.65, 0.12, 1.15]} />
        <meshStandardMaterial color={PALETTE.wood} roughness={0.82} />
      </mesh>
      {[-2.67, -0.4].flatMap((x) => [-1.12, -0.22].map((z) => (
        <mesh key={`${x}-${z}`} castShadow position={[x, 0.35, z]}>
          <boxGeometry args={[0.085, 0.68, 0.085]} />
          <meshStandardMaterial color={PALETTE.woodLeg} roughness={0.88} />
        </mesh>
      )))}
      {/* Laptop: screen and keyboard only — no commercial branding. */}
      <mesh position={[-1.53, 0.81, -0.72]} castShadow>
        <boxGeometry args={[0.75, 0.035, 0.48]} />
        <meshStandardMaterial color="#c8cdd0" metalness={0.2} roughness={0.44} />
      </mesh>
      <group position={[-1.53, 0.84, -0.96]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.34, 0]} castShadow>
          <boxGeometry args={[0.77, 0.67, 0.045]} />
          <meshStandardMaterial color="#b7bec4" roughness={0.4} />
        </mesh>
        <LaptopDisplay />
      </group>

      {/* Single minimal desk chair. */}
      <group position={[-1.57, 0, 0.4]}>
        <mesh position={[0, 0.39, 0]} castShadow>
          <boxGeometry args={[0.67, 0.12, 0.58]} />
          <meshStandardMaterial color="#66727a" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.72, 0.27]} castShadow>
          <boxGeometry args={[0.68, 0.7, 0.11]} />
          <meshStandardMaterial color="#78858b" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.35, 12]} />
          <meshStandardMaterial color="#575f68" />
        </mesh>
        <mesh position={[0, 0.045, 0]} castShadow>
          <boxGeometry args={[0.55, 0.05, 0.45]} />
          <meshStandardMaterial color="#575f68" />
        </mesh>
      </group>
      <Plant position={[-3.22, 0, -0.68]} scale={0.88} />
      <Plant position={[0.18, 0, -0.83]} scale={0.77} />
    </group>
  )
}

function EnterButton({ visible, pressed }) {
  const button = useRef(null)
  useFrame((state, delta) => {
    if (!button.current) return
    const target = visible ? (pressed ? 0.88 : 1) : 0.001
    button.current.scale.x += (target - button.current.scale.x) * Math.min(1, delta * 9)
    button.current.scale.y += (target - button.current.scale.y) * Math.min(1, delta * 9)
    button.current.scale.z += (target - button.current.scale.z) * Math.min(1, delta * 9)
  })
  return (
    <group ref={button} position={[2.25, 0.94, 0.36]} scale={0.001}>
      <mesh castShadow position={[0, 0, -0.045]}>
        <boxGeometry args={[0.75, 0.46, 0.16]} />
        <meshStandardMaterial color="#d5d9d6" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.055]}>
        <boxGeometry args={[0.67, 0.37, 0.12]} />
        <meshStandardMaterial color={pressed ? '#a0b8ab' : '#b7cdc0'} roughness={0.68} />
      </mesh>
      {/* Minimal arrow glyph fashioned in geometry, rather than a neon label. */}
      <mesh position={[-0.03, 0, 0.13]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.22, 10]} />
        <meshStandardMaterial color="#2d5344" />
      </mesh>
      <mesh position={[0.08, 0.045, 0.13]} rotation={[0, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.014, 0.014, 0.15, 10]} />
        <meshStandardMaterial color="#2d5344" />
      </mesh>
      <mesh position={[0.08, -0.045, 0.13]} rotation={[0, 0, -Math.PI / 4]}>
        <cylinderGeometry args={[0.014, 0.014, 0.15, 10]} />
        <meshStandardMaterial color="#2d5344" />
      </mesh>
    </group>
  )
}

// ONE single character throughout idle, jump, walk and tap. Never duplicate the model.
function OfficePerson({ run, onProgress, onComplete, onMoodChange }) {
  const root = useRef(null)
  const body = useRef(null)
  const head = useRef(null)
  const leftLeg = useRef(null)
  const rightLeg = useRef(null)
  const leftArm = useRef(null)
  const rightArm = useRef(null)
  const phone = useRef(null)
  const eyes = useRef([])
  const cheeks = useRef([])
  const motion = useRef({ start: null, done: false, phase: 'idle', mood: '' })

  useEffect(() => {
    motion.current = { start: null, done: false, phase: 'idle', mood: '' }
  }, [run])

  useFrame(({ clock }) => {
    if (!root.current) return
    const t = clock.elapsedTime
    const updateMood = (mood) => {
      if (motion.current.mood !== mood) {
        motion.current.mood = mood
        onMoodChange(mood)
      }
    }
    // Natural micro-movements are muted, not hyperactive or neon.
    if (body.current) body.current.scale.y = 1 + Math.sin(t * 1.6) * 0.009
    if (head.current) head.current.position.y = 1.365 + Math.sin(t * 1.3) * 0.012
    const blink = t % 4.9 < 0.115 || (t + 1.4) % 8.1 < 0.09
    eyes.current.forEach((eye) => { if (eye) eye.scale.y = blink ? 0.095 : 1 })
    cheeks.current.forEach((cheek) => { if (cheek) cheek.material.opacity = 0.36 + Math.sin(t * 1.1) * 0.025 })

    if (run === 0) {
      const cycle = t % 24
      const mode = cycle >= 7.5 && cycle < 12.5 ? 'phone'
        : cycle >= 16.2 && cycle < 18.8 ? 'stretch'
          : cycle >= 19.1 && cycle < 20.7 ? 'wave' : 'typing'
      updateMood(mode)
      root.current.position.set(-1.57, Math.sin(t * 1.5) * 0.009, 0.38)
      root.current.rotation.y = 2.55 + Math.sin(t * 0.35) * 0.045
      if (head.current) {
        head.current.rotation.z = mode === 'phone' ? -0.13 : Math.sin(t * 0.6) * 0.05
        head.current.rotation.x = mode === 'phone' ? 0.17 : -0.04
        head.current.rotation.y = mode === 'wave' ? -0.28 : Math.sin(t * 0.4) * 0.09
      }
      if (phone.current) phone.current.visible = mode === 'phone'
      if (leftArm.current) leftArm.current.rotation.x = mode === 'typing' ? -0.58 + Math.sin(t * 7.7) * 0.075 : mode === 'phone' ? -0.95 : mode === 'stretch' ? -2.0 : -0.45
      if (rightArm.current) rightArm.current.rotation.x = mode === 'typing' ? -0.58 + Math.sin(t * 8.2 + 2) * 0.075 : mode === 'phone' ? -1.12 : mode === 'stretch' ? -2.15 : -1.0
      if (rightArm.current) rightArm.current.rotation.z = mode === 'wave' ? -0.48 + Math.sin(t * 9) * 0.15 : 0
      if (leftArm.current) leftArm.current.rotation.z = mode === 'stretch' ? -0.25 : 0
      if (leftLeg.current) leftLeg.current.rotation.x = -0.92 + Math.sin(t * 0.8) * 0.025
      if (rightLeg.current) rightLeg.current.rotation.x = -0.92
      return
    }

    if (phone.current) phone.current.visible = false
    if (motion.current.start === null) motion.current.start = t
    const elapsed = t - motion.current.start
    let phase = 'jump'
    let x = -1.57
    let y = 0
    let yaw = 2.55
    let leftSwing = 0
    let rightSwing = 0
    let armReach = 0

    if (elapsed < 1.08) {
      const p = elapsed / 1.08
      x = -1.57 + p * 0.4
      y = Math.max(0, 0.57 * Math.sin(Math.PI * p))
      yaw = 2.55 - p * (2.55 - Math.PI / 2)
      leftSwing = -0.75 + p * 0.9
      rightSwing = -0.75 + p * 0.9
    } else if (elapsed < 4.55) {
      phase = 'walking'
      const p = Math.min(1, (elapsed - 1.08) / 3.47)
      const ease = p * p * (3 - 2 * p)
      x = -1.17 + ease * 3.05
      yaw = Math.PI / 2
      y = 0.038 * Math.abs(Math.sin(p * Math.PI * 14))
      leftSwing = Math.sin(p * Math.PI * 14) * 0.46
      rightSwing = -leftSwing
    } else if (elapsed < 5.15) {
      phase = 'revealing'
      x = 1.88
      yaw = Math.PI / 2
      leftSwing = 0
    } else if (elapsed < 6.08) {
      phase = 'tapping'
      x = 1.88
      yaw = Math.PI / 2
      armReach = Math.min(1, (elapsed - 5.15) / 0.5)
    } else {
      phase = 'entering'
      x = 1.88
      yaw = Math.PI / 2
      armReach = 1
      y = Math.sin(Math.min((elapsed - 6.08) / 0.65, 1) * Math.PI) * 0.055
    }

    root.current.position.set(x, y, 0.38)
    root.current.rotation.y = yaw
    if (head.current) {
      head.current.rotation.x = phase === 'tapping' ? -0.05 : 0
      head.current.rotation.y = Math.sin(t * 1.4) * 0.035
      head.current.rotation.z = phase === 'entering' ? -0.11 : 0
    }
    if (leftLeg.current) leftLeg.current.rotation.x = phase === 'walking' ? leftSwing : phase === 'jump' ? -0.6 : 0
    if (rightLeg.current) rightLeg.current.rotation.x = phase === 'walking' ? rightSwing : phase === 'jump' ? -0.6 : 0
    if (leftArm.current) {
      leftArm.current.rotation.x = phase === 'walking' ? -leftSwing * 0.65 : phase === 'jump' ? -0.8 : 0
      leftArm.current.rotation.z = 0
    }
    if (rightArm.current) {
      rightArm.current.rotation.x = phase === 'walking' ? -rightSwing * 0.65 : phase === 'jump' ? -0.8 : -armReach * 1.55
      rightArm.current.rotation.z = 0
    }
    if (motion.current.phase !== phase) {
      motion.current.phase = phase
      onProgress(phase)
    }
    if (elapsed >= 6.86 && !motion.current.done) {
      motion.current.done = true
      onComplete()
    }
  })

  return (
    <group ref={root} position={[-1.57, 0, 0.38]} scale={0.87}>
      {/* Miniature soft-tailored office outfit: shorter limbs, bigger head, rounded shape. */}
      <mesh ref={body} position={[0, 0.84, 0]} castShadow>
        <capsuleGeometry args={[0.224, 0.28, 8, 20]} />
        <meshStandardMaterial color="#697b77" roughness={0.96} />
      </mesh>
      <mesh position={[0, 0.86, 0.196]} castShadow>
        <boxGeometry args={[0.12, 0.22, 0.02]} />
        <meshStandardMaterial color="#f7f6f1" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.855, 0.217]} castShadow rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.04, 0.145, 4]} />
        <meshStandardMaterial color="#9caea4" roughness={0.8} />
      </mesh>
      <group ref={head} position={[0, 1.365, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.354, 32, 24]} />
          <meshStandardMaterial color="#f2d1b9" roughness={0.96} />
        </mesh>
        {/* Short haircut with a single playful quiff; no anime spikes. */}
        <mesh position={[0, 0.16, -0.065]} castShadow>
          <sphereGeometry args={[0.357, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          <meshStandardMaterial color="#343e3b" roughness={0.94} />
        </mesh>
        <mesh position={[-0.12, 0.28, 0.12]} rotation={[0, 0, -0.42]} scale={[1, 0.48, 0.83]} castShadow>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color="#343e3b" roughness={0.94} />
        </mesh>
        <mesh position={[0.13, 0.3, 0.08]} rotation={[0, 0, 0.22]} scale={[1, 0.6, 1]} castShadow>
          <sphereGeometry args={[0.15, 16, 12]} />
          <meshStandardMaterial color="#38413e" roughness={0.94} />
        </mesh>
        {[-0.142, 0.142].map((x, i) => (
          <group key={x}>
            <mesh ref={(node) => { eyes.current[i] = node }} position={[x, 0.026, 0.327]}>
              <sphereGeometry args={[0.031, 14, 10]} />
              <meshStandardMaterial color="#303836" roughness={0.28} />
            </mesh>
            <mesh position={[x - 0.008, 0.041, 0.354]}>
              <sphereGeometry args={[0.008, 10, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh ref={(node) => { cheeks.current[i] = node }} position={[x * 1.55, -0.075, 0.27]} scale={[1.45, 0.72, 1]}>
              <sphereGeometry args={[0.04, 12, 10]} />
              <meshBasicMaterial color="#d88e8c" transparent opacity={0.38} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.116, 0.343]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.032, 0.007, 8, 16, Math.PI]} />
          <meshStandardMaterial color="#9c6765" roughness={0.95} />
        </mesh>
        <mesh position={[0, -0.037, 0.356]}>
          <sphereGeometry args={[0.013, 10, 8]} />
          <meshStandardMaterial color="#e4af98" />
        </mesh>
      </group>
      {[-0.26, 0.26].map((x, index) => (
        <group key={x} position={[x, 0.94, 0]} ref={index === 0 ? leftArm : rightArm}>
          <mesh castShadow position={[0, -0.18, 0]}>
            <capsuleGeometry args={[0.079, 0.2, 7, 14]} />
            <meshStandardMaterial color="#697b77" roughness={0.96} />
          </mesh>
          <mesh castShadow position={[0, -0.36, 0]}>
            <sphereGeometry args={[0.079, 14, 12]} />
            <meshStandardMaterial color="#f2d1b9" roughness={0.93} />
          </mesh>
          {index === 1 && (
            <group ref={phone} position={[0.012, -0.43, 0.10]} rotation={[-0.38, 0, 0.17]} visible={false}>
              <mesh castShadow>
                <boxGeometry args={[0.15, 0.255, 0.02]} />
                <meshStandardMaterial color="#515e5b" roughness={0.45} />
              </mesh>
              <mesh position={[0, 0, 0.012]}>
                <planeGeometry args={[0.125, 0.219]} />
                <meshBasicMaterial color="#b7d6c4" />
              </mesh>
              <mesh position={[0, 0.069, 0.015]}>
                <planeGeometry args={[0.086, 0.018]} />
                <meshBasicMaterial color="#eef7ee" />
              </mesh>
            </group>
          )}
        </group>
      ))}
      {[-0.126, 0.126].map((x, index) => (
        <group key={x} ref={index === 0 ? leftLeg : rightLeg} position={[x, 0.52, 0]}>
          <mesh castShadow position={[0, -0.175, 0]}>
            <capsuleGeometry args={[0.094, 0.22, 8, 14]} />
            <meshStandardMaterial color="#515d58" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.38, 0.075]}>
            <boxGeometry args={[0.2, 0.11, 0.28]} />
            <meshStandardMaterial color="#f4f2eb" roughness={0.82} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function OfficeScene({ run, phase, onProgress, onComplete, onMoodChange }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [0.15, 2.65, 8.7], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={1.5} />
      <hemisphereLight intensity={1.1} color="#fffef8" groundColor="#ebe8de" />
      <directionalLight position={[-3, 7, 6]} intensity={2.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0006} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.055, 0]}>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial color="#a4a29b" transparent opacity={0.15} />
      </mesh>
      <Workspace />
      <OfficePerson run={run} onProgress={onProgress} onComplete={onComplete} onMoodChange={onMoodChange} />
      <EnterButton visible={phase === 'revealing' || phase === 'tapping' || phase === 'entering'} pressed={phase === 'entering'} />
    </Canvas>
  )
}

function Logo() {
  return (
    <div className="mow-brand">
      <span className="mow-orbit" aria-hidden="true"><span /></span>
      <span>Proxi<span>Speak</span></span>
    </div>
  )
}

function validate({ name, email, password, confirm }, mode) {
  if (mode === 'signup' && name.trim().length < 2) return 'Please enter your full name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.'
  if (password.length < 8) return 'Password must contain at least 8 characters.'
  if (mode === 'signup' && password !== confirm) return 'Passwords do not match.'
  return ''
}

export default function MiniOfficeWelcome({ onEnter = () => window.location.assign('/') }) {
  const [mode, setMode] = useState('signup')
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState('idle')
  const [mood, setMood] = useState('typing')
  const busy = run > 0 || saving

  const onProgress = useCallback((next) => setPhase(next), [])
  const onMoodChange = useCallback((next) => setMood(next), [])
  const onComplete = useCallback(() => onEnter(), [onEnter])

  function setValue(field, value) {
    setValues((previous) => ({ ...previous, [field]: value }))
    if (error) setError('')
    if (notice) setNotice('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const issue = validate(values, mode)
    if (issue) {
      setError(issue)
      return
    }
    if (mode === 'login') {
      setNotice('')
      setError('Sign in is not available yet. The backend login and session endpoints are still being built.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      await signupApi.signup({
        displayName: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      })
      // Signup creates an account but does NOT authenticate or create a session.
      setValues((previous) => ({ ...previous, password: '', confirm: '' }))
      setMode('login')
      setNotice('Account created successfully! Sign-in will be enabled when the backend login API is ready.')
    } catch (error) {
      setError(error?.message || 'Unable to create account. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mow-root">
      <header className="mow-topline">
        <Logo />
        <span className="mow-tagline">Work, naturally together.</span>
      </header>
      <div className="mow-layout">
        <section className="mow-scene-section" aria-label="A miniature office with a single working character">
          <div className="mow-scene-heading">
            <div className="mow-eyebrow"><span className="mow-dot" /> YOUR SMALL CORNER OF THE INTERNET</div>
            <h1>A more human<br />way to <em>work together.</em></h1>
            <p>One desk. One little teammate. Your next workspace is only a step away.</p>
          </div>
          <div className="mow-canvas-shell">
            <OfficeScene run={run} phase={phase} onProgress={onProgress} onComplete={onComplete} onMoodChange={onMoodChange} />
            <div className="mow-mood-pill" aria-live="polite">
              <span className="mow-mood-indicator" />
              {phase === 'idle'
                ? ({ typing: 'Working on something lovely', phone: 'A little phone break', stretch: 'Stretching between tasks', wave: 'A friendly hello!' }[mood] || 'Working on something lovely')
                : ({ jump: 'All done — a tiny jump!', walking: 'Walking over to welcome you', revealing: 'The magic button appears', tapping: 'One tiny tap...', entering: 'Entering the virtual office!' }[phase] || 'Almost there...')}
            </div>
            <div className="mow-scene-subtitle">One little teammate. One big welcome.</div>
          </div>
        </section>
        <section className="mow-signup-area" aria-label="Welcome to ProxiSpeak">
          <div className="mow-form-card">
            <div className="mow-card-caption">WELCOME TO PROXISPEAK</div>
            <h2>{mode === 'signup' ? 'Create your space.' : 'Welcome back.'}</h2>
            <p className="mow-card-subtitle">{mode === 'signup' ? 'A simple beginning to better team conversations.' : 'Your teammates are one small step away.'}</p>
            <div className="mow-segments" aria-label="Account screen">
              <button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => { if (!busy) { setMode('signup'); setError(''); setNotice('') } }} disabled={busy}>Sign up</button>
              <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => { if (!busy) { setMode('login'); setError(''); setNotice('') } }} disabled={busy}>Sign in</button>
            </div>
            <form className="mow-form" onSubmit={submit} noValidate>
              {mode === 'signup' && (
                <label className="mow-field"><span>Full name</span>
                  <input autoComplete="name" type="text" value={values.name} disabled={busy} placeholder="Alex Morgan" onChange={(e) => setValue('name', e.target.value)} />
                </label>
              )}
              <label className="mow-field"><span>Email address</span>
                <input autoComplete="email" type="email" value={values.email} disabled={busy} placeholder="alex@company.com" onChange={(e) => setValue('email', e.target.value)} />
              </label>
              <label className="mow-field"><span>Password</span>
                <span className="mow-password-wrap">
                  <input autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} value={values.password} disabled={busy} placeholder="At least 8 characters" onChange={(e) => setValue('password', e.target.value)} />
                  <button className="mow-show" type="button" onClick={() => setShowPassword((value) => !value)} disabled={busy} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
                </span>
              </label>
              {mode === 'signup' && (
                <label className="mow-field"><span>Confirm password</span>
                  <input autoComplete="new-password" type={showPassword ? 'text' : 'password'} value={values.confirm} disabled={busy} placeholder="Repeat your password" onChange={(e) => setValue('confirm', e.target.value)} />
                </label>
              )}
              {error && <div className="mow-error" role="alert">{error}</div>}
              {notice && <div className="mow-success" role="status">{notice}</div>}
              <button type="submit" className="mow-submit" disabled={busy}>
                <span>{busy ? 'Creating your account...' : mode === 'signup' ? 'Create account' : 'Sign in'}</span>
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <p className="mow-preview-note"><span className="mow-status-dot" /> Account creation uses the backend API. Sign-in and sessions are not enabled yet.</p>
          </div>
          <div className="mow-bottom-caption">Made for teams that feel closer, even from afar.</div>
        </section>
      </div>
    </main>
  )
}
