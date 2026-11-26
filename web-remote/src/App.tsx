import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CameraState,
  CaptureMode,
  ConnectionState,
  FlashMode,
  FrameDataMessage,
  LensInfo,
  Response,
  StreamMode,
} from '@shared/protocol';
import { parseSessionIdFromInput } from '@shared/session-link';
import { db, ensureSignedIn } from './lib/firebase';
import { BrowserSignalingClient } from './lib/signaling';
import { BrowserWebRTCClient } from './lib/webrtc';

const DEFAULT_STATE: CameraState = {
  zoom: 1,
  flash: 'off',
  facing: 'back',
  captureMode: 'photo',
  isRecording: false,
};

type IconProps = {
  className?: string;
};

function getStatusText(
  connectionState: ConnectionState,
  streamMode: StreamMode,
  hasPreview: boolean
): string {
  if (connectionState === 'connecting') {
    return 'Connecting to camera…';
  }

  if (connectionState === 'connected') {
    if (!hasPreview) {
      return streamMode === 'webrtc'
        ? 'Waiting for live preview…'
        : 'Waiting for preview frames…';
    }
    return 'Connected';
  }

  if (connectionState === 'failed') {
    return 'Connection failed';
  }

  return 'Disconnected';
}

function getLiveLabel(
  connectionState: ConnectionState,
  streamMode: StreamMode,
  hasPreview: boolean
): string {
  if (connectionState === 'connected' && hasPreview) {
    return streamMode === 'webrtc' ? 'Live' : 'Zoomed';
  }

  if (connectionState === 'connecting') {
    return 'Connecting';
  }

  if (connectionState === 'failed') {
    return 'Failed';
  }

  return 'Offline';
}

// Material Icons Outlined "photo_library", the app's empty-thumbnail icon.
function PhotoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M20,4v12L8,16L8,4h12m0,-2L8,2c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2L22,4c0,-1.1 -0.9,-2 -2,-2zM11.5,11.67l1.69,2.26 2.48,-3.1L19,15L9,15zM2,6v14c0,1.1 0.9,2 2,2h14v-2L4,20L4,6L2,6z" />
    </svg>
  );
}

// Material Icons Outlined "settings", the icon the app's camera screen uses.
function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.09-.16-.26-.25-.44-.25-.06 0-.12.01-.17.03l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.06-.02-.12-.03-.18-.03-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.09.16.26.25.44.25.06 0 .12-.01.17-.03l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.06.02.12.03.18.03.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65Zm-1.98-1.71c.04.31.05.52.05.73 0 .21-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7.14 1.13ZM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4Zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Z"
      />
    </svg>
  );
}

function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5a6.98 6.98 0 0 1 5.34 2.47V5.9a.9.9 0 0 1 1.8 0v3.95a.9.9 0 0 1-.9.9H14.3a.9.9 0 0 1 0-1.8h2.1A5.2 5.2 0 1 0 17.2 14a.9.9 0 0 1 1.77.28A7 7 0 1 1 12 5Z"
      />
    </svg>
  );
}

// Material Icons Outlined "cameraswitch", the app's selfie lens button.
function FlipIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16,7h-1l-1,-1h-4L9,7H8C6.9,7 6,7.9 6,9v6c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V9C18,7.9 17.1,7 16,7zM16,15H8V9h1.83l1,-1h2.34l1,1H16V15z" />
      <path fill="currentColor" d="M12,12m-2,0a2,2 0,1 1,4 0a2,2 0,1 1,-4 0" />
      <path fill="currentColor" d="M8.57,0.52L13.05,5l1.41,-1.41l-1.54,-1.54C17.7,2.46 21.53,6.24 22,11h2C23.36,3.3 15.79,-1.67 8.57,0.52z" />
      <path fill="currentColor" d="M9.54,20.41l1.54,1.54C6.3,21.54 2.47,17.76 2,13H0c0.64,7.7 8.21,12.67 15.43,10.48L10.95,19L9.54,20.41z" />
    </svg>
  );
}

