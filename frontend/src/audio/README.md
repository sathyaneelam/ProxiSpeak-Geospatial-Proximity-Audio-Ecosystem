# ProxiSpeak — WebRTC, Real-Time Audio & Spatial Audio Subsystem

**Author:** Member 4 (WebRTC & Spatial Audio Lead)  
**Target Feature Branch:** `feat/proxispeak-webrtc-audio`  
**Package:** `frontend/src/audio/`

---

## 1. Subsystem Architecture

The ProxiSpeak spatial audio engine combines **WebRTC P2P mesh audio streaming** with the **Web Audio API** to deliver smooth, distance-attenuated, stereo-panned proximity audio within a 2D virtual office canvas.

```
                     +-----------------------------------+
                     |       Local Microphone Input       |
                     |     (navigator.mediaDevices)      |
                     +-----------------+-----------------+
                                       |
                                       v
                     +-----------------------------------+
                     |       MediaStreamManager          |
                     |  (Permissions, Mute/Unmute, Error) |
                     +-----------------+-----------------+
                                       |
                  Local Audio Track    |
                                       v
+------------------------+   +-------------------+   +------------------------+
|  Signaling Transport   |<--| WebRTCPeerManager |-->|   Remote Peer Audio    |
| (Socket.io / Broadcast)|   | (Deduplication &  |   |     (MediaStream)      |
+------------------------+   |  Glere Resolution)|   +-----------+------------+
                                                             |
                                                             v
                                             +-------------------------------+
                                             |      SpatialAudioGraph        |
                                             |                               |
                                             |   MediaStreamAudioSourceNode  |
                                             |               |               |
                                             |               v               |
                                             |     GainNode (Distance Attn)  |
                                             |               |               |
                                             |               v               |
                                             |  StereoPannerNode (L/R Pan)   |
                                             |               |               |
                                             |               v               |
                                             |    AudioContext.destination   |
                                             +-------------------------------+
```

---

## 2. File Directory Map

