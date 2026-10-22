# ProxiSpeak – WebRTC Real-Time & Spatial Audio Engine

> **Module Responsibility:** Member 4 (Team Leader) — WebRTC Peer Connections, Real-Time Audio Capture, Web Audio API Spatial Graphs, Distance Attenuation, and Stereo Panning.  
> **Working Branch:** `feat/proxispeak-webrtc-audio`

---

## 1. Overview & Architecture

The ProxiSpeak Audio Module establishes browser-to-browser peer-to-peer WebRTC audio streams when avatars enter a 100-pixel earshot radius in the same virtual office. As avatars move closer or farther apart, distance-based gain attenuation adjusts volume smoothly. As avatars move horizontally relative to each other, stereo panning shifts the audio between left and right speakers.

### Spatial Audio Graph (Per Remote Peer)

```
[ Remote Peer MediaStream ]
             │ (WebRTC)
             ▼
┌───────────────────────────┐
│ MediaStreamAudioSourceNode│
└────────────┬──────────────┘
             ▼
┌───────────────────────────┐
│         GainNode          │ ◄── Dynamic distance attenuation: gain = max(0, 1 - d / r)
└────────────┬──────────────┘     Smoothed with setTargetAtTime (50ms time constant)
             ▼
┌───────────────────────────┐
│     StereoPannerNode      │ ◄── Dynamic stereo pan: pan = clamp(Δx / r, -1.0, 1.0)
└────────────┬──────────────┘     Smoothed with setTargetAtTime (50ms time constant)
             ▼
┌───────────────────────────┐
│  AudioContext.destination │ ──► User Speakers / Headphones
└───────────────────────────┘
```

---

## 2. Module File Structure

All audio-specific logic is modularized under `frontend/src/audio/` and encapsulated via React hooks and UI components:

| File Path | Description |
| :--- | :--- |
| `frontend/src/audio/spatialAudio.js` | Pure spatial math: Euclidean distance, distance-gain attenuation curves, stereo horizontal panning, and AudioParam parameter smoothing. |
| `frontend/src/audio/audioContextManager.js` | Manages singleton `AudioContext`, browser autoplay unlock (`resumeAudioContext()`), and Web Audio node creation with fallbacks. |
| `frontend/src/audio/mediaStreamManager.js` | Local microphone capture (`getUserMedia`), mute/unmute control, permission denial/missing hardware error handling, and hardware teardown (`track.stop()`). |
| `frontend/src/audio/peerConnectionManager.js` | Manages `RTCPeerConnection` instances, deduplication (1 PC per peer pair), W3C Perfect Negotiation (polite vs. impolite tie-breaking), ICE exchange, audio track piping, and teardown. |
| `frontend/src/audio/audioSignalingAdapter.js` | Bridges Socket.io transport with `PeerConnectionManager`, dispatching `proximity:enter`, `proximity:leave`, `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`, `webrtc:error`. |
| `frontend/src/hooks/useProximityAudio.js` | React hook exposing audio states (`isAudioActive`, `isMicMuted`, `permissionState`, `activePeers`), control handlers (`startAudio`, `stopAudio`, `toggleMute`, `resumeAudio`), and spatial updates. |
| `frontend/src/components/AudioControls.jsx` | UI component with status beacons, mic mute toggle, autoplay unlock button, error resolution alerts, and real-time peer audio meters (distance, volume %, pan). |
| `frontend/tests/*.test.js` | Automated test suite (45 tests) verifying spatial math, gain curves, stereo pan clamping, peer deduplication, negotiation roles, signaling routing, and teardown. |

---

## 3. Signaling Event Contracts

The audio module strictly conforms to Member 2's backend signaling contracts defined in `ProxiSpeak-Backend/src/sockets/`:

### 3.1 Proximity Transitions (Triggered by 100px Earshot Threshold)
* **`proximity:enter`** (Server $\rightarrow$ Peer Pairs when $d \le 100$px):
  ```json
  {
    "peerSocketId": "socket_xyz123",
    "peerUserId": "user_456",
    "peerDisplayName": "Alice",
    "distance": 65,
    "earshotRadius": 100
  }
  ```
  *Action:* Initiates WebRTC negotiation to establish peer audio.
* **`proximity:leave`** (Server $\rightarrow$ Peer Pairs when $d > 100$px or client disconnects):
  ```json
  {
    "peerSocketId": "socket_xyz123",
    "peerUserId": "user_456",
    "distance": 115,
    "reason": "out_of_range"
  }
  ```
  *Action:* Closes peer connection, disconnects Web Audio pipeline, and cleans up resources.

### 3.2 WebRTC Signaling (Proximity-Gated)
* **`webrtc:offer`** (Bidirectional):
  * Client $\rightarrow$ Server: `{ "to": "target_socket_id", "offer": RTCSessionDescriptionInit }`
  * Server $\rightarrow$ Target: `{ "from": "sender_socket_id", "fromUserId": "user_id", "offer": RTCSessionDescriptionInit }`
* **`webrtc:answer`** (Bidirectional):
  * Client $\rightarrow$ Server: `{ "to": "target_socket_id", "answer": RTCSessionDescriptionInit }`
  * Server $\rightarrow$ Target: `{ "from": "sender_socket_id", "fromUserId": "user_id", "answer": RTCSessionDescriptionInit }`
* **`webrtc:ice-candidate`** (Bidirectional):
  * Client $\rightarrow$ Server: `{ "to": "target_socket_id", "candidate": RTCIceCandidateInit }`
  * Server $\rightarrow$ Target: `{ "from": "sender_socket_id", "fromUserId": "user_id", "candidate": RTCIceCandidateInit }`