export default function App() {
  const sessionId = useMemo(
    () => parseSessionIdFromInput(window.location.href),
    []
  );

  const rtcRef = useRef<BrowserWebRTCClient | null>(null);
  const signalingRef = useRef<BrowserSignalingClient | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [remoteState, setRemoteState] = useState<CameraState>(DEFAULT_STATE);
  const [remoteLenses, setRemoteLenses] = useState<LensInfo[]>([]);
  const [streamMode, setStreamMode] = useState<StreamMode>('webrtc');
  const [latestFrame, setLatestFrame] = useState<FrameDataMessage | null>(null);
  const [lastPhotoUri, setLastPhotoUri] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [videoNeedsRotation, setVideoNeedsRotation] = useState(false);
  const [previewZoomLimited, setPreviewZoomLimited] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showUtilitySheet, setShowUtilitySheet] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const frameUri = latestFrame ? `data:image/jpeg;base64,${latestFrame.data}` : null;
  const hasPreview = streamMode === 'webrtc' ? !!remoteStream : !!frameUri;
  const statusText = getStatusText(connectionState, streamMode, hasPreview);
  const liveLabel = getLiveLabel(connectionState, streamMode, hasPreview);
  const canControl = connectionState === 'connected';

  const previewTransform = [
    videoNeedsRotation ? 'rotate(180deg)' : '',
    remoteState.facing === 'front' ? 'scaleX(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = remoteStream;
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [remoteStream]);

  useEffect(() => {
    if (!showUtilitySheet) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowUtilitySheet(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showUtilitySheet]);

  useEffect(() => {
    if (!sessionId) {
      setErrorMessage('This remote link is missing a valid session ID.');
      setConnectionState('failed');
      return;
    }

    let isCancelled = false;

    const cleanup = () => {
      signalingRef.current?.cleanup();
      signalingRef.current = null;
      rtcRef.current?.close();
      rtcRef.current = null;
      setRemoteStream(null);
    };

    const handleResponse = (response: Response) => {
      if (isCancelled) {
        return;
      }

      switch (response.type) {
        case 'FRAME_DATA':
          setLatestFrame(response);
          return;
        case 'PHOTO_DATA':
          setLastPhotoUri(`data:image/jpeg;base64,${response.data}`);
          return;
        case 'STATE_UPDATE':
          setRemoteState(response.state);
          setRemoteLenses(response.lenses ?? []);
          setVideoNeedsRotation(response.videoNeedsRotation ?? false);
          setPreviewZoomLimited(response.previewZoomLimited ?? false);
          setStreamMode(response.streamMode ?? 'webrtc');
          return;
        case 'RECORDING_STARTED':
          setRemoteState((prev) => ({ ...prev, isRecording: true }));
          return;
        case 'RECORDING_STOPPED':
          setRemoteState((prev) => ({ ...prev, isRecording: false }));
          if (!response.success) {
            setErrorMessage(response.error ?? 'Failed to stop recording.');
          }
          return;
        case 'PHOTO_TAKEN':
          if (!response.success) {
            setErrorMessage(response.error ?? 'Failed to take photo.');
          }
          return;
        case 'ERROR':
          setErrorMessage(response.message);
          return;
      }
    };

    const connect = async () => {
      cleanup();
      setConnectionState('connecting');
      setErrorMessage(null);
      setLatestFrame(null);

      try {
        await ensureSignedIn();
      } catch (error) {
        console.error('Anonymous sign-in failed', error);
        if (!isCancelled) {
          setConnectionState('failed');
          setErrorMessage('Could not connect to the signaling service. Check your network and try again.');
        }
        return;
      }

      const signaling = new BrowserSignalingClient(db);
      signalingRef.current = signaling;

      const joined = await signaling.joinSession(sessionId);
      if (!joined) {
        if (!isCancelled) {
          setConnectionState('failed');
          setErrorMessage('This session is invalid or has already expired.');
        }
        return;
      }

      const rtc = new BrowserWebRTCClient({
        onRemoteStream: (stream) => {
          if (!isCancelled) {
            setRemoteStream(stream);
          }
        },
        onResponse: handleResponse,
        onConnectionState: (state) => {
          if (!isCancelled) {
            setConnectionState(state);
          }
        },
        onIceCandidate: async (candidate) => {
          try {
            await signaling.addIceCandidate(candidate);
          } catch (error) {
            console.error('Failed to send ICE candidate', error);
          }
        },
        onDataChannelOpen: () => {
          if (isCancelled) {
            return;
          }
          setErrorMessage(null);
          rtc.sendCommand({ type: 'GET_STATE' });
        },
      });

      rtcRef.current = rtc;
      await rtc.createConnection();

      if (isCancelled) {
        rtc.close();
        return;
      }

      signaling.onSessionMissing(() => {
        if (!isCancelled) {
          setConnectionState('failed');
          setErrorMessage('The camera ended this session.');
          rtc.close();
        }
      });

      // A session another remote already answered needs a fresh offer.
      try {
        await signaling.claimSession();
      } catch (error) {
        console.warn('Failed to claim the session', error);
      }
      if (isCancelled) {
        return;
      }

      signaling.onOffer(async (offer) => {
        if (rtc.isOfferForAnotherConnection(offer.sdp)) {
          // Another remote opened this session, and the camera has moved on.
          if (!isCancelled) {
            // close() reports 'disconnected'; set the final state after it.
            rtc.close();
            setConnectionState('failed');
            setErrorMessage('Another remote has taken over this session.');
          }
          return;
        }
        try {
          await rtc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
          const answer = await rtc.createAnswer();
          await signaling.sendAnswer({ type: 'answer', sdp: answer.sdp ?? '' });
        } catch (error) {
          console.error('Failed to answer offer', error);
          if (!isCancelled) {
            setConnectionState('failed');
            setErrorMessage('Unable to establish the remote connection.');
          }
        }
      });

      signaling.onOfferIceCandidate(async (candidate) => {
        try {
          await rtc.addIceCandidate(candidate);
        } catch (error) {
          console.error('Failed to add offer ICE candidate', error);
        }
      });
    };

    void connect();

    return () => {
      isCancelled = true;
      cleanup();
    };
  }, [reconnectNonce, sessionId]);

  const sendCommand = (command: Parameters<BrowserWebRTCClient['sendCommand']>[0]) => {
    rtcRef.current?.sendCommand(command);
  };

  const handleReconnect = () => {
    setShowUtilitySheet(false);
    setReconnectNonce((value) => value + 1);
  };

  const handleCaptureModeChange = (mode: CaptureMode) => {
    setRemoteState((prev) => ({ ...prev, captureMode: mode }));
  };

  const handleToggleFlash = () => {
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(remoteState.flash);
    const nextIndex = (currentIndex + 1) % modes.length;
    sendCommand({ type: 'SET_FLASH', mode: modes[nextIndex] });
    setShowUtilitySheet(false);
  };

  const handleLensSelect = (lens: LensInfo) => {
    if (lens.id === 'selfie') {
      if (remoteState.facing !== 'front') {
        sendCommand({ type: 'SWITCH_CAMERA' });
      }
      return;
    }

    if (remoteState.facing === 'front') {
      sendCommand({ type: 'SWITCH_CAMERA' });

      if (lens.zoom !== 1) {
        window.setTimeout(() => {
          sendCommand({ type: 'SET_ZOOM', level: lens.zoom });
        }, 500);
      }
      return;
    }

    sendCommand({ type: 'SET_ZOOM', level: lens.zoom });
  };

  const handleShutter = () => {
    if (remoteState.captureMode === 'photo') {
      sendCommand({ type: 'TAKE_PHOTO' });
      return;
    }

    if (remoteState.isRecording) {
      sendCommand({ type: 'STOP_RECORDING' });
      return;
    }

    sendCommand({ type: 'START_RECORDING' });
  };

  const handleDisconnect = () => {
    signalingRef.current?.cleanup();
    rtcRef.current?.close();
    setRemoteStream(null);
    setConnectionState('disconnected');
    setShowUtilitySheet(false);
  };

  return (
    <main className="app-shell">
      <section className="remote-stage">
        {streamMode === 'webrtc' && remoteStream ? (
          <video
            ref={videoRef}
            className="preview-media"
            style={{ transform: previewTransform || undefined }}
            autoPlay
            muted
            playsInline
          />
        ) : null}

        {streamMode === 'frame-based' && frameUri ? (
          <img
            className="preview-media"
            style={{ transform: previewTransform || undefined }}
            src={frameUri}
            alt="Remote camera preview"
          />
        ) : null}

        {!hasPreview ? (
          <div className="preview-placeholder">
            <p>{errorMessage ?? statusText}</p>
            <span>
              {sessionId
                ? 'Keep this page open while the camera phone is waiting.'
                : 'Open this page from a valid QR session link.'}
            </span>
          </div>
        ) : null}

        <div className="top-chrome">
          <div className={`floating-pill live-pill status-${connectionState}`}>
            <span className={`live-dot dot-${connectionState}`} />
            <span>{liveLabel}</span>
          </div>

          {sessionId ? (
            <div className="floating-pill session-pill">
              <span>Session</span>
              <strong>{sessionId}</strong>
            </div>
          ) : null}

          {streamMode === 'frame-based' && hasPreview ? (
            <div className="floating-pill mode-pill">Frame Preview</div>
          ) : (
            <div className="top-chrome-spacer" />
          )}
        </div>

        {errorMessage ? (
          <aside className="error-banner overlay-error">{errorMessage}</aside>
        ) : null}

        <div className="controls-overlay">
          <div className="controls-scrim">
            <div className="mode-toggle-row">
              <div className="mode-selector" role="tablist" aria-label="Capture mode">
                <button
                  type="button"
                  className={remoteState.captureMode === 'photo' ? 'mode-button active' : 'mode-button'}
                  onClick={() => handleCaptureModeChange('photo')}
                  disabled={!canControl || remoteState.isRecording}
                >
                  Photo
                </button>
                <button
                  type="button"
                  className={remoteState.captureMode === 'video' ? 'mode-button active' : 'mode-button'}
                  onClick={() => handleCaptureModeChange('video')}
                  disabled={!canControl || remoteState.isRecording}
                >
                  Video
                </button>
              </div>
            </div>

            <div className="main-controls-row">
              <button
                type="button"
                className="thumbnail-button"
                onClick={() => setShowPhotoModal(true)}
                disabled={!lastPhotoUri}
                aria-label={lastPhotoUri ? 'Open last captured photo' : 'No captured photo yet'}
              >
                {lastPhotoUri ? (
                  <img src={lastPhotoUri} alt="Last captured frame" />
                ) : (
                  <span className="thumbnail-placeholder" aria-hidden="true">
                    <PhotoIcon className="button-icon" />
                  </span>
                )}
              </button>

              <button
                type="button"
                className={`shutter-button ${
                  remoteState.captureMode === 'video' ? 'video' : ''
                } ${remoteState.isRecording ? 'recording' : ''}`}
                onClick={handleShutter}
                disabled={!canControl}
                aria-label={
                  remoteState.captureMode === 'photo'
                    ? 'Take photo'
                    : remoteState.isRecording
                      ? 'Stop recording'
                      : 'Start recording'
                }
              >
                <span />
              </button>

              <div className="main-controls-spacer" aria-hidden="true" />
            </div>

            <div className="bottom-row">
              <button
                type="button"
                className="circle-button"
                onClick={() => setShowUtilitySheet(true)}
                aria-label="Open remote settings"
              >
                <SettingsIcon className="button-icon" />
              </button>

              <div className="lens-selector-container">
                {previewZoomLimited && remoteState.zoom !== 1 ? (
                  <p className="preview-zoom-note">
                    Preview at 1x, capture at {remoteState.zoom.toFixed(1)}x
                  </p>
                ) : null}

                <div className="lens-selector">
                  {remoteLenses.length > 0 ? (
                    remoteLenses.map((lens) => (
                      <button
                        key={lens.id}
                        type="button"
                        className={lens.isActive ? 'lens-button active' : 'lens-button'}
                        onClick={() => handleLensSelect(lens)}
                        disabled={!canControl}
                        aria-label={lens.id === 'selfie' ? 'Switch to selfie camera' : `Set zoom to ${lens.label}`}
                      >
                        {lens.id === 'selfie' ? (
                          <FlipIcon className="lens-icon" />
                        ) : (
                          lens.label
                        )}
                      </button>
                    ))
                  ) : (
                    <span className="zoom-display">{remoteState.zoom.toFixed(1)}x</span>
                  )}
                </div>
              </div>

              <div className="qr-button-container">
                {connectionState === 'connecting' ? (
                  <span className="qr-loading-ring" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  className="circle-button qr-button"
                  onClick={handleReconnect}
                  aria-label="Reconnect to session"
                  title="Reconnect"
                >
                  <RefreshIcon className="button-icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {showPhotoModal && lastPhotoUri ? (
        <div className="modal-shell" onClick={() => setShowPhotoModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <img src={lastPhotoUri} alt="Last captured preview" />
            <button
              type="button"
              className="sheet-action close-button"
              onClick={() => setShowPhotoModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showUtilitySheet ? (
        <div className="sheet-backdrop" onClick={() => setShowUtilitySheet(false)}>
          <div className="utility-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="sheet-title">Remote Controls</p>
            <button
              type="button"
              className="sheet-action"
              onClick={handleToggleFlash}
              disabled={!canControl}
            >
              Flash: {remoteState.flash}
            </button>
            <button
              type="button"
              className="sheet-action"
              onClick={handleReconnect}
            >
              Reconnect
            </button>
            <button
              type="button"
              className="sheet-action danger"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
            <button
              type="button"
              className="sheet-action close-button"
              onClick={() => setShowUtilitySheet(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
