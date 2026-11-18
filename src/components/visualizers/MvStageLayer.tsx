import React, { useEffect, useRef } from 'react';
import { audioEngine, LuminaAudioEngine } from '../../audio/AudioEngine';

interface MvStageLayerProps {
  src: string | null;
  isPlaying: boolean;
  targetTime: number;
  playbackRate?: number;
  muted: boolean;
  audioGain?: number;
  volume?: number;
  dspEngine?: LuminaAudioEngine;
  blurPx?: number;
  opacityPct?: number;
  isTheaterClarity?: boolean;
  fullViewport?: boolean;
  className?: string;
  onVideoEnded?: () => void;
  onAudioUnlockNeeded?: (needed: boolean) => void;
}

export const MvStageLayer: React.FC<MvStageLayerProps> = ({
  src,
  isPlaying,
  targetTime,
  playbackRate = 1,
  muted,
  audioGain = 1,
  volume = 0.85,
  dspEngine = audioEngine,
  fullViewport = false,
  className = '',
  onVideoEnded,
  onAudioUnlockNeeded,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webAudioRoutedRef = useRef(false);
  const unlockBlockedRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const pendingPlayRef = useRef<Promise<void> | null>(null);

  const safePlayVideo = (video: HTMLVideoElement) => {
    if (pendingPlayRef.current || !video.paused) return;
    const p = video
      .play()
      .then(() => {
        unlockBlockedRef.current = false;
        onAudioUnlockNeeded?.(false);
        if (!isPlayingRef.current && !video.paused) {
          video.pause();
        }
      })
      .catch((err) => {
        // Never treat intentional pause/seek AbortError as an autoplay block
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          !isPlayingRef.current
        ) {
          return;
        }
        // Browser blocked unmuted autoplay: play muted temporarily so visuals start,
        // and auto-unmute transparently on first interaction
        if (!video.muted) {
          unlockBlockedRef.current = true;
          onAudioUnlockNeeded?.(true);
          video.muted = true;
          video.play().catch(() => {});
        }
      })
      .finally(() => {
        if (pendingPlayRef.current === p) {
          pendingPlayRef.current = null;
        }
      });
    pendingPlayRef.current = p;
  };

  const safePauseVideo = (video: HTMLVideoElement) => {
    const pending = pendingPlayRef.current;
    if (pending) {
      pending
        .catch(() => {})
        .finally(() => {
          if (!isPlayingRef.current && !video.paused) {
            video.pause();
          }
        });
      return;
    }
    if (!video.paused) {
      video.pause();
    }
  };

  // Route video audio through the active AudioEngine DSP chain whenever src is local/same-origin
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      webAudioRoutedRef.current = false;
      return;
    }
    webAudioRoutedRef.current = dspEngine.attachMvVideoElement(video, src);
  }, [src, dspEngine]);

  // Apply mute, volume, and smooth crossfade gain
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const effectiveGain = muted
      ? 0
      : Math.max(0, Math.min(1, Number.isFinite(audioGain) ? audioGain : 1));

    if (webAudioRoutedRef.current) {
      // Keep native video unmuted at unity gain unless browser blocked unmuted autoplay;
      // mvInputGain inside AudioEngine performs click-free DSP-processed crossfading
      if (!unlockBlockedRef.current) {
        video.muted = false;
      }
      video.volume = 1;
      if (dspEngine !== audioEngine) {
        // Standalone engine only drives MV audio
        dspEngine.setTheaterMixGains(0, effectiveGain, 0.018);
      }
    } else {
      // Fallback for external cross-origin URLs without CORS headers
      video.muted = muted || effectiveGain <= 0.002;
      video.volume = Math.max(0, Math.min(1, volume * effectiveGain));
    }
  }, [src, muted, audioGain, volume, dspEngine]);

  // Auto-unlock Web Audio + unmuted video seamlessly on first user gesture if browser autoplay policy blocked audio
  useEffect(() => {
    const tryUnlock = () => {
      const video = videoRef.current;
      if (!video) return;
      dspEngine.resumeContext().catch(() => {});
      if (unlockBlockedRef.current) {
        unlockBlockedRef.current = false;
        video.muted = webAudioRoutedRef.current ? false : muted;
        onAudioUnlockNeeded?.(false);
        if (isPlayingRef.current && video.paused) {
          safePlayVideo(video);
        }
      }
    };
    window.addEventListener('pointerdown', tryUnlock, { passive: true });
    window.addEventListener('keydown', tryUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', tryUnlock);
      window.removeEventListener('keydown', tryUnlock);
    };
  }, [dspEngine, muted, onAudioUnlockNeeded]);

  // Sync play/pause, tight phase-locked playback rate micro-nudges, and hard seek drift correction
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const baseRate =
      Number.isFinite(playbackRate) && playbackRate >= 0.85 && playbackRate <= 1.15
        ? playbackRate
        : 1;

    if (Number.isFinite(targetTime) && targetTime >= 0) {
      const diff = targetTime - (video.currentTime || 0);
      const absDiff = Math.abs(diff);

      if (!isPlaying) {
        if (absDiff > 0.1) {
          try {
            video.currentTime = targetTime;
          } catch {
            // Ignore seek before metadata is loaded
          }
        }
        if (Math.abs(video.playbackRate - baseRate) > 0.005) {
          video.playbackRate = baseRate;
        }
      } else if (absDiff > 0.36) {
        try {
          video.currentTime = targetTime;
        } catch {
          // Ignore seek before metadata is loaded
        }
        if (Math.abs(video.playbackRate - baseRate) > 0.005) {
          video.playbackRate = baseRate;
        }
      } else if (absDiff > 0.03) {
        // Gentle +/-5% speed nudge locks MV frames within ~30ms without audible pitch shift or stutter
        const nudge = Math.max(-0.05, Math.min(0.05, diff * 0.55));
        const targetRate = baseRate + nudge;
        if (Math.abs(video.playbackRate - targetRate) > 0.004) {
          video.playbackRate = targetRate;
        }
      } else if (Math.abs(video.playbackRate - baseRate) > 0.005) {
        video.playbackRate = baseRate;
      }
    }

    if (isPlaying) {
      dspEngine.resumeContext().catch(() => {});
      if (video.paused) {
        safePlayVideo(video);
      }
    } else {
      safePauseVideo(video);
    }
  }, [src, isPlaying, targetTime, playbackRate, muted, dspEngine, onAudioUnlockNeeded]);

  if (!src) return null;

  return (
    <div
      className={`${
        fullViewport ? 'fixed inset-0' : 'absolute inset-0'
      } z-0 overflow-hidden pointer-events-none select-none bg-black ${className}`}
      style={{
        transform: 'translateZ(0)',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          if (Number.isFinite(targetTime) && targetTime > 0) {
            try {
              video.currentTime = targetTime;
            } catch {
              // ignore
            }
          }
          if (isPlayingRef.current) {
            dspEngine.resumeContext().catch(() => {});
            safePlayVideo(video);
          }
        }}
        onEnded={() => onVideoEnded?.()}
        className="w-full h-full object-cover"
        style={{
          opacity: 1,
          filter: 'none',
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      />
    </div>
  );
};