* **`webrtc:error`** (Server $\rightarrow$ Sender):
  ```json
  {
    "status": "error",
    "code": "PEER_OUT_OF_RANGE",
    "message": "Target peer is beyond 100px earshot radius.",
    "targetSocketId": "socket_xyz123",
    "distance": 142
  }
  ```
  *Action:* Client tears down any in-flight half-open connection cleanly.

---

## 4. Spatial Math & Attenuation Formulas

1. **2D Euclidean Distance:**
   $$d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$
2. **Distance-Based Gain Attenuation:**
   $$\text{gain}(d) = \begin{cases} 0.0 & \text{if } d \ge r \\ \max\left(0.0, 1.0 - \frac{d}{r}\right) & \text{if } d < r \end{cases}$$
   * *At $d = 0$px:* Gain is $1.0$ (100% volume).
   * *At $d = 50$px:* Gain is $0.5$ (50% volume).
   * *At $d = 100$px:* Gain is $0.0$ (Muted / out of earshot).
3. **Stereo Panning (Horizontal Offset):**
   $$\text{pan} = \text{clamp}\left(\frac{x_{\text{peer}} - x_{\text{listener}}}{r}, -1.0, 1.0\right)$$
   * *$-1.0$:* Full left speaker (peer is $100$px or more to listener's left).
   * *$0.0$:* Center / balanced stereo (peer is horizontally aligned with listener).
   * *$+1.0$:* Full right speaker (peer is $100$px or more to listener's right).
4. **Click Prevention:**
   All `AudioParam` updates (`gainNode.gain`, `pannerNode.pan`) use exponential smoothing:
   ```javascript
   audioParam.setTargetAtTime(targetValue, audioContext.currentTime, 0.05);
   ```

---

## 5. Security & Browser Limitations

* **Secure Context (HTTPS / localhost):** Modern browsers restrict `navigator.mediaDevices.getUserMedia` strictly to Secure Contexts (`https://` or `http://localhost` / `http://127.0.0.1`). If loaded over an insecure IP (e.g. `http://192.168.1.5:5173`), `MediaStreamManager` catches this and displays an actionable alert.
* **Autoplay Restrictions:** Browsers block audio playback until user interaction. The module starts `AudioContext` only upon clicking "Join Voice Space" or "Unlock Audio", monitoring `AudioContext.state` transitions (`suspended` $\rightarrow$ `running`).
* **Privacy & Teardown:** Local microphone tracks are stopped (`track.stop()`) immediately upon unmount or leaving voice. No private keys or tokens are stored in the client.

---

## 6. Manual Two-Browser Testing Procedure

> **Note:** Follow these exact steps to manually test two-browser WebRTC proximity voice:

1. **Start the Backend Server (Member 2):**
   ```bash
   cd ProxiSpeak-Backend
   npm start
   # Server runs on http://localhost:3000
   ```
2. **Start the Frontend Application (Member 3 & 4):**
   ```bash
   cd frontend
   npm run dev
   # App runs on http://localhost:5173
   ```
3. **Open Browser A:**
   * Open `http://localhost:5173` in Google Chrome.
   * Click **"🎙️ Join Voice Space"**.
   * When prompted, click **"Allow"** for microphone access.
   * Verify status beacon turns glowing cyan: *"Proximity Voice Active (0 peers in earshot)"*.
4. **Open Browser B:**
   * Open `http://localhost:5173` in a second browser (or Incognito window).
   * Click **"🎙️ Join Voice Space"** and grant microphone access.
5. **Verify Distance Attenuation & Connection Establishment:**
   * In Browser A, move your avatar towards Browser B's avatar using `W`, `A`, `S`, `D`.
   * When distance becomes $\le 100$px, note:
     * Status indicator updates: *"1 peer in earshot (100px)"*.
     * Active Peer Card appears with distance (e.g., `45 px`), volume meter (e.g., `55%`), and pan meter.
     * Speak into Browser A's microphone $\rightarrow$ audio is heard in Browser B's speakers.
6. **Verify Stereo Panning:**
   * Move Browser A to the **left** of Browser B (within 100px).
   * Verify Browser B hears audio primarily from the **left speaker** (Pan meter displays `L 60%`).
   * Move Browser A to the **right** of Browser B.
   * Verify audio shifts smoothly to the **right speaker** (Pan meter displays `R 60%`).
7. **Verify Out of Range Teardown:**
   * Move Browser A away until distance exceeds $100$px.
   * Verify the peer card disappears, volume drops smoothly to 0 with no clicking, and WebRTC connection is closed.
8. **Verify Mute / Unmute:**
   * Move back into earshot ($\le 100$px).
   * Click **"🔇 Mute Mic"** in Browser A. Beacon turns amber: *"Microphone Muted"*.
   * Verify Browser B hears silence while Browser A speaks.
   * Click **"🎙️ Unmute Mic"** in Browser A $\rightarrow$ audio resumes.
9. **Verify Permission Denial Handling:**
   * In a fresh tab, block microphone permission in the address bar.
   * Click **"🎙️ Join Voice Space"**.
   * Verify error alert appears with code `PERMISSION_DENIED` and actionable instructions.

---

## 7. Automated Test Execution

Run the automated test suite and linter:
```bash
# Run unit & integration tests (45 tests)
npm test

# Run ESLint (0 errors, 0 warnings)
npm run lint

# Production build verification
npm run build
```
