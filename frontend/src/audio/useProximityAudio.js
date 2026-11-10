/**
 * ProxiSpeak useProximityAudio React Hook
 * 
 * Orchestrates microphone capture, WebRTC peer connections,
 * spatial Web Audio graph, and real-time proximity attenuation.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_EARSHOT_RADIUS, computeDistance, computeSpatialGain, computeStereoPan } from './spatialAudioMath.js';
import { MediaStreamManager } from './mediaStreamManager.js';
import { SpatialAudioGraph } from './SpatialAudioGraph.js';
import { WebRTCPeerManager } from './webrtcPeerManager.js';
import { SocketIOSignalingTransport, BroadcastSignalingTransport } from './signalingAdapter.js';

const getToneSimulationPeerId = (peer) =>
  `sim_${peer.id || peer.name || 'peer'}`;

export function useProximityAudio({
  userId = 'user_local',
  officeId = 'office_main',
  localPosition = { x: 500, y: 300 },
  peers = [],
  obstacles = [],
  earshotRadius = DEFAULT_EARSHOT_RADIUS,
  signalingUrl = 'http://localhost:3000',
  preferredTransport = 'broadcast', // 'broadcast' for local zero-config 2-tab demo, or 'socketio'
}) {
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [audioState, setAudioState] = useState('idle'); // 'idle' | 'requesting' | 'connected' | 'error'
  const [audioError, setAudioError] = useState(null);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [peerMetrics, setPeerMetrics] = useState({});
  const [isToneSimulationActive, setIsToneSimulationActive] = useState(false);

  const mediaManagerRef = useRef(null);
  const spatialGraphRef = useRef(null);
  const peerManagerRef = useRef(null);
  const signalingRef = useRef(null);
  const toneOscillatorRef = useRef(null);
  const toneSimulationPeerIdRef = useRef(null);
  const toneSimulationRequestRef = useRef(0);
  const audioStartPromiseRef = useRef(null);
  const audioLifecycleRef = useRef(0);
  const audioActiveRef = useRef(false);
  const localPositionRef = useRef(localPosition);
  const earshotRadiusRef = useRef(earshotRadius);
  const obstaclesRef = useRef(obstacles);
  const peerSpatialMetricsRef = useRef(new Map());

  const stopToneSimulation = useCallback(() => {
    toneSimulationRequestRef.current += 1;

    if (toneOscillatorRef.current) {
      try {
        toneOscillatorRef.current.stop();
        toneOscillatorRef.current.disconnect();
      } catch {
        // Ignore
      }
      toneOscillatorRef.current = null;
    }

    if (toneSimulationPeerIdRef.current) {
      spatialGraphRef.current?.removePeer(toneSimulationPeerIdRef.current);
      toneSimulationPeerIdRef.current = null;
    }

    setIsToneSimulationActive(false);
  }, []);

  // Initialize managers on mount and cleanup on unmount
  useEffect(() => {
    mediaManagerRef.current = new MediaStreamManager();
    spatialGraphRef.current = new SpatialAudioGraph();

    return () => {
      audioLifecycleRef.current += 1;
      audioActiveRef.current = false;
      stopToneSimulation();
      mediaManagerRef.current?.stopStream();
      spatialGraphRef.current?.destroy();
      peerManagerRef.current?.destroy();
      signalingRef.current?.disconnect();
    };
  }, [stopToneSimulation]);

  /**
   * Initializes signaling and WebRTC managers
   */
  const initNetworking = useCallback(async (localStream) => {
    try {
      let transport;
      if (preferredTransport === 'socketio') {
        transport = new SocketIOSignalingTransport(signalingUrl);
      } else {
        transport = new BroadcastSignalingTransport('proxispeak_signaling_room');
      }

      const peerManager = new WebRTCPeerManager({
        localUserId: userId,
        officeId,
        signalingTransport: transport,
        localPosition,
        earshotRadius,
        onRemoteStream: (peerId, stream) => {
          const peer = peers.find((p) => p.id === peerId || p.name === peerId);
          const peerPos =
            peerManagerRef.current?.getPeerPosition(peerId) ||
            (peer ? { x: peer.x, y: peer.y } : { x: 0, y: 0 });
          spatialGraphRef.current?.addPeerStream(
            peerId,
            stream,
            peerPos,
            localPositionRef.current,
            earshotRadiusRef.current,
            obstaclesRef.current
          );
        },
        onPeerPosition: (peerId, position) => {
          spatialGraphRef.current?.updatePeerSpatial(
            peerId,
            position,
            localPositionRef.current,
            earshotRadiusRef.current,
            obstaclesRef.current
          );
        },
        onPeerConnectionState: (peerId, state) => {
          setPeerMetrics((prev) => ({
            ...prev,
            [peerId]: {
              ...(prev[peerId] || {}),
              connectionState: state,
            },
          }));
        },
        onPeerRemoved: (peerId) => {
          spatialGraphRef.current.removePeer(peerId);
          setPeerMetrics((prev) => {
            const copy = { ...prev };
            delete copy[peerId];
            return copy;
          });
        },
      });

      peerManager.setLocalStream(localStream);
      signalingRef.current = transport;
      peerManagerRef.current = peerManager;

      await transport.connect({
        userId,
        officeId,
        position: localPosition,
      });
    } catch (err) {
      peerManagerRef.current?.destroy();
      signalingRef.current?.disconnect();
      peerManagerRef.current = null;
      signalingRef.current = null;
      throw err;
    }
  }, [userId, officeId, localPosition, peers, earshotRadius, signalingUrl, preferredTransport]);

  /**
   * Starts microphone capture and unlocks AudioContext (user gesture required)
   */
  const startAudio = useCallback(() => {
    if (audioStartPromiseRef.current) return audioStartPromiseRef.current;
    if (audioActiveRef.current) return Promise.resolve();

    const requestId = ++audioLifecycleRef.current;
    setAudioError(null);
    setAudioState('requesting');

    const startPromise = Promise.resolve().then(async () => {
      try {
        // 1. Resume AudioContext on user gesture
        const ctxState = await spatialGraphRef.current.resumeContext();
        if (requestId !== audioLifecycleRef.current) return;
        setAudioContextReady(ctxState === 'running');

        // 2. Acquire microphone
        const stream = await mediaManagerRef.current.acquireAudioStream();
        if (requestId !== audioLifecycleRef.current) {
          mediaManagerRef.current?.stopStream();
          return;
        }

        // 3. Initialize signaling if not ready
        if (!signalingRef.current || !peerManagerRef.current) {
          await initNetworking(stream);
        } else {
          peerManagerRef.current.setLocalStream(stream);
        }
        if (requestId !== audioLifecycleRef.current) return;

        audioActiveRef.current = true;
        setIsAudioActive(true);
        setIsMuted(false);
        spatialGraphRef.current?.setMuted(false);
        setIsDeafened(false);
        setAudioState('connected');
      } catch (err) {
        if (requestId !== audioLifecycleRef.current) return;
        mediaManagerRef.current?.stopStream();
        setAudioError(err.message || 'Failed to initialize audio.');
        setAudioState('error');
        setIsAudioActive(false);
      } finally {
        if (audioStartPromiseRef.current === startPromise) {
          audioStartPromiseRef.current = null;
        }
      }
    });

    audioStartPromiseRef.current = startPromise;
    return startPromise;
  }, [initNetworking]);

  /**
   * Stops audio and tears down peer connections
   */
  const stopAudio = useCallback(() => {
    audioLifecycleRef.current += 1;
    audioActiveRef.current = false;
    stopToneSimulation();
    mediaManagerRef.current?.stopStream();
    peerManagerRef.current?.destroy();
    spatialGraphRef.current?.destroy();
    signalingRef.current?.disconnect();

    peerManagerRef.current = null;
    spatialGraphRef.current = new SpatialAudioGraph();
    signalingRef.current = null;

    setIsAudioActive(false);
    setIsMuted(false);
    setIsDeafened(false);
    setAudioContextReady(false);
    setAudioState('idle');
    setPeerMetrics({});
  }, [stopToneSimulation]);

  /**
   * Mute / Unmute local microphone
   */
  const toggleMute = useCallback(() => {
    if (!mediaManagerRef.current) return;
    const nextMuted = mediaManagerRef.current.toggleMute();
    setIsMuted(nextMuted);
  }, []);

  /**
   * Mutes or unmutes all incoming participant audio without affecting the microphone.
   */
  const toggleDeafen = useCallback(() => {
    const nextDeafened = !isDeafened;
    spatialGraphRef.current?.setMuted(nextDeafened);
    setIsDeafened(nextDeafened);
  }, [isDeafened]);

  /**
   * Built-in Spatial Audio Demo Tone:
   * Plays a pleasant spatial test tone from an avatar (e.g. Alex) so a solo developer
   * can test spatial stereo panning and smooth distance attenuation immediately.
   */
  const toggleToneSimulation = useCallback(async (targetPeer = peers[0]) => {
    const targetSimulationPeerId = targetPeer
      ? getToneSimulationPeerId(targetPeer)
      : null;

    if (isToneSimulationActive) {
      if (!targetSimulationPeerId || toneSimulationPeerIdRef.current === targetSimulationPeerId) {
        stopToneSimulation();
        return;
      }

      stopToneSimulation();
    }

    if (!targetPeer) return;

    const requestId = ++toneSimulationRequestRef.current;

    try {
      await spatialGraphRef.current.resumeContext();
      if (requestId !== toneSimulationRequestRef.current) return;

      setAudioContextReady(true);

      const ctx = spatialGraphRef.current.getAudioContext();

      // Create a pleasant synthetic voice drone (soft pentatonic warm chime)
      const osc = ctx.createOscillator();
      toneOscillatorRef.current = osc;
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(329.63, ctx.currentTime); // Note E4
      oscGain.gain.setValueAtTime(0.25, ctx.currentTime);

      osc.connect(oscGain);

      // Create destination stream from oscillator to route through spatial graph
      const dest = ctx.createMediaStreamDestination();
      oscGain.connect(dest);

      if (requestId !== toneSimulationRequestRef.current) {
        osc.stop();
        osc.disconnect();
        return;
      }

      const simulationPeerId = getToneSimulationPeerId(targetPeer);
      toneSimulationPeerIdRef.current = simulationPeerId;
      spatialGraphRef.current.addPeerStream(
        simulationPeerId,
        dest.stream,
        { x: targetPeer.x, y: targetPeer.y },
        localPosition,
        earshotRadius
      );

      osc.start();
      setIsToneSimulationActive(true);
    } catch (err) {
      if (requestId === toneSimulationRequestRef.current) {
        stopToneSimulation();
        console.error('Tone simulation failed:', err);
      }
    }
  }, [isToneSimulationActive, peers, localPosition, earshotRadius, stopToneSimulation]);

  /**
   * Proximity evaluation and spatial parameter update loop
   */
  useEffect(() => {
    localPositionRef.current = localPosition;
    earshotRadiusRef.current = earshotRadius;
    obstaclesRef.current = obstacles;
    if (!localPosition) return;

    peerManagerRef.current?.setLocalPosition(localPosition, earshotRadius);

    // Send position update to peers if signaling is connected
    signalingRef.current?.updatePosition(localPosition);

    const nextMetrics = {};
    const activePeerIds = new Set();

    peers.forEach((peer) => {
      const peerId = peer.id || peer.name;
      activePeerIds.add(peerId);
      const cachedMetrics = peerSpatialMetricsRef.current.get(peerId);
      let spatialMetrics = cachedMetrics;

      if (
        !cachedMetrics ||
        cachedMetrics.localX !== localPosition.x ||
        cachedMetrics.localY !== localPosition.y ||
        cachedMetrics.peerX !== peer.x ||
        cachedMetrics.peerY !== peer.y ||
        cachedMetrics.radius !== earshotRadius
      ) {
        const distance = computeDistance(localPosition.x, localPosition.y, peer.x, peer.y);
        spatialMetrics = {
          localX: localPosition.x,
          localY: localPosition.y,
          peerX: peer.x,
          peerY: peer.y,
          radius: earshotRadius,
          distance,
          isNearby: distance <= earshotRadius,
          gain: computeSpatialGain(distance, earshotRadius),
          pan: computeStereoPan(localPosition.x, peer.x, earshotRadius),
        };
        peerSpatialMetricsRef.current.set(peerId, spatialMetrics);
      }

      peerManagerRef.current?.updatePeerPosition(peerId, {
        x: peer.x,
        y: peer.y,
      });

      const simulationPeerId = getToneSimulationPeerId(peer);
      if (
        isToneSimulationActive &&
        toneOscillatorRef.current &&
        toneSimulationPeerIdRef.current === simulationPeerId
      ) {
        spatialGraphRef.current?.updatePeerSpatial(
          simulationPeerId,
          { x: peer.x, y: peer.y },
          localPosition,
          earshotRadius,
          obstacles
        );
      }

      // Proximity Connection Policy:
      // When peer enters earshot and audio is active: initiate WebRTC negotiation
      if (isAudioActive && peerManagerRef.current) {
        if (spatialMetrics.isNearby) {
          const session = peerManagerRef.current.getOrCreatePeer(peerId);
          if (session?.pc.connectionState === 'new' && session.pc.signalingState === 'stable') {
            void peerManagerRef.current.initiateConnection(peerId);
          }
        } else {
          // Out of earshot: gain is 0.0. Suspend or close connection according to policy
          // If disconnected/closed, release peer
          if (peerManagerRef.current.peers.has(peerId) && spatialMetrics.distance > earshotRadius * 1.5) {
            peerManagerRef.current.closePeer(peerId);
          }
        }
      }

      nextMetrics[peerId] = {
        distance: Math.round(spatialMetrics.distance),
        isNearby: spatialMetrics.isNearby,
        gain: Math.round(spatialMetrics.gain * 100), // Percent (0% to 100%)
        pan: spatialMetrics.pan, // -1.0 to +1.0
        connectionState: peerManagerRef.current?.peers.get(peerId)?.pc?.connectionState || 'idle',
      };
    });

    for (const peerId of peerSpatialMetricsRef.current.keys()) {
      if (!activePeerIds.has(peerId)) {
        peerSpatialMetricsRef.current.delete(peerId);
      }
    }

    if (
      isToneSimulationActive &&
      toneOscillatorRef.current &&
      !peers.some((peer) =>
        getToneSimulationPeerId(peer) === toneSimulationPeerIdRef.current
      )
    ) {
      stopToneSimulation();
    }

    setPeerMetrics(nextMetrics);
  }, [localPosition, peers, obstacles, earshotRadius, isAudioActive, isToneSimulationActive, stopToneSimulation]);

  return {
    isAudioActive,
    isMuted,
    isDeafened,
    audioState,
    audioError,
    audioContextReady,
    peerMetrics,
    isToneSimulationActive,
    startAudio,
    stopAudio,
    toggleMute,
    toggleDeafen,
    toggleToneSimulation,
  };
}
