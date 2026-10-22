/**
 * ProxiSpeak Audio Controls Component
 * Provides UI for microphone activation, muting, autoplay unlocking,
 * permission status, and real-time spatial audio meters.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

export function AudioControls({
  isAudioActive,
  isMicMuted,
  audioContextState,
  permissionState,
  audioError,
  activePeers,
  onStartAudio,
  onStopAudio,
  onToggleMute,
  onResumeAudio,
  isConnected,
}) {
  return (
    <div className="audio-engine-panel">
      <div className="audio-engine-header">
        <div className="audio-status-indicator">
          <span
            className={`audio-status-beacon ${
              isAudioActive ? (isMicMuted ? 'muted' : 'active') : 'idle'
            }`}
          />
          <div>
            <strong>
              {isAudioActive
                ? isMicMuted
                  ? 'Microphone Muted'
                  : 'Proximity Voice Active'
                : 'Proximity Voice Inactive'}
            </strong>
            <small>
              {isAudioActive
                ? `${activePeers.length} peer${activePeers.length === 1 ? '' : 's'} in earshot (100px) • Mic: ${permissionState}`
                : isConnected
                ? `Ready to connect (Mic: ${permissionState})`
                : 'Waiting for server connection'}
            </small>
          </div>
        </div>

        <div className="audio-actions">
          {audioContextState === 'suspended' && (
            <button
              type="button"
              className="btn btn-warning"
              onClick={onResumeAudio}
              title="Browser autoplay policy requires user interaction"
            >
              🔊 Unlock Audio
            </button>
          )}

          {isAudioActive && (
            <button
              type="button"
              className={`btn ${isMicMuted ? 'btn-warning' : 'btn-secondary'}`}
              onClick={onToggleMute}
            >
              {isMicMuted ? '🎙️ Unmute Mic' : '🔇 Mute Mic'}
            </button>
          )}

          {!isAudioActive ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onStartAudio}
              disabled={!isConnected}
            >
              🎙️ Join Voice Space
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onStopAudio}
            >
              Disconnect Voice
            </button>
          )}
        </div>
      </div>

      {/* Permission or Hardware Error Banner */}
      {audioError && (
        <div className="audio-error-banner">
          <div className="error-title">⚠️ {audioError.message}</div>
          {audioError.resolution && (
            <div className="error-resolution">{audioError.resolution}</div>
          )}
        </div>
      )}

      {/* Active Earshot Peers Audio Monitoring */}
      {isAudioActive && activePeers.length > 0 && (
        <div className="active-peers-tray">
          <div className="tray-title">PEERS IN EARSHOT RADIUS</div>
          <div className="peers-grid">
            {activePeers.map((peer) => {
              const panDisplay =
                peer.pan === 0
                  ? 'Center'
                  : peer.pan < 0
                  ? `L ${Math.round(Math.abs(peer.pan) * 100)}%`
                  : `R ${Math.round(peer.pan * 100)}%`;

              return (
                <div className="peer-audio-card" key={peer.socketId}>
                  <div className="peer-card-header">
                    <span className="peer-name">{peer.displayName}</span>
                    <span className="peer-badge">{peer.connectionState}</span>
                  </div>

                  <div className="peer-metrics">
                    <div className="metric">
                      <span className="metric-label">Distance:</span>
                      <span className="metric-val">{peer.distance} px</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Volume:</span>
                      <span className="metric-val">{peer.gain}%</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Pan:</span>
                      <span className="metric-val">{panDisplay}</span>
                    </div>
                  </div>

                  <div className="volume-meter-track">
                    <div
                      className="volume-meter-bar"
                      style={{ width: `${peer.gain}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isAudioActive && activePeers.length === 0 && (
        <div className="audio-empty-hint">
          Walk within 100px of another avatar to establish peer-to-peer WebRTC voice.
        </div>
      )}
    </div>
  );
}
