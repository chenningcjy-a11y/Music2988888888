import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { LuminaAudioEngine } from '../audio/AudioEngine';
import { MvStageLayer } from '../components/visualizers/MvStageLayer';
import {
  getAllMvMetas,
  getMvRecordById,
  getTrackMvs,
  loadAudioSettings,
  loadPlaybackPrefs,
} from '../services/storage';
import { AudioDspSettings } from '../types/music';
import { DEFAULT_AUDIO_SETTINGS, formatTime } from '../utils/constants';
import {
  MV_CMD_STORAGE_KEY,
  MV_SYNC_CHANNEL_NAME,
  MV_SYNC_STORAGE_KEY,
  MvBlobResponseMessage,
  MvRemoteCommand,
  MvSyncSnapshot,
} from '../utils/mvTimeline';

export const MvStandalonePage: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MvSyncSnapshot | null>(() => {
    try {
      const raw = localStorage.getItem(MV_SYNC_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as MvSyncSnapshot) : null;
    } catch {
      return null;
    }
  });
  const [fallbackMvId, setFallbackMvId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDurationFallback, setVideoDurationFallback] = useState(0);
  const [localPickedName, setLocalPickedName] = useState<string | null>(null);
  const [fallbackAudioSettings, setFallbackAudioSettings] = useState<AudioDspSettings>(
    DEFAULT_AUDIO_SETTINGS
  );
  const [hoverHud, setHoverHud] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [scrubMvTime, setScrubMvTime] = useState<number | null>(null);

  const standaloneDspEngine = useMemo(() => new LuminaAudioEngine(), []);
  const objectUrlRef = useRef<string | null>(null);
  const loadedMvKeyRef = useRef<string | null>(null);
  const manualOverrideRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const didSwipeRef = useRef(false);
  const lastSeekCmdAtRef = useRef(0);
  const swipeStartRef = useRef<{ x: number; startTime: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestedBlobForMvRef = useRef<string | null>(null);
  const targetMvIdRef = useRef<string | null>(null);

  const setManagedVideoUrl = useCallback((url: string | null, isObjectUrl: boolean) => {
    if (objectUrlRef.current && objectUrlRef.current !== url) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (isObjectUrl && url) {
      objectUrlRef.current = url;
    }
    setVideoUrl(url);
  }, []);

  const sendCommand = useCallback((cmd: MvRemoteCommand) => {
    try {
      channelRef.current?.postMessage(cmd);
    } catch {
      // ignore
    }
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(cmd, window.location.origin);
      }
    } catch {
      // ignore cross-origin or closed opener
    }
    try {
      localStorage.setItem(MV_CMD_STORAGE_KEY, JSON.stringify(cmd));
    } catch {
      // ignore
    }
  }, []);

  // Connect BroadcastChannel + window.opener postMessage + localStorage fallback
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(MV_SYNC_CHANNEL_NAME);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        const msg = event.data as { type?: string; payload?: MvSyncSnapshot };
        if (msg?.type === 'SYNC_SNAPSHOT' && msg.payload) {
          setSnapshot(msg.payload);
        }
      };
    }

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as
        | { type?: 'SYNC_SNAPSHOT'; payload?: MvSyncSnapshot }
        | MvBlobResponseMessage
        | undefined;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'SYNC_SNAPSHOT' && msg.payload) {
        setSnapshot(msg.payload);
      } else if (msg.type === 'MV_BLOB_RESPONSE') {
        if (manualOverrideRef.current) return;
        if (targetMvIdRef.current && msg.mvId !== targetMvIdRef.current) return;
        if (msg.videoBlob) {
          const url = URL.createObjectURL(msg.videoBlob);
          loadedMvKeyRef.current = `${msg.mvId}:${msg.externalUrl || ''}`;
          setManagedVideoUrl(url, true);
          if (msg.durationSec) setVideoDurationFallback(msg.durationSec);
        } else if (msg.externalUrl) {
          loadedMvKeyRef.current = `${msg.mvId}:${msg.externalUrl}`;
          setManagedVideoUrl(msg.externalUrl, false);
          if (msg.durationSec) setVideoDurationFallback(msg.durationSec);
        }
      }
    };
    window.addEventListener('message', onWindowMessage);

    const onStorage = (e: StorageEvent) => {
      if (e.key === MV_SYNC_STORAGE_KEY && e.newValue) {
        try {
          setSnapshot(JSON.parse(e.newValue) as MvSyncSnapshot);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);

    sendCommand({ type: 'STANDALONE_HELLO', timestamp: Date.now() });

    const hb = window.setInterval(() => {
      sendCommand({ type: 'STANDALONE_HEARTBEAT', timestamp: Date.now() });
    }, 1800);

    const onUnload = () => {
      sendCommand({ type: 'STANDALONE_BYE', timestamp: Date.now() });
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.clearInterval(hb);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onUnload);
      sendCommand({ type: 'STANDALONE_BYE', timestamp: Date.now() });
      channel?.close();
      channelRef.current = null;
    };
  }, [sendCommand, setManagedVideoUrl]);

  // Same-origin IndexedDB auto-discovery if snapshot hasn't arrived or mvId wasn't persisted yet
  useEffect(() => {
    if (snapshot?.mvId) return;
    let cancelled = false;
    async function discoverActiveMv() {
      try {
        const prefs = await loadPlaybackPrefs();
        if (prefs.lastTrackId) {
          const trackMvs = await getTrackMvs(prefs.lastTrackId);
          const active = trackMvs.find((m) => m.isActive) || trackMvs[0];
          if (active && !cancelled) {
            setFallbackMvId(active.id);
            return;
          }
        }
        const all = await getAllMvMetas();
        const activeAny = all.find((m) => m.isActive) || all[0];
        if (activeAny && !cancelled) {
          setFallbackMvId(activeAny.id);
        }
      } catch {
        // Ignore if storage partitioned
      }
    }
    discoverActiveMv();
    return () => {
      cancelled = true;
    };
  }, [snapshot?.mvId]);

  // Hydrate MV video blob from local IndexedDB, or request via window.opener if storage-partitioned
  const targetMvId = snapshot?.mvId || fallbackMvId;
  targetMvIdRef.current = targetMvId;

  useEffect(() => {
    if (manualOverrideRef.current) return;
    const mvKey = targetMvId
      ? `${targetMvId}:${snapshot?.mvExternalUrl || ''}`
      : null;

    if (!mvKey) {
      loadedMvKeyRef.current = null;
      setManagedVideoUrl(null, false);
      setVideoDurationFallback(0);
      return;
    }

    if (loadedMvKeyRef.current === mvKey && videoUrl) return;

    let cancelled = false;
    async function resolveVideoSource() {
      if (!targetMvId) return;
      if (snapshot?.mvSourceType === 'url' && snapshot.mvExternalUrl) {
        if (!cancelled) {
          loadedMvKeyRef.current = mvKey;
          setManagedVideoUrl(snapshot.mvExternalUrl, false);
          setVideoDurationFallback(snapshot.mvDurationSec || 0);
        }
        return;
      }

      const record = await getMvRecordById(targetMvId);
      if (cancelled) return;

      if (record?.videoBlob) {
        const url = URL.createObjectURL(record.videoBlob);
        loadedMvKeyRef.current = mvKey;
        setManagedVideoUrl(url, true);
        setVideoDurationFallback(record.durationSec || 0);
        return;
      }

      if (record?.externalUrl) {
        loadedMvKeyRef.current = mvKey;
        setManagedVideoUrl(record.externalUrl, false);
        setVideoDurationFallback(record.durationSec || 0);
        return;
      }

      // Cross-partition fallback (e.g. iframe -> new tab): ask main window for the Blob
      if (requestedBlobForMvRef.current !== targetMvId) {
        requestedBlobForMvRef.current = targetMvId;
        sendCommand({
          type: 'REQUEST_MV_BLOB',
          mvId: targetMvId,
          timestamp: Date.now(),
        });
      }
    }

    resolveVideoSource();

    return () => {
      cancelled = true;
    };
  }, [
    targetMvId,
    snapshot?.mvSourceType,
    snapshot?.mvExternalUrl,
    snapshot?.mvDurationSec,
    videoUrl,
    sendCommand,
    setManagedVideoUrl,
  ]);

  // Load persisted audio DSP settings & sync with main-page snapshot for identical sound quality
  useEffect(() => {
    loadAudioSettings()
      .then((s) => setFallbackAudioSettings(s))
      .catch(() => {});
  }, []);

  const effectiveAudioSettings = snapshot?.audioSettings || fallbackAudioSettings;

  useEffect(() => {
    standaloneDspEngine.applySettings(effectiveAudioSettings);
  }, [standaloneDspEngine, effectiveAudioSettings]);

  useEffect(() => {
    standaloneDspEngine.setVolume(
      snapshot?.volume ?? 0.85,
      Boolean(snapshot?.muted)
    );
  }, [standaloneDspEngine, snapshot?.volume, snapshot?.muted]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
      }
    };
  }, []);

  const bumpHud = useCallback(() => {
    setHoverHud(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      if (!isScrubbingRef.current) {
        setHoverHud(false);
      }
    }, 3400);
  }, []);

  useEffect(() => {
    const onFs = () => setIsNativeFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFs = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const handleManualFilePick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    manualOverrideRef.current = true;
    const url = URL.createObjectURL(file);
    setManagedVideoUrl(url, true);
    setLocalPickedName(file.name);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const hasVideo = Boolean(videoUrl);
  const isTheaterPhase = snapshot && snapshot.phase !== 'normal';
  const totalMvDuration = Math.max(
    1,
    snapshot?.mvDurationSec || videoDurationFallback || snapshot?.audioDuration || 1
  );
  const ipcLatencySec =
    snapshot?.isPlaying && snapshot?.sentAt
      ? Math.max(0, Math.min(0.15, (Date.now() - snapshot.sentAt) / 1000))
      : 0;
  const currentMvTime =
    scrubMvTime ?? ((snapshot?.mvTargetTime || 0) + ipcLatencySec);
  const progressPct = Math.min(
    100,
    Math.max(0, (currentMvTime / totalMvDuration) * 100)
  );

  const dispatchMvSeek = (val: number, immediate: boolean) => {
    const clamped = Math.max(0, Math.min(totalMvDuration, val));
    setScrubMvTime(clamped);
    const now = performance.now();
    if (immediate || now - lastSeekCmdAtRef.current >= 95) {
      lastSeekCmdAtRef.current = now;
      sendCommand({
        type: 'SEEK_MV',
        mvTimeSec: clamped,
        timestamp: Date.now(),
      });
    }
  };

  const commitMvSeek = (val?: number) => {
    isScrubbingRef.current = false;
    const finalVal = val ?? scrubMvTime ?? currentMvTime;
    dispatchMvSeek(finalVal, true);
    setScrubMvTime(null);
    bumpHud();
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black text-white touch-pan-y"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a')) return;
        didSwipeRef.current = false;
        swipeStartRef.current = { x: e.clientX, startTime: currentMvTime };
      }}
      onPointerMove={(e) => {
        if (!swipeStartRef.current || !hasVideo) return;
        const dx = e.clientX - swipeStartRef.current.x;
        if (Math.abs(dx) < 8) return;
        didSwipeRef.current = true;
        isScrubbingRef.current = true;
        const deltaSec = (dx / Math.max(240, window.innerWidth)) * Math.min(180, totalMvDuration);
        dispatchMvSeek(swipeStartRef.current.startTime + deltaSec, false);
      }}
      onPointerUp={() => {
        if (swipeStartRef.current) {
          swipeStartRef.current = null;
          if (isScrubbingRef.current) {
            commitMvSeek();
          }
        }
      }}
      onPointerCancel={() => {
        swipeStartRef.current = null;
        if (isScrubbingRef.current) {
          commitMvSeek();
        }
      }}
      onClick={(e) => {
        if (didSwipeRef.current) {
          didSwipeRef.current = false;
          return;
        }
        if ((e.target as HTMLElement).closest('button, input, a')) return;
        standaloneDspEngine.resumeContext().catch(() => {});
        bumpHud();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
        className="hidden"
        onChange={(e) => handleManualFilePick(e.target.files)}
      />

      {/* Pure, unobstructed GPU-composited full-bleed MV video surface */}
      {hasVideo ? (
        <MvStageLayer
          src={videoUrl}
          isPlaying={Boolean(snapshot?.isPlaying)}
          targetTime={currentMvTime}
          playbackRate={snapshot?.mvPlaybackRate || 1}
          muted={Boolean((snapshot?.mvMuted ?? false) || snapshot?.muted)}
          audioGain={snapshot?.mvAudioGain ?? 1}
          volume={snapshot?.volume ?? 0.85}
          dspEngine={standaloneDspEngine}
          blurPx={0}
          opacityPct={100}
          isTheaterClarity={true}
          fullViewport={true}
          onVideoEnded={() => {
            if (snapshot?.phase === 'outro') {
              sendCommand({ type: 'MV_ENDED_IN_OUTRO', timestamp: Date.now() });
            }
          }}
        />
      ) : (
        <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-[#080407]">
          <h1 className="font-display text-2xl font-bold text-white">
            LUMINA MUSIC · 独立 MV 剧场窗口
          </h1>
          <p className="text-sm text-white/70 max-w-md leading-relaxed">
            {snapshot?.mvId
              ? `正在同步「${snapshot.trackTitle}」的 MV 视频流... 若浏览器隔离了跨标签页存储，可直接点击下方按钮载入本地视频文件。`
              : snapshot?.trackTitle
              ? `当前曲目「${snapshot.trackTitle}」尚未绑定 MV，请在主网页的「MV 剧场」页面导入对应视频。`
              : '正在连接主网页同步数据；若未自动显示画面，请确保从主网页点击「在独立新网页播放 MV」打开，或直接手动选择视频文件。'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                sendCommand({ type: 'STANDALONE_HELLO', timestamp: Date.now() });
                if (targetMvId) {
                  sendCommand({
                    type: 'REQUEST_MV_BLOB',
                    mvId: targetMvId,
                    timestamp: Date.now(),
                  });
                }
              }}
              className="min-h-[42px] px-4 py-2 rounded-2xl bg-white/12 hover:bg-white/20 border border-white/20 text-xs font-medium text-white cursor-pointer"
            >
              重新同步主网页
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[42px] px-4 py-2 rounded-2xl bg-rose-600/85 hover:bg-rose-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              <span>直接选择本地 MV 文件播放</span>
            </button>
          </div>
        </div>
      )}

      {/* Top-Left Corner: Skip Intro / Mid-Break / Outro Button — ONLY visible when user clicks/taps */}
      {isTheaterPhase && snapshot?.skipLabel && hoverHud && (
        <div className="fixed top-5 left-5 z-40 flex items-center">
          <button
            type="button"
            onClick={() => {
              setHoverHud(false);
              sendCommand({ type: 'SKIP_PHASE', timestamp: Date.now() });
            }}
            className="min-h-[44px] px-4 py-2 rounded-2xl bg-black/72 hover:bg-black/88 backdrop-blur-xl border border-white/25 text-sm font-semibold text-white shadow-2xl flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
            <span>{snapshot.skipLabel}</span>
          </button>
        </div>
      )}

      {/* Bottom Controls with Interactive Seekable MV Progress Bar — shown ONLY on click during normal playback */}
      {!isTheaterPhase && (
      <div
        className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-[min(94vw,760px)] px-4 py-3 rounded-2xl bg-black/72 backdrop-blur-xl border border-white/15 space-y-2 transition-opacity duration-300 ${
          hoverHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {hasVideo && (
          <div className="space-y-1">
            <div className="relative flex items-center h-7">
              <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
              <div
                className="absolute left-0 h-1.5 rounded-full pointer-events-none bg-gradient-to-r from-rose-500 to-violet-500"
                style={{ width: `${progressPct}%` }}
              />
              <input
                type="range"
                min={0}
                max={totalMvDuration}
                step={0.1}
                value={Math.min(currentMvTime, totalMvDuration)}
                onPointerDown={() => {
                  isScrubbingRef.current = true;
                  bumpHud();
                }}
                onChange={(e) => {
                  isScrubbingRef.current = true;
                  dispatchMvSeek(parseFloat(e.target.value), false);
                }}
                onPointerUp={(e) =>
                  commitMvSeek(parseFloat(e.currentTarget.value))
                }
                onTouchEnd={(e) =>
                  commitMvSeek(parseFloat(e.currentTarget.value))
                }
                aria-label="独立网页 MV 进度条"
                className="lumina-range w-full relative z-10"
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-white/60">
              <span>{formatTime(currentMvTime)}</span>
              <span>{formatTime(totalMvDuration)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">
              {snapshot?.trackTitle || localPickedName || '等待主网页连接...'}
            </p>
            <p className="text-xs text-white/60 truncate">
              {snapshot?.trackArtist || 'LUMINA MUSIC'} ·{' '}
              {isTheaterPhase
                ? snapshot?.phase === 'intro'
                  ? '前瞻原声播放中'
                  : snapshot?.phase === 'mid-break'
                  ? '中间剧情原声播放中'
                  : '后段彩蛋播放中'
                : '独立画面与主网页音频同步中（支持拖动进度条或左右滑动画面）'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="更换本地 MV 视频文件"
              aria-label="更换本地 MV 视频文件"
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/15 flex items-center justify-center text-white/85 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => sendCommand({ type: 'PREV_TRACK', timestamp: Date.now() })}
              aria-label="上一首"
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/15 flex items-center justify-center text-white/85 cursor-pointer"
            >
              <SkipBack className="w-4 h-4" fill="currentColor" />
            </button>

            <button
              type="button"
              onClick={() => sendCommand({ type: 'TOGGLE_PLAY', timestamp: Date.now() })}
              aria-label={snapshot?.isPlaying ? '暂停' : '播放'}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-white/18 hover:bg-white/28 flex items-center justify-center text-white cursor-pointer"
            >
              {snapshot?.isPlaying ? (
                <Pause className="w-5 h-5" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              )}
            </button>

            <button
              type="button"
              onClick={() => sendCommand({ type: 'NEXT_TRACK', timestamp: Date.now() })}
              aria-label="下一首"
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/15 flex items-center justify-center text-white/85 cursor-pointer"
            >
              <SkipForward className="w-4 h-4" fill="currentColor" />
            </button>

            <button
              type="button"
              onClick={toggleFs}
              aria-label="切换全屏"
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/15 flex items-center justify-center text-white/85 cursor-pointer"
            >
              {isNativeFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