| File Path | Description |
|---|---|
| [`src/audio/spatialAudioMath.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/spatialAudioMath.js) | Pure math functions: Euclidean distance, smoothstep gain curve, stereo pan calculation, radius bounds. |
| [`src/audio/mediaStreamManager.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/mediaStreamManager.js) | Microphone acquisition, permission-denial handling, device error translation, hardware release. |
| [`src/audio/SpatialAudioGraph.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/SpatialAudioGraph.js) | Web Audio API node graph (`GainNode` + `StereoPannerNode`), click-prevention parameter ramps (`setTargetAtTime`), AudioContext autoplay unlock. |
| [`src/audio/signalingContract.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/signalingContract.js) | Formal signaling event constants, payload builders, and validators for coordination with Member 2. |
| [`src/audio/signalingAdapter.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/signalingAdapter.js) | Abstract adapter layer supporting both `SocketIOSignalingTransport` (production backend) and `BroadcastSignalingTransport` (zero-config local 2-tab testing). |
| [`src/audio/webrtcPeerManager.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/webrtcPeerManager.js) | Peer connection lifecycle: deduplication, W3C Perfect Negotiation (polite/impolite glare handling), early ICE candidate buffering, clean teardown. |
| [`src/audio/useProximityAudio.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/useProximityAudio.js) | Orchestration React hook integrating spatial calculations, media capture, peer states, and test tone synthesis. |
| [`src/audio/index.js`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/index.js) | Central barrel export file for the audio subsystem. |
| [`src/audio/__tests__/*`](file:///c:/Users/Neelam%20Shravani/Downloads/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem-zaid-frontend/frontend/src/audio/__tests__) | Focused unit tests for math, media manager, signaling contract, and WebRTC peer deduplication. |

---

## 3. Signaling Event Contracts (Coordination with Member 2)

All signaling messages travel over Socket.IO (or local Broadcast transport) while actual media streams flow directly peer-to-peer over WebRTC.

### Event Names & Payloads

#### 1. Voice Join (`voice:join` / `voice:user-joined`)
Client signals presence in the room:
```json
{
  "userId": "user_player",
  "officeId": "floor_01",
  "position": { "x": 500, "y": 300 }
}
```

#### 2. Position Update (`proximity:position-update`)
Emitted on avatar movement:
```json
{
  "userId": "user_player",
  "officeId": "floor_01",
  "position": { "x": 512, "y": 304 }
}
```

#### 3. WebRTC Offer (`webrtc:offer`)
Sent to a specific target peer when entering earshot:
```json
{
  "fromUserId": "user_player",
  "toUserId": "Alex",
  "officeId": "floor_01",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\no=- 42... IN IP4 127.0.0.1\r\n..."
  },
  "timestamp": 1728835000000
}
```

#### 4. WebRTC Answer (`webrtc:answer`)
Response from recipient peer:
```json
{
  "fromUserId": "Alex",
  "toUserId": "user_player",
  "officeId": "floor_01",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\no=- 43... IN IP4 127.0.0.1\r\n..."
  },
  "timestamp": 1728835000100
}
```

#### 5. ICE Candidate (`webrtc:ice-candidate`)
Network traversal candidates:
```json
{
  "fromUserId": "user_player",
  "toUserId": "Alex",
  "officeId": "floor_01",
  "candidate": {
    "candidate": "candidate:1 1 UDP 2130706431 192.168.1.5 54232 typ host",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  },
  "timestamp": 1728835000150
}
```

#### 6. Voice Leave (`voice:leave` / `voice:user-left`)
```json
{
  "userId": "user_player",
  "officeId": "floor_01"
}
```

---

## 4. Proximity & Spatial Audio Mathematics

### 1. Distance Calculation
For local position $(x_1, y_1)$ and remote peer $(x_2, y_2)$:
$$d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$

### 2. Earshot Radius
Configurable default: $r = 100\text{ px}$.
- If $d \le r$: Peer is within earshot; WebRTC connection is negotiated and audio is audible.
- If $d > r$: Peer is out of range; audio gain attenuates to $0.0$, and connection is suspended or released.

### 3. Smoothstep Distance Attenuation
To prevent abrupt cutoffs and clicking artifacts when crossing the perimeter:
$$t = \text{clamp}\left(\frac{d}{r}, 0, 1\right)$$
$$\text{gain}(t) = 1 - (3t^2 - 2t^3)$$
At $t=0$ (overlapping): $\text{gain} = 1.0$, derivative $= 0$.  
At $t=0.5$ ($50\text{ px}$): $\text{gain} = 0.50$.  
At $t=1$ ($100\text{ px}$): $\text{gain} = 0.0$, derivative $= 0$.

### 4. Stereo Panning
$$\Delta x = x_{\text{peer}} - x_{\text{local}}$$
$$\text{pan} = \text{clamp}\left(\frac{\Delta x}{r}, -1.0, 1.0\right)$$
- $\text{pan} = -1.0$: Full left channel (peer is $100\text{ px}$ to the left).
- $\text{pan} = 0.0$: Center (peer is directly above or below).
- $\text{pan} = +1.0$: Full right channel (peer is $100\text{ px}$ to the right).

Audio parameters are scheduled using `setTargetAtTime(target, currentTime, 0.05)` to guarantee zero pops or clicks during movement.

---

## 5. Security & Resource Lifecycle

- **No Secrets on Client:** No API keys or credentials embedded in frontend code.
- **Microphone On-Demand:** Microphone tracks are requested only when the user explicitly clicks "Connect Spatial Voice".
- **Hardware Cleanup:** On unmount, mute, or disconnect:
  - All `MediaStreamTrack` objects are explicitly stopped (`track.stop()`), turning off hardware indicator lights.
  - All `RTCPeerConnection` instances are closed and listeners removed.
  - Web Audio nodes (`MediaStreamSourceNode`, `GainNode`, `StereoPannerNode`) are disconnected.
  - `AudioContext` is closed.
- **HTTPS / Localhost Requirement:** Browsers require a secure context (`window.isSecureContext` — HTTPS or `http://localhost`) to access `navigator.mediaDevices.getUserMedia`.

---

## 6. Manual Testing Procedures

### A. Solo Developer Test (Synthetic Spatial Tone)
1. Start the dev server: `npm run dev` in `frontend/`.
2. Open `http://localhost:5173`.
3. In the **Spatial Audio Engine** card, click **♫ Test Spatial Audio (Alex)**.
4. Put on stereo headphones.
5. Move the avatar with **W, A, S, D** or **Arrow Keys**:
   - Walk toward Alex at $(310, 150)$ until distance $\le 100\text{ px}$.
   - Notice the connection beam and earshot ring appear.
   - Walk to the left of Alex: sound shifts to your **right ear** ($\Delta x > 0$).
   - Walk to the right of Alex: sound shifts to your **left ear** ($\Delta x < 0$).
   - Walk away from Alex: sound smoothly fades to silent without clicks.

### B. Two-Browser / Multi-Tab WebRTC Test
1. Open two browser windows side-by-side at `http://localhost:5173`.
2. Window 1: Click **🎙️ Connect Spatial Voice**, grant microphone access.
3. Window 2: Click **🎙️ Connect Spatial Voice**, grant microphone access.
4. Using WASD, navigate Window 1's avatar near Window 2's avatar.
5. As avatars enter within 100px:
   - WebRTC P2P peer connection is established.
   - Live speaking from Window 1 is heard in Window 2.
   - Moving Window 1 further away attenuates volume smoothly.
   - Moving Window 1 left/right shifts the audio pan in Window 2's headphones.
6. Click **Mute Microphone** in Window 1: verify remote audio stops.
7. Click **Disconnect**: verify tracks and connections are torn down cleanly.

---

## 7. Verification Commands & Results

All checks have been executed and verified locally:

```bash
# 1. Run Unit Tests (21 passing)
npm test

# 2. Run ESLint (0 errors, 0 warnings)
npm run lint

# 3. Production Vite Build (0 errors, 501ms)
npm run build
```
