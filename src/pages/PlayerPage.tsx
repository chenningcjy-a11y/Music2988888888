import React, { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FileMusic,
  Film,
  Heart,
  ListMusic,
  Maximize2,
  MessageSquareText,
  Mic2,
  Minimize2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { TrackInfoEditModal } from '../components/TrackInfoEditModal';
import { VocalBackgroundControl } from '../components/audio/VocalBackgroundControl';
import { FullscreenThreeLineLyrics } from '../components/lyrics/FullscreenThreeLineLyrics';
import { LyricsEditorModal } from '../components/lyrics/LyricsEditorModal';
import { LyricsSearchModal } from '../components/lyrics/LyricsSearchModal';
import { LyricsView } from '../components/lyrics/LyricsView';
import { AlbumVinylStage } from '../components/visualizers/AlbumVinylStage';
import { FullscreenCoverFluidStage } from '../components/visualizers/FullscreenCoverFluidStage';
import { LiquidWaveCanvas } from '../components/visualizers/LiquidWaveCanvas';
import { MvStageLayer } from '../components/visualizers/MvStageLayer';
import { useMusic } from '../context/MusicContext';
import {
  formatBitrate,
  formatSampleRate,
  formatTime,
} from '../utils/constants';

export const PlayerPage: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    showLyricsInPlayer,
    setShowLyricsInPlayer,
    isFullscreen,
    toggleFullscreen,
    exitFullscreen,
    setIsQueueOpen,
    setActivePage,
    activePalette,
    personalization,
    audioSettings,
    currentTrackStemMeta,
    updateAudioSettings,
    togglePlayPause,
    playNext,
    playPrev,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    toggleFavorite,
    updateTrackInfo,
    updateTrackCover,
    updateTrackLyrics,
    translateTrackLyrics,
    isTranslatingLyrics,
    updateLyricsOffset,
    showToast,
    activeMv,
    activeMvVideoUrl,
    mvPhase,
    mvPhaseTime,
    mvUiOpacity,
    mvVideoMuted,
    mvAudioGain,
    mvSkipLabel,
    mvSkipSubLabel,
    mvTargetTime,
    standaloneMvConnected,
    skipMvPhase,
    seekMvTimeline,
  } = useMusic();

  const [searchOpen, setSearchOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [trackInfoEditOpen, setTrackInfoEditOpen] = useState(false);
  const [vocalMixerOpen, setVocalMixerOpen] = useState(false);
  const [showExitHint, setShowExitHint] = useState(false);
  const [showMvSkipOnTap, setShowMvSkipOnTap] = useState(false);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const mvSkipTimerRef = useRef<number | null>(null);
  const fullscreenRootRef = useRef<HTMLDivElement | null>(null);
  const currentRgbRef = useRef<{
    primary: [number, number, number];
    secondary: [number, number, number];
  }>({
    primary: [...activePalette.rgbPrimary],
    secondary: [...activePalette.rgbSecondary],
  });

  // Hide tap-revealed skip button whenever leaving MV theater phase or fullscreen
  useEffect(() => {
    if (!isFullscreen || mvPhase === 'normal') {
      setShowMvSkipOnTap(false);
      if (mvSkipTimerRef.current) {
        window.clearTimeout(mvSkipTimerRef.current);
        mvSkipTimerRef.current = null;
      }
    }
  }, [isFullscreen, mvPhase]);

  // Reveal subtle exit affordance on interaction ONLY during normal music phase (never during MV-only playback)
  useEffect(() => {
    if (!isFullscreen || mvPhase !== 'normal') {
      setShowExitHint(false);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      return;
    }

    const revealTemporarily = () => {
      setShowExitHint(true);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        setShowExitHint(false);
      }, 2400);
    };

    window.addEventListener('pointermove', revealTemporarily, { passive: true });
    window.addEventListener('pointerdown', revealTemporarily, { passive: true });
    window.addEventListener('touchstart', revealTemporarily, { passive: true });

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointermove', revealTemporarily);
      window.removeEventListener('pointerdown', revealTemporarily);
      window.removeEventListener('touchstart', revealTemporarily);
    };
  }, [isFullscreen, mvPhase]);

  // Smooth 1.4s RGB palette interpolation via CSS vars on fullscreen container
  useEffect(() => {
    const el = fullscreenRootRef.current;
    if (!isFullscreen || !el) return;

    const startPrimary: [number, number, number] = [...currentRgbRef.current.primary];
    const startSecondary: [number, number, number] = [
      ...currentRgbRef.current.secondary,
    ];
    const targetPrimary = activePalette.rgbPrimary;
    const targetSecondary = activePalette.rgbSecondary;

    const applyVars = (
      p: [number, number, number],
      s: [number, number, number]
    ) => {
      const pR = Math.round(p[0]);
      const pG = Math.round(p[1]);
      const pB = Math.round(p[2]);
      const sR = Math.round(s[0]);
      const sG = Math.round(s[1]);
      const sB = Math.round(s[2]);
      el.style.setProperty('--fs-primary', `rgb(${pR}, ${pG}, ${pB})`);
      el.style.setProperty('--fs-secondary', `rgb(${sR}, ${sG}, ${sB})`);
      el.style.setProperty('--fs-primary-rgb', `${pR}, ${pG}, ${pB}`);
      el.style.setProperty('--fs-secondary-rgb', `${sR}, ${sG}, ${sB}`);
    };

    const durationMs = 1400;
    const startTime = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const rawT = Math.min(1, (now - startTime) / durationMs);
      // Cubic ease-in-out
      const t =
        rawT < 0.5
          ? 4 * rawT * rawT * rawT
          : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

      const curP: [number, number, number] = [
        startPrimary[0] + (targetPrimary[0] - startPrimary[0]) * t,
        startPrimary[1] + (targetPrimary[1] - startPrimary[1]) * t,
        startPrimary[2] + (targetPrimary[2] - startPrimary[2]) * t,
      ];
      const curS: [number, number, number] = [
        startSecondary[0] + (targetSecondary[0] - startSecondary[0]) * t,
        startSecondary[1] + (targetSecondary[1] - startSecondary[1]) * t,
        startSecondary[2] + (targetSecondary[2] - startSecondary[2]) * t,
      ];

      currentRgbRef.current = { primary: curP, secondary: curS };
      applyVars(curP, curS);

      if (rawT < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    applyVars(startPrimary, startSecondary);
    rafId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafId);
  }, [isFullscreen, activePalette]);

  const handleImportLrc = async (file: File) => {
    if (!currentTrack) return;
    try {
      const text = await file.text();
      await updateTrackLyrics(currentTrack.id, text);
    } catch {
      showToast('读取 .lrc 歌词文件失败');
    }
  };

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const displayTime = scrubProgress ?? currentTime;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (displayTime / effectiveDuration) * 100) : 0;

  if (isFullscreen) {
    const showInPageMv = Boolean(
      personalization.mvBackgroundEnabled !== false &&
        activeMv &&
        activeMvVideoUrl &&
        !personalization.mvStandaloneOnly &&
        !standaloneMvConnected
    );

    const triggerMvSkipOverlay = () => {
      if (mvPhase === 'normal' || !mvSkipLabel) return;
      setShowMvSkipOnTap(true);
      if (mvSkipTimerRef.current) window.clearTimeout(mvSkipTimerRef.current);
      mvSkipTimerRef.current = window.setTimeout(() => {
        setShowMvSkipOnTap(false);
      }, 3500);
    };

    return (
      <div
        ref={fullscreenRootRef}
        onClick={(e) => {
          if (mvPhase !== 'normal' && !(e.target as HTMLElement).closest('button, a, input')) {
            triggerMvSkipOverlay();
          }
        }}
        className="relative h-full w-full overflow-hidden"
      >
        {/* In-page MV Theater / Background Layer (automatically yields to standalone webpage if connected or standalone-only) */}
        {showInPageMv && activeMv && (
          <MvStageLayer
            src={activeMvVideoUrl}
            isPlaying={isPlaying}
            targetTime={mvTargetTime}
            playbackRate={1}
            muted={mvVideoMuted || muted}
            audioGain={mvAudioGain}
            volume={volume}
            blurPx={0}
            opacityPct={100}
            isTheaterClarity={true}
          />
        )}

        {/* Top-Left Corner Skip Intro / Mid-Break / Outro Button — strictly hidden until clicked/tapped */}
        {mvPhase !== 'normal' && mvSkipLabel && showMvSkipOnTap && (
          <div className="fixed top-5 left-5 z-40 flex items-center">
            <button
              type="button"
              onClick={() => {
                setShowMvSkipOnTap(false);
                skipMvPhase();
              }}
              className="min-h-[44px] px-4 py-2 rounded-2xl bg-black/68 hover:bg-black/85 backdrop-blur-xl border border-white/25 text-sm font-semibold text-white shadow-2xl flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
            >
              <SkipForward className="w-4 h-4" />
              <span>{mvSkipLabel}</span>
            </button>
          </div>
        )}

        {/* Transient top-right controls revealed briefly on pointer/touch activity (normal phase only) */}
        {mvPhase === 'normal' && (
        <div
          className={`fixed top-5 right-5 z-40 flex items-center gap-2 transition-opacity duration-300 ${
            showExitHint ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <a
            href="/?mvTheater=1"
            target="_blank"
            rel="opener"
            className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-black/48 hover:bg-black/68 backdrop-blur-xl border border-white/15 text-xs font-medium text-white/85 hover:text-white flex items-center gap-1.5 shadow-xl"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>独立网页播 MV</span>
          </a>

          <button
            type="button"
            onClick={async () => {
              await exitFullscreen();
              setActivePage('mv');
            }}
            className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-black/48 hover:bg-black/68 backdrop-blur-xl border border-white/15 text-xs font-medium text-white/85 hover:text-white flex items-center gap-1.5 shadow-xl cursor-pointer"
          >
            <Film className="w-3.5 h-3.5" />
            <span>MV 设置</span>
          </button>

          <button
            type="button"
            onClick={exitFullscreen}
            aria-label="退出全屏"
            title="退出全屏 (ESC)"
            className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-black/48 hover:bg-black/68 backdrop-blur-xl border border-white/15 text-xs font-medium text-white/85 hover:text-white flex items-center gap-1.5 shadow-xl cursor-pointer"
          >
            <Minimize2 className="w-4 h-4" />
            <span>退出全屏</span>
          </button>
        </div>
        )}

        {/* Strict 50 / 50 Left-Right Split Layout (fades smoothly out during Intro/Mid-Break/Outro) */}
        <div
          className="relative z-20 h-full w-full grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-rows-1 md:grid-cols-2"
          style={{
            opacity: mvUiOpacity,
            transition: 'opacity 110ms linear',
            pointerEvents: mvUiOpacity < 0.15 ? 'none' : 'auto',
          }}
        >
          {/* LEFT HALF: Upper Stationary Square Cover + Title & Artist, Lower Progress Bar & Transport Buttons */}
          <section className="relative h-full min-h-0 flex flex-col items-center justify-between px-6 sm:px-10 lg:px-14 py-4 sm:py-7 lg:py-10">
            {/* Upper area: Plain stationary album cover */}
            <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center">
              <FullscreenCoverFluidStage
                coverUrl={currentTrack?.coverDataUrl}
                title={currentTrack?.title || 'LUMINA MUSIC'}
                trackId={currentTrack?.id}
              />

              {/* Song Name & Artist right below Square Album Cover */}
              <div className="w-full max-w-[390px] text-center pt-3 px-2 shrink-0 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                <h2 className="font-display text-lg sm:text-xl font-semibold text-white truncate">
                  {currentTrack ? currentTrack.title : 'LUMINA MUSIC'}
                </h2>
                <p className="text-xs sm:text-sm text-white/80 truncate mt-0.5">
                  {currentTrack ? currentTrack.artist : '等待播放曲目'}
                </p>
              </div>
            </div>

            {/* Lower area of left half: Progress bar + [Prev | Play/Pause | Next] */}
            <div className="w-full max-w-[390px] shrink-0 pt-3 pb-1 sm:pb-2 space-y-5">
              <div className="w-full">
                <div className="relative flex items-center h-7">
                  <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                  <div
                    className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                    style={{
                      width: `${progressPct}%`,
                      background:
                        'linear-gradient(90deg, var(--fs-primary, #e8437f), var(--fs-secondary, #8b3dff))',
                      boxShadow:
                        '0 0 12px rgba(var(--fs-primary-rgb, 232, 67, 127), 0.58)',
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration || 100}
                    step={0.1}
                    value={Math.min(displayTime, effectiveDuration || 100)}
                    disabled={!currentTrack}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setScrubProgress(val);
                      seekTo(val);
                    }}
                    onPointerUp={(e) => {
                      seekTo(parseFloat(e.currentTarget.value));
                      setScrubProgress(null);
                    }}
                    onTouchEnd={(e) => {
                      seekTo(parseFloat(e.currentTarget.value));
                      setScrubProgress(null);
                    }}
                    aria-label="播放进度"
                    className="lumina-range w-full relative z-10"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-white/55 font-mono-tabular mt-1">
                  <span>{formatTime(displayTime)}</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-8 sm:gap-10">
                <button
                  type="button"
                  onClick={playPrev}
                  title="上一首"
                  aria-label="上一首"
                  className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <SkipBack className="w-6 h-6" fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={togglePlayPause}
                  title={isPlaying ? '暂停' : '播放'}
                  aria-label={isPlaying ? '暂停' : '播放'}
                  className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6" fill="currentColor" />
                  ) : (
                    <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => playNext(true)}
                  title="下一首"
                  aria-label="下一首"
                  className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <SkipForward className="w-6 h-6" fill="currentColor" />
                </button>
              </div>
            </div>
          </section>

          {/* RIGHT HALF: Vertically Centered 3-Line Real-Time Synced Lyrics */}
          <section className="relative h-full min-h-0 flex items-center justify-center px-6 sm:px-10 lg:px-14 py-6 sm:py-10">
            <FullscreenThreeLineLyrics
              lyricsRaw={currentTrack?.lyricsRaw}
              currentTime={currentTime}
              offsetMs={currentTrack?.lyricsOffsetMs || 0}
            />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden">
      {/* Top-Left Skip Phase Pill/Button when MV Theater Intro/Mid-Break/Outro is running while not fullscreen */}
      {mvSkipLabel && (
        <div className="fixed top-4 left-4 md:left-24 lg:left-64 z-40">
          <button
            type="button"
            onClick={skipMvPhase}
            className="min-h-[42px] px-4 py-2 rounded-2xl bg-black/75 hover:bg-black/90 backdrop-blur-xl border border-white/25 text-xs sm:text-sm font-semibold text-white shadow-2xl flex items-center gap-2 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
            <span>{mvSkipLabel}</span>
            {mvSkipSubLabel && (
              <span className="text-xs font-normal text-white/65">
                · {mvSkipSubLabel}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Main dual-column workspace */}
      <div
        className={`relative z-10 flex-1 min-h-0 w-full mx-auto grid items-center ${
          showLyricsInPlayer
            ? 'px-4 sm:px-6 lg:px-10 pt-3 sm:pt-5 pb-20 sm:pb-24 grid-cols-1 md:grid-cols-12 gap-6 lg:gap-10'
            : 'max-w-2xl px-4 sm:px-6 lg:px-10 pt-3 sm:pt-5 pb-20 sm:pb-24 grid-cols-1 gap-6 lg:gap-10'
        }`}
      >
        {/* Left Column: Vinyl Stage + Track Info + Transport Controls */}
        <section
          className={`relative flex flex-col items-center justify-center min-h-0 ${
            showLyricsInPlayer ? 'md:col-span-6 lg:col-span-5' : 'w-full'
          }`}
        >
          {/* Rotating Vinyl & Audio-Reactive Aura Stage */}
          <AlbumVinylStage
            coverUrl={currentTrack?.coverDataUrl}
            title={currentTrack?.title || 'LUMINA MUSIC'}
            trackId={currentTrack?.id}
            isPlaying={isPlaying}
            palette={activePalette}
            animationIntensity={personalization.animationIntensity}
            fullscreen={false}
            onChangeCover={
              currentTrack
                ? (file) => updateTrackCover(currentTrack.id, file)
                : undefined
            }
          />

          {/* Track Identity & Genuine Technical Metadata */}
          <div className="w-full text-center px-2 max-w-md mt-2 space-y-1.5">
            <div className="flex items-center justify-center gap-2">
              <h1 className="font-display font-semibold text-white truncate max-w-full text-xl sm:text-2xl lg:text-[26px]">
                {currentTrack ? currentTrack.title : '暂无播放曲目'}
              </h1>
              {currentTrack && (
                <button
                  type="button"
                  onClick={() => setTrackInfoEditOpen(true)}
                  title="修改文件名（歌曲名称与人物）"
                  aria-label="修改文件名（歌曲名称与人物）"
                  className="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="truncate text-sm text-white/70">
              {currentTrack
                ? `${currentTrack.artist} · ${currentTrack.album}`
                : '前往「我的音乐」导入本地音频文件'}
            </p>

            {currentTrack && (
              <p className="text-xs text-white/45 font-mono-tabular truncate">
                {currentTrack.format}
                {currentTrack.sampleRate
                  ? ` · ${formatSampleRate(currentTrack.sampleRate)}`
                  : ''}
                {currentTrack.bitsPerSample ? ` · ${currentTrack.bitsPerSample}-bit` : ''}
                {currentTrack.bitrate ? ` · ${formatBitrate(currentTrack.bitrate)}` : ''}
              </p>
            )}
          </div>

            {/* Control Deck */}
          <div className="w-full max-w-md mt-4 px-2">
            {/* Progress Scrubber (or MV Theater Phase Scrubber when active) */}
            {mvPhase !== 'normal' && activeMv ? (
              <div className="w-full">
                <div className="relative flex items-center h-7">
                  <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                  <div
                    className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                    style={{
                      width: `${
                        (activeMv.durationSec || 1) > 0
                          ? Math.min(100, (mvPhaseTime / Math.max(1, activeMv.durationSec || 1)) * 100)
                          : 0
                      }%`,
                      background: `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, activeMv.durationSec || 100)}
                    step={0.1}
                    value={Math.min(mvPhaseTime, Math.max(1, activeMv.durationSec || 100))}
                    onChange={(e) => seekMvTimeline(parseFloat(e.target.value))}
                    aria-label="MV 剧情进度条"
                    className="lumina-range w-full relative z-10"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-white/65 font-mono-tabular mt-1">
                  <span>MV {formatTime(mvPhaseTime)}</span>
                  <span>{formatTime(activeMv.durationSec || 0)}</span>
                </div>
              </div>
            ) : (
              <div className="w-full">
                <div className="relative flex items-center h-7">
                  <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                  <div
                    className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                    style={{
                      width: `${progressPct}%`,
                      background: `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration || 100}
                    step={0.1}
                    value={Math.min(displayTime, effectiveDuration || 100)}
                    disabled={!currentTrack}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setScrubProgress(val);
                      seekTo(val);
                    }}
                    onPointerUp={(e) => {
                      seekTo(parseFloat(e.currentTarget.value));
                      setScrubProgress(null);
                    }}
                    onTouchEnd={(e) => {
                      seekTo(parseFloat(e.currentTarget.value));
                      setScrubProgress(null);
                    }}
                    aria-label="播放进度"
                    className="lumina-range w-full relative z-10"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-white/55 font-mono-tabular mt-1">
                  <span>{formatTime(displayTime)}</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
              </div>
            )}

            {/* Primary Transport Controls */}
            <div className="w-full mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={toggleShuffle}
                title={
                  shuffle
                    ? '不重复随机已开启（整队列播完前不重复）'
                    : '开启不重复随机播放'
                }
                aria-label="随机播放"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer hover:bg-white/8"
                style={{ color: shuffle ? activePalette.primary : 'rgba(255,255,255,0.6)' }}
              >
                <Shuffle className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              </button>

              <button
                type="button"
                onClick={playPrev}
                title="上一首"
                aria-label="上一首"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
              </button>

              <button
                type="button"
                onClick={togglePlayPause}
                title={isPlaying ? '暂停' : '播放'}
                aria-label={isPlaying ? '暂停' : '播放'}
                className="rounded-full flex items-center justify-center text-white shadow-xl transition-transform active:scale-95 hover:scale-105 cursor-pointer w-14 h-14 sm:w-16 sm:h-16"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  boxShadow: `0 12px 34px ${activePalette.primary}75`,
                }}
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" />
                ) : (
                  <Play className="w-6 h-6 sm:w-7 sm:h-7 ml-0.5" fill="currentColor" />
                )}
              </button>

              <button
                type="button"
                onClick={() => playNext(true)}
                title="下一首"
                aria-label="下一首"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                title={
                  repeat === 'one'
                    ? '单曲循环'
                    : repeat === 'all'
                    ? '列表循环'
                    : '顺序播放'
                }
                aria-label="循环模式"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer hover:bg-white/8"
                style={{
                  color: repeat !== 'off' ? activePalette.primary : 'rgba(255,255,255,0.6)',
                }}
              >
                {repeat === 'one' ? (
                  <Repeat1 className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                ) : (
                  <Repeat className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                )}
              </button>
            </div>

            {/* Secondary Action Strip: Volume + Favorite + Queue + Lyrics + Fullscreen */}
            <div className="w-full mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 max-w-[165px]">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? '取消静音' : '静音'}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center text-white/65 hover:text-white transition-colors cursor-pointer"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  aria-label="音量"
                  className="lumina-range w-full"
                />
              </div>

              <div className="flex items-center gap-1">
                {!currentTrack && (
                  <button
                    type="button"
                    onClick={() => setActivePage('library')}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileMusic className="w-3.5 h-3.5" />
                    导入歌曲
                  </button>
                )}

                {currentTrack && (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(currentTrack.id)}
                    title={currentTrack.favorite ? '取消收藏' : '收藏歌曲'}
                    aria-label="收藏歌曲"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    style={{
                      color: currentTrack.favorite
                        ? activePalette.primary
                        : 'rgba(255,255,255,0.65)',
                    }}
                  >
                    <Heart
                      className="w-[18px] h-[18px]"
                      fill={currentTrack.favorite ? 'currentColor' : 'none'}
                    />
                  </button>
                )}

                  <>
                    <button
                      type="button"
                      onClick={() => setShowLyricsInPlayer(!showLyricsInPlayer)}
                      title={showLyricsInPlayer ? '隐藏歌词面板' : '显示歌词面板'}
                      aria-label="切换歌词显示"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                      style={{
                        color: showLyricsInPlayer
                          ? activePalette.primary
                          : 'rgba(255,255,255,0.65)',
                      }}
                    >
                      <MessageSquareText className="w-[18px] h-[18px]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setVocalMixerOpen((v) => !v)}
                      title="人声与伴奏独立调节"
                      aria-label="人声与伴奏独立调节"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                      style={{
                        color:
                          vocalMixerOpen ||
                          (audioSettings.stemModeActive && currentTrackStemMeta) ||
                          audioSettings.vocalAccompanimentBalance !== 0
                            ? activePalette.primary
                            : 'rgba(255,255,255,0.65)',
                      }}
                    >
                      <Mic2 className="w-[18px] h-[18px]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsQueueOpen(true)}
                      title="播放队列"
                      aria-label="打开播放队列"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <ListMusic className="w-[18px] h-[18px]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePage('mv')}
                      title="MV 剧场与独立网页播放"
                      aria-label="MV 剧场"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                      style={{
                        color: activeMv
                          ? activePalette.primary
                          : 'rgba(255,255,255,0.65)',
                      }}
                    >
                      <Film className="w-[18px] h-[18px]" />
                    </button>

                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      title="全屏展示"
                      aria-label="全屏展示"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-[18px] h-[18px]" />
                    </button>
                  </>
              </div>
            </div>
          </div>

          {/* Floating Vocal / Instrumental Quick Mixer Panel */}
          {vocalMixerOpen && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 w-full max-w-md p-4 rounded-2xl bg-[#190610]/94 backdrop-blur-2xl border border-white/18 shadow-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {currentTrackStemMeta
                    ? 'AI 分离双轨混音 (0% ~ 200%)'
                    : '人声与伴奏实时调节'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVocalMixerOpen(false)}
                    aria-label="关闭人声与伴奏调节"
                    className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {currentTrackStemMeta ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
                    <button
                      type="button"
                      onClick={() => updateAudioSettings({ stemModeActive: false })}
                      className={`py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        !audioSettings.stemModeActive
                          ? 'bg-white/16 text-white'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      原始音频
                    </button>
                    <button
                      type="button"
                      onClick={() => updateAudioSettings({ stemModeActive: true })}
                      className={`py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        audioSettings.stemModeActive
                          ? 'bg-gradient-to-r from-fuchsia-500/80 to-indigo-500/80 text-white'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      AI 分离音频
                    </button>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-fuchsia-200">Vocal · 人声</span>
                      <span className="font-mono-tabular text-white">
                        {audioSettings.vocalMuted ? '0% (静音)' : `${audioSettings.vocalGain}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={audioSettings.vocalMuted ? 0 : audioSettings.vocalGain}
                      onChange={(e) =>
                        updateAudioSettings({
                          stemModeActive: true,
                          vocalGain: Number(e.target.value),
                          vocalMuted: false,
                        })
                      }
                      aria-label="快捷人声音量"
                      className="lumina-range w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-indigo-200">Instrumental · 伴奏</span>
                      <span className="font-mono-tabular text-white">
                        {audioSettings.instrumentalMuted
                          ? '0% (静音)'
                          : `${audioSettings.instrumentalGain}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={
                        audioSettings.instrumentalMuted
                          ? 0
                          : audioSettings.instrumentalGain
                      }
                      onChange={(e) =>
                        updateAudioSettings({
                          stemModeActive: true,
                          instrumentalGain: Number(e.target.value),
                          instrumentalMuted: false,
                        })
                      }
                      aria-label="快捷伴奏音量"
                      className="lumina-range w-full"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <VocalBackgroundControl
                    balance={audioSettings.vocalAccompanimentBalance}
                    palette={activePalette}
                    compact
                    onChange={(val) =>
                      updateAudioSettings({
                        vocalAccompanimentBalance: val,
                        masterEnabled: true,
                        qualityMode:
                          audioSettings.qualityMode === 'original'
                            ? 'high'
                            : audioSettings.qualityMode,
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setVocalMixerOpen(false);
                      if (isFullscreen) await exitFullscreen();
                      setActivePage('audio');
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-fuchsia-500/20 to-indigo-500/25 hover:from-fuchsia-500/30 hover:to-indigo-500/35 border border-white/15 text-xs font-medium text-white/90 transition-colors cursor-pointer"
                  >
                    前往「音质与音效」执行真实 AI 人声伴奏分离 →
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Glassmorphic Real-Time Synced Lyrics Panel */}
        {showLyricsInPlayer && (
          <section className="md:col-span-6 lg:col-span-7 min-h-0 flex flex-col backdrop-blur-2xl transition-all duration-500 rounded-3xl bg-white/[0.045] border border-white/10 p-5 sm:p-7 shadow-[0_24px_70px_rgba(0,0,0,0.45)] h-[320px] md:h-[calc(100vh-140px)] max-h-[680px]">
            <LyricsView
              lyricsRaw={currentTrack?.lyricsRaw}
              currentTime={currentTime}
              offsetMs={currentTrack?.lyricsOffsetMs || 0}
              palette={activePalette}
              showBilingual={personalization.showBilingualLyrics}
              showWordSync={personalization.showWordSync}
              onSeek={seekTo}
              onAdjustOffset={
                currentTrack
                  ? (ms) => updateLyricsOffset(currentTrack.id, ms)
                  : undefined
              }
              onImportLrcFile={currentTrack ? handleImportLrc : undefined}
              onOpenSearchOnline={currentTrack ? () => setSearchOpen(true) : undefined}
              onOpenEditor={currentTrack ? () => setEditorOpen(true) : undefined}
              onTranslateLyrics={
                currentTrack ? () => translateTrackLyrics(currentTrack.id) : undefined
              }
              isTranslating={isTranslatingLyrics}
              compact
              immersive={false}
            />
          </section>
        )}
      </div>

      {/* Bottom Full-Width Liquid Wave Visualizer */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-0 overflow-hidden transition-all duration-500 h-24 sm:h-32">
        <LiquidWaveCanvas
          isPlaying={isPlaying}
          palette={activePalette}
          intensity={personalization.animationIntensity}
          visible={personalization.showLiquidWave}
        />
      </div>

      <LyricsSearchModal
        open={searchOpen}
        track={currentTrack}
        palette={activePalette}
        onClose={() => setSearchOpen(false)}
        onApplyLyrics={(raw) => {
          if (currentTrack) updateTrackLyrics(currentTrack.id, raw);
        }}
      />

      <LyricsEditorModal
        open={editorOpen}
        track={currentTrack}
        currentTime={currentTime}
        palette={activePalette}
        onClose={() => setEditorOpen(false)}
        onSave={(raw) => {
          if (currentTrack) updateTrackLyrics(currentTrack.id, raw);
        }}
      />

      <TrackInfoEditModal
        open={trackInfoEditOpen}
        track={currentTrack}
        palette={activePalette}
        onClose={() => setTrackInfoEditOpen(false)}
        onSave={updateTrackInfo}
      />
    </div>
  );
};
