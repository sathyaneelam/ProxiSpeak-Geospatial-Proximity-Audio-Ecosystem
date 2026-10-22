/**
 * ProxiSpeak Proximity Audio React Hook
 * Integrates WebRTC peer connections, local microphone capture,
 * Web Audio API spatial graph, and real-time avatar proximity tracking.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { audioContextManager } from '../audio/audioContextManager.js';
import { mediaStreamManager, AudioDeviceError } from '../audio/mediaStreamManager.js';
import { PeerConnectionManager } from '../audio/peerConnectionManager.js';
import { AudioSignalingAdapter } from '../audio/audioSignalingAdapter.js';
import { DEFAULT_EARSHOT_RADIUS } from '../audio/spatialAudio.js';

export function useProximityAudio({
  socketRef,
  myPosition,
  earshotRadius = DEFAULT_EARSHOT_RADIUS,
}) {
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [audioContextState, setAudioContextState] = useState('uninitialized');
  const [permissionState, setPermissionState] = useState('prompt');
  const [audioError, setAudioError] = useState(null);
  const [activePeers, setActivePeers] = useState([]);

  const peerManagerRef = useRef(null);
  const signalingAdapterRef = useRef(null);
  const latestPositionRef = useRef(myPosition);

  // Keep latestPositionRef updated
  useEffect(() => {
    latestPositionRef.current = myPosition;
  }, [myPosition]);

  // Subscribe to AudioContext state transitions (e.g. suspended -> running)
  useEffect(() => {
    const unsubscribe = audioContextManager.onStateChange((state) => {
      setAudioContextState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  /**
   * Resumes AudioContext on user gesture to comply with browser autoplay policies.
   */
  const resumeAudio = useCallback(async () => {
    const success = await audioContextManager.resumeAudioContext();
    if (success) {
      setAudioContextState(audioContextManager.getState());
    }
    return success;
  }, []);

  /**
   * Starts microphone capture, initializes WebRTC manager, and attaches signaling listeners.
   */
  const startAudio = useCallback(async () => {
    setAudioError(null);

    const socket = socketRef?.current;
    if (!socket) {
      setAudioError(
        new AudioDeviceError(
          'NO_SOCKET_CONNECTION',
          'Socket connection is not available.',
          'Wait until the multiplayer connection is established before joining voice.'
        )
      );
      return false;
    }

    try {
      // 1. Resume AudioContext upon user gesture
      await audioContextManager.resumeAudioContext();
      setAudioContextState(audioContextManager.getState());

      // 2. Request microphone stream
      const stream = await mediaStreamManager.startCapture();
      setPermissionState('granted');
      setIsMicMuted(mediaStreamManager.isMuted);

      // 3. Initialize PeerConnectionManager
      const peerManager = new PeerConnectionManager({
        localSocketId: socket.id || '',
        localUserId: socket.id || '',
        earshotRadius,
        sendOffer: (to, offer) => {
          signalingAdapterRef.current?.sendOffer(to, offer);
        },
        sendAnswer: (to, answer) => {
          signalingAdapterRef.current?.sendAnswer(to, answer);
        },
        sendIceCandidate: (to, candidate) => {
          signalingAdapterRef.current?.sendIceCandidate(to, candidate);
        },
        onPeersUpdated: (peers) => {
          setActivePeers(
            peers.map((p) => ({
              socketId: p.socketId,
              userId: p.userId,
              displayName: p.displayName,
              distance: Math.round(p.distance),
              gain: Number((p.gain * 100).toFixed(1)),
              pan: Number(p.pan.toFixed(2)),
              connectionState: p.connectionState,
            }))
          );
        },
      });

      peerManager.setLocalStream(stream);
      peerManagerRef.current = peerManager;

      // 4. Initialize and attach Signaling Adapter
      const adapter = new AudioSignalingAdapter({
        socket,
        peerConnectionManager: peerManager,
        onError: (err) => {
          console.warn('[useProximityAudio] Signaling warning:', err);
        },
      });
      adapter.attachListeners();
      signalingAdapterRef.current = adapter;

      setIsAudioActive(true);
      return true;
    } catch (err) {
      console.error('[useProximityAudio] Audio initialization failed:', err);
      const isDeviceErr = err instanceof AudioDeviceError;
      setPermissionState(
        isDeviceErr && err.code === 'PERMISSION_DENIED' ? 'denied' : 'error'
      );
      setAudioError(
        isDeviceErr
          ? err
          : new AudioDeviceError('UNKNOWN_ERROR', err?.message || 'Failed to start audio', 'Try reloading the page and checking permissions.', err)
      );
      setIsAudioActive(false);
      return false;
    }
  }, [socketRef, earshotRadius]);

  /**
   * Stops audio capture, closes all peer connections, and cleans up resources.
   */
  const stopAudio = useCallback(() => {
    // 1. Detach signaling listeners
    if (signalingAdapterRef.current) {
      signalingAdapterRef.current.detachListeners();
      signalingAdapterRef.current = null;
    }

    // 2. Teardown all peer connections and Web Audio graphs
    if (peerManagerRef.current) {
      peerManagerRef.current.closeAllPeers();
      peerManagerRef.current = null;
    }

    // 3. Stop local microphone hardware tracks
    mediaStreamManager.stopCapture();

    setIsAudioActive(false);
    setIsMicMuted(false);
    setActivePeers([]);
    setAudioError(null);
  }, []);

  /**
   * Toggles microphone mute state.
   */
  const toggleMute = useCallback(() => {
    const nextMuted = mediaStreamManager.toggleMute();
    setIsMicMuted(nextMuted);
    return nextMuted;
  }, []);

  /**
   * Smoothly updates spatial parameters for all active peers based on current avatar coordinates.
   */
  const updateSpatialPositions = useCallback(
    (remotePlayersMap) => {
      const peerManager = peerManagerRef.current;
      if (!peerManager || !isAudioActive || !latestPositionRef.current) return;

      const myPos = latestPositionRef.current;

      for (const peer of peerManager.getPeersList()) {
        const remotePlayer = remotePlayersMap?.get?.(peer.socketId) ||
          remotePlayersMap?.get?.(peer.userId);

        if (remotePlayer && Number.isFinite(remotePlayer.x) && Number.isFinite(remotePlayer.y)) {
          peerManager.updateSpatialParameters(
            peer.socketId,
            myPos,
            { x: remotePlayer.x, y: remotePlayer.y },
            earshotRadius
          );
        }
      }
    },
    [isAudioActive, earshotRadius]
  );

  // Synchronize identity if socket connects after hook initialization
  useEffect(() => {
    const socket = socketRef?.current;
    if (socket && peerManagerRef.current) {
      peerManagerRef.current.updateLocalIdentity(socket.id, socket.id);
    }
  }, [socketRef]);

  // Teardown everything on unmount
  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  return {
    isAudioActive,
    isMicMuted,
    audioContextState,
    permissionState,
    audioError,
    activePeers,
    startAudio,
    stopAudio,
    toggleMute,
    resumeAudio,
    updateSpatialPositions,
  };
}
