# ProxiSpeak – Geospatial Proximity Audio Frontend

> **Frontend Architecture:** React 19, HTML5 Canvas 2D Office, Socket.io Client, WebRTC Audio Engine, Web Audio API Spatialization.  
> **Audio Engineering (Member 4):** Real-Time WebRTC Audio, 100px Earshot Proximity, Distance Gain Attenuation, Stereo Panning.

---

## Getting Started

### Installation
```bash
cd frontend
npm install
```

### Development Server
```bash
npm run dev
# Starts local development server on http://localhost:5173
```

### Running Automated Tests
```bash
npm test
# Runs 45 automated unit and integration tests (spatial audio, WebRTC manager, signaling adapter, device manager)
```

### Linting & Production Build
```bash
npm run lint
npm run build
```

---

## Audio Engine Documentation
For complete architecture diagrams, WebRTC signaling event contracts, Web Audio graphs, and manual two-browser testing steps, see [`frontend/src/audio/README.md`](./src/audio/README.md).
