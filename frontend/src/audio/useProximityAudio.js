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

export function useProximityAudio({
  userId = 'user_local',
  officeId = 'office_main',
  localPosition = { x: 500, y: 300 },
  peers = [],
  earshotRadius = DEFAULT_EARSHOT_RADIUS,
  signalingUrl = 'http://localhost:3000',
  preferredTransport = 'broadcast', // 'broadcast' for local zero-config 2-tab demo, or 'socketio'
}) {
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
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

  // Initialize managers on mount and cleanup on unmount
  useEffect(() => {
    mediaManagerRef.current = new MediaStreamManager();
    spatialGraphRef.current = new SpatialAudioGraph();

    return () => {
      if (toneOscillatorRef.current) {
        try {
          toneOscillatorRef.current.stop();
          toneOscillatorRef.current.disconnect();
        } catch {
          // Ignore
        }
      }
      mediaManagerRef.current?.stopStream();
      spatialGraphRef.current?.destroy();
      peerManagerRef.current?.destroy();
      signalingRef.current?.disconnect();
    };
  }, []);

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
          spatialGraphRef.current.addPeerStream(peerId, stream, peerPos, localPosition, earshotRadius);
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
  const startAudio = useCallback(async () => {
    setAudioError(null);
    setAudioState('requesting');

    try {
      // 1. Resume AudioContext on user gesture
      const ctxState = await spatialGraphRef.current.resumeContext();
      setAudioContextReady(ctxState === 'running');

      // 2. Acquire microphone
      const stream = await mediaManagerRef.current.acquireAudioStream();

      // 3. Initialize signaling if not ready
      if (!signalingRef.current || !peerManagerRef.current) {
        await initNetworking(stream);
      } else {
        peerManagerRef.current.setLocalStream(stream);
      }

      setIsAudioActive(true);
      setIsMuted(false);
      setAudioState('connected');
    } catch (err) {
      mediaManagerRef.current?.stopStream();
      setAudioError(err.message || 'Failed to initialize audio.');
      setAudioState('error');
      setIsAudioActive(false);
    }
  }, [initNetworking]);

  /**
   * Stops audio and tears down peer connections
   */
  const stopAudio = useCallback(() => {
    mediaManagerRef.current.stopStream();
    peerManagerRef.current?.destroy();
    spatialGraphRef.current?.destroy();
    signalingRef.current?.disconnect();

    peerManagerRef.current = null;
    spatialGraphRef.current = new SpatialAudioGraph();
    signalingRef.current = null;

    if (toneOscillatorRef.current) {
      try {
        toneOscillatorRef.current.stop();
        toneOscillatorRef.current.disconnect();
      } catch {
        // Ignore
      }
      toneOscillatorRef.current = null;
      setIsToneSimulationActive(false);
    }

    setIsAudioActive(false);
    setIsMuted(false);
    setAudioContextReady(false);
    setAudioState('idle');
    setPeerMetrics({});
  }, []);

  /**
   * Mute / Unmute local microphone
   */
  const toggleMute = useCallback(() => {
    if (!mediaManagerRef.current) return;
    const nextMuted = mediaManagerRef.current.toggleMute();
    setIsMuted(nextMuted);
  }, []);

  /**
   * Built-in Spatial Audio Demo Tone:
   * Plays a pleasant spatial test tone from an avatar (e.g. Alex) so a solo developer
   * can test spatial stereo panning and smooth distance attenuation immediately.
   */
  const toggleToneSimulation = useCallback(async (targetPeer = peers[0]) => {
    if (!targetPeer) return;

    if (isToneSimulationActive && toneOscillatorRef.current) {
      try {
        toneOscillatorRef.current.stop();
        toneOscillatorRef.current.disconnect();
      } catch {
        // Ignore
      }
      toneOscillatorRef.current = null;
      setIsToneSimulationActive(false);
      spatialGraphRef.current.removePeer(`sim_${targetPeer.name || 'peer'}`);
      return;
    }

    try {
      await spatialGraphRef.current.resumeContext();
      setAudioContextReady(true);

      const ctx = spatialGraphRef.current.getAudioContext();

      // Create a pleasant synthetic voice drone (soft pentatonic warm chime)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(329.63, ctx.currentTime); // Note E4
      oscGain.gain.setValueAtTime(0.25, ctx.currentTime);

      osc.connect(oscGain);

      // Create destination stream from oscillator to route through spatial graph
      const dest = ctx.createMediaStreamDestination();
      oscGain.connect(dest);

      const simPeerId = `sim_${targetPeer.name || 'peer'}`;
      spatialGraphRef.current.addPeerStream(
        simPeerId,
        dest.stream,
        { x: targetPeer.x, y: targetPeer.y },
        localPosition,
        earshotRadius
      );

      osc.start();
      toneOscillatorRef.current = osc;
      setIsToneSimulationActive(true);
    } catch (err) {
      console.error('Tone simulation failed:', err);
    }
  }, [isToneSimulationActive, peers, localPosition, earshotRadius]);

  /**
   * Proximity evaluation and spatial parameter update loop
   */
  useEffect(() => {
    if (!localPosition) return;

    peerManagerRef.current?.setLocalPosition(localPosition, earshotRadius);

    // Send position update to peers if signaling is connected
    signalingRef.current?.updatePosition(localPosition);

    const nextMetrics = {};

    peers.forEach((peer) => {
      const peerId = peer.id || peer.name;
      const distance = computeDistance(localPosition.x, localPosition.y, peer.x, peer.y);
      const isNearby = distance <= earshotRadius;
      const gain = computeSpatialGain(distance, earshotRadius);
      const pan = computeStereoPan(localPosition.x, peer.x, earshotRadius);

      peerManagerRef.current?.updatePeerPosition(peerId, {
        x: peer.x,
        y: peer.y,
      });

      // Update spatial graph if peer has active stream
      spatialGraphRef.current?.updatePeerSpatial(
        peerId,
        { x: peer.x, y: peer.y },
        localPosition,
        earshotRadius
      );

      // Also update tone simulation if active
      if (isToneSimulationActive && toneOscillatorRef.current) {
        spatialGraphRef.current?.updatePeerSpatial(
          `sim_${peerId}`,
          { x: peer.x, y: peer.y },
          localPosition,
          earshotRadius
        );
      }

      // Proximity Connection Policy:
      // When peer enters earshot and audio is active: initiate WebRTC negotiation
      if (isAudioActive && peerManagerRef.current) {
        if (isNearby) {
          const session = peerManagerRef.current.getOrCreatePeer(peerId);
          if (session?.pc.connectionState === 'new' && session.pc.signalingState === 'stable') {
            void peerManagerRef.current.initiateConnection(peerId);
          }
        } else {
          // Out of earshot: gain is 0.0. Suspend or close connection according to policy
          // If disconnected/closed, release peer
          if (peerManagerRef.current.peers.has(peerId) && distance > earshotRadius * 1.5) {
            peerManagerRef.current.closePeer(peerId);
          }
        }
      }

      nextMetrics[peerId] = {
        distance: Math.round(distance),
        isNearby,
        gain: Math.round(gain * 100), // Percent (0% to 100%)
        pan: pan, // -1.0 to +1.0
        connectionState: peerManagerRef.current?.peers.get(peerId)?.pc?.connectionState || 'idle',
      };
    });

    setPeerMetrics(nextMetrics);
  }, [localPosition, peers, earshotRadius, isAudioActive, isToneSimulationActive]);

  return {
    isAudioActive,
    isMuted,
    audioState,
    audioError,
    audioContextReady,
    peerMetrics,
    isToneSimulationActive,
    startAudio,
    stopAudio,
    toggleMute,
    toggleToneSimulation,
  };
}
