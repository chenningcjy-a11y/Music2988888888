import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  ExternalLink,
  Film,
  FolderOpen,
  Layers,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { MvAudioWaveformBar } from '../components/visualizers/MvAudioWaveformBar';
import { MvTheaterAiAssistantCard } from '../components/visualizers/MvTheaterAiAssistantCard';
import { SongAudioWaveformBar } from '../components/visualizers/SongAudioWaveformBar';
import { useMusic } from '../context/MusicContext';
import { MvTheaterAiAnalysisResult } from '../services/ai/mvTheaterAiService';
import { MvMidBreakRange, TrackMvTimelineConfig } from '../types/music';
import { formatTime } from '../utils/constants';
import { createDefaultMvTimeline } from '../utils/mvTimeline';

type MvTab = 'timeline' | 'upload' | 'library' | 'display';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '在线链接';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MvPage: React.FC = () => {
  const {
    tracks,
    currentTrack,
    currentTime,
    duration,
    isPlaying,
    activePalette,
    personalization,
    updatePersonalization,
    trackMvs,
    allMvCountByTrack,
    activeMv,
    activeMvVideoUrl,
    mvPhase,
    standaloneMvConnected,
    playTrackById,
    seekTo,
    togglePlayPause,
    setActivePage,
    uploadTrackMvFile,
    bindTrackMvUrl,
    selectActiveTrackMv,
    updateTrackMvConfig,
    deleteTrackMv,
    restartTrackWithMvIntro,
    showToast,
  } = useMusic();

  const [activeTab, setActiveTab] = useState<MvTab>('timeline');
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  // Preview video element state inside timeline calibrator
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [scrubPreviewTime, setScrubPreviewTime] = useState<number | null>(null);
  const [musicGuideTime, setMusicGuideTime] = useState(0);
  const [aiAnalysis, setAiAnalysis] = useState<MvTheaterAiAnalysisResult | null>(
    null
  );
  const isScrubbingPreviewRef = useRef(false);
  const lastVideoSeekAtRef = useRef(0);
  const videoSwipeStartRef = useRef<{ x: number; startTime: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const timeline: TrackMvTimelineConfig = useMemo(
    () => activeMv?.timeline || createDefaultMvTimeline(),
    [activeMv]
  );

  // Keep preview duration synced with activeMv metadata
  useEffect(() => {
    setPreviewPlaying(false);
    setPreviewTime(0);
    setScrubPreviewTime(null);
    setAiAnalysis(null);
    isScrubbingPreviewRef.current = false;
    setPreviewDuration(activeMv?.durationSec || 0);
  }, [activeMv?.id, activeMv?.durationSec]);

  useEffect(() => {
    setMusicGuideTime(0);
    setAiAnalysis(null);
  }, [currentTrack?.id]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!currentTrack) {
      showToast('请先选择或播放一首曲目，再导入对应的 MV 视频');
      return;
    }
    const file = files[0];
    setUploading(true);
    try {
      await uploadTrackMvFile(currentTrack.id, file);
      setActiveTab('timeline');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入 MV 视频失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBindUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTrack) {
      showToast('请先选择一首曲目');
      return;
    }
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      await bindTrackMvUrl(currentTrack.id, urlInput.trim(), urlTitle.trim());
      setUrlInput('');
      setUrlTitle('');
      setActiveTab('timeline');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '绑定 MV 链接失败');
    } finally {
      setUploading(false);
    }
  };

  const patchTimeline = async (patch: Partial<TrackMvTimelineConfig>) => {
    if (!activeMv) return;
    await updateTrackMvConfig(activeMv.id, {
      timeline: {
        ...timeline,
        ...patch,
      },
    });
  };

  const addMidBreak = async () => {
    if (!activeMv) return;
    const baseAudio = Math.max(5, Math.round(currentTime || 45));
    const baseMvStart = Math.max(
      (timeline.introEnabled ? timeline.introEndSec : 0) + baseAudio,
      Math.round(previewTime || baseAudio + 10)
    );
    const newBreak: MvMidBreakRange = {
      id: `brk-${Date.now().toString(36)}`,
      label: `剧情插曲 ${(timeline.midBreaks?.length || 0) + 1}`,
      audioTriggerSec: baseAudio,
      mvStartSec: baseMvStart,
      mvEndSec: baseMvStart + 12,
    };
    await patchTimeline({
      midBreaks: [...(timeline.midBreaks || []), newBreak],
    });
    showToast('已添加中间无音频剧情段');
  };

  const updateMidBreak = async (
    breakId: string,
    patch: Partial<MvMidBreakRange>
  ) => {
    if (!activeMv) return;
    const next = (timeline.midBreaks || []).map((b) =>
      b.id === breakId ? { ...b, ...patch } : b
    );
    await patchTimeline({ midBreaks: next });
  };

  const removeMidBreak = async (breakId: string) => {
    if (!activeMv) return;
    const next = (timeline.midBreaks || []).filter((b) => b.id !== breakId);
    await patchTimeline({ midBreaks: next });
  };

  const togglePreviewPlay = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPreviewPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setPreviewPlaying(false);
    }
  };

  const seekPreviewTo = (t: number, immediateVideoSeek = false) => {
    const v = previewVideoRef.current;
    const maxDur =
      v && Number.isFinite(v.duration) && v.duration > 0
        ? v.duration
        : previewDuration || 100;
    const clamped = Math.max(0, Math.min(maxDur, t));
    setPreviewTime(clamped);
    if (!v) return;

    const now = performance.now();
    if (immediateVideoSeek || now - lastVideoSeekAtRef.current >= 90) {
      lastVideoSeekAtRef.current = now;
      try {
        if (typeof (v as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek === 'function' && !immediateVideoSeek) {
          (v as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(clamped);
        } else {
          v.currentTime = clamped;
        }
      } catch {
        // ignore seek before ready
      }
    }
  };

  const commitPreviewScrub = (finalTime?: number) => {
    isScrubbingPreviewRef.current = false;
    const target = finalTime ?? scrubPreviewTime ?? previewTime;
    setScrubPreviewTime(null);
    seekPreviewTo(target, true);
  };

  const displayPreviewTime = scrubPreviewTime ?? previewTime;
  const effectivePreviewDuration = Math.max(1, previewDuration || 1);
  const previewProgressPct = Math.min(
    100,
    Math.max(0, (displayPreviewTime / effectivePreviewDuration) * 100)
  );

  const trackDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const projectedMvGuideTime =
    currentTrack && timeline.introEnabled
      ? timeline.introEndSec + musicGuideTime
      : currentTrack
      ? musicGuideTime
      : null;

  const handlePlayMusicFromGuide = async (guideSec: number) => {
    if (!currentTrack) return;
    const pv = previewVideoRef.current;
    if (pv && !pv.paused) {
      pv.pause();
      setPreviewPlaying(false);
    }
    seekTo(guideSec);
    if (!isPlaying) {
      await togglePlayPause();
    }
  };

  const handleAlignGuideToCurrentMvFrame = async (guideSec: number) => {
    if (!activeMv) return;
    const computedIntroEnd = Number(Math.max(0, displayPreviewTime - guideSec).toFixed(2));
    await patchTimeline({
      introEnabled: computedIntroEnd > 0.05 ? true : timeline.introEnabled,
      introEndSec: computedIntroEnd,
    });
    showToast(
      `已将音乐 ${guideSec.toFixed(2)}s 对齐至 MV ${displayPreviewTime.toFixed(1)}s（前瞻终点 ${computedIntroEnd}s）`
    );
  };

  const handlePreviewVideoAt = async (mvTimeSec: number, autoPlay = true) => {
    if (isPlaying) {
      await togglePlayPause();
    }
    setScrubPreviewTime(null);
    seekPreviewTo(mvTimeSec, true);
    const pv = previewVideoRef.current;
    if (pv && autoPlay) {
      pv.muted = false;
      pv.play().then(() => setPreviewPlaying(true)).catch(() => {});
    }
  };

  const handleAuditionMusicAt = async (songTimeSec: number) => {
    setMusicGuideTime(songTimeSec);
    await handlePlayMusicFromGuide(songTimeSec);
  };

  const handleApplyAiIntro = async (introEndSec: number, recommended: boolean) => {
    await patchTimeline({
      introEnabled: recommended,
      introEndSec: recommended ? Number(introEndSec.toFixed(2)) : 0,
    });
    showToast(
      recommended
        ? `已确认并应用前瞻播放段：0:00 → ${introEndSec.toFixed(1)}s`
        : '已确认关闭前瞻播放段'
    );
  };

  const handleApplyAiOutro = async (outroEndSec: number, recommended: boolean) => {
    await patchTimeline({
      outroEnabled: recommended,
      outroEndSec: recommended ? Number(outroEndSec.toFixed(2)) : undefined,
    });
    showToast(
      recommended
        ? `已确认并应用后段尾声终点：${outroEndSec.toFixed(1)}s`
        : '已确认关闭后段尾声'
    );
  };

  const handleApplyAllAiSuggestions = async (res: MvTheaterAiAnalysisResult) => {
    await patchTimeline({
      introEnabled: res.intro.recommended,
      introEndSec: res.intro.recommended
        ? Number(res.intro.introEndSec.toFixed(2))
        : 0,
      outroEnabled: res.outro.recommended,
      outroEndSec: res.outro.recommended
        ? Number(res.outro.outroEndSec.toFixed(2))
        : undefined,
    });
    showToast('已确认并应用 AI 推荐的前瞻与后段配置');
  };

  return (
    <div className="h-full w-full overflow-y-auto lumina-scroll px-4 sm:px-8 py-6 pb-24 space-y-6">
      {/* Header Row */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/10 pb-5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${activePalette.primary}2e` }}
            >
              <Film className="w-5 h-5" style={{ color: activePalette.primary }} />
            </div>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight">
              MV 剧场与独立网页播放
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-white/60">
            在原网页保留本地音频与 MV 文件库，通过独立新网页渲染 MV 视频画面并支持前瞻、中段剧情与后段平滑对接。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Standalone Webpage Link (real anchor tag, avoids window.open) */}
          <a
            href="/?mvTheater=1"
            target="_blank"
            rel="opener"
            className="min-h-[44px] px-4 py-2 rounded-2xl text-sm font-semibold text-white flex items-center gap-2 shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
            }}
          >
            <ExternalLink className="w-4 h-4" />
            <span>在独立新网页播放 MV</span>
          </a>

          <button
            type="button"
            onClick={() =>
              updatePersonalization({
                mvStandaloneOnly: !personalization.mvStandaloneOnly,
              })
            }
            className={`min-h-[44px] px-3.5 py-2 rounded-2xl text-xs font-medium border transition-colors cursor-pointer ${
              personalization.mvStandaloneOnly
                ? 'bg-emerald-500/18 border-emerald-400/40 text-emerald-200'
                : 'bg-white/[0.05] border-white/12 text-white/75 hover:bg-white/[0.1]'
            }`}
          >
            {personalization.mvStandaloneOnly
              ? '仅独立网页播放：已开启'
              : '仅独立网页播放：关闭'}
          </button>
        </div>
      </header>

      {/* Active Track & Standalone Sync Status Strip */}
      <section className="rounded-2xl bg-white/[0.045] border border-white/10 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {currentTrack?.coverDataUrl ? (
            <img
              src={currentTrack.coverDataUrl}
              alt={currentTrack.title}
              className="w-12 h-12 rounded-xl object-cover shrink-0 border border-white/10"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-white/50" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white truncate">
                {currentTrack ? currentTrack.title : '未选择曲目'}
              </span>
              {currentTrack && (
                <span className="text-xs text-white/55">
                  · {currentTrack.artist} · 时长 {formatTime(trackDuration)}
                </span>
              )}
            </div>
            <p className="text-xs text-white/55 mt-0.5 truncate">
              {activeMv
                ? `当前 MV：${activeMv.title} (${formatTime(activeMv.durationSec)}) · 阶段：${
                    mvPhase === 'intro'
                      ? '前瞻播放中'
                      : mvPhase === 'mid-break'
                      ? '中间剧情播放中'
                      : mvPhase === 'outro'
                      ? '后段尾声播放中'
                      : isPlaying
                      ? '正常主歌对齐中'
                      : '待命'
                  }`
                : '当前歌曲尚未绑定 MV，请在下方导入本地视频文件或链接'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {tracks.length > 0 && (
            <select
              aria-label="切换配置曲目"
              value={currentTrack?.id || ''}
              onChange={(e) => {
                if (e.target.value) playTrackById(e.target.value);
              }}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#160710] text-white">
                  {t.title} - {t.artist}{' '}
                  {allMvCountByTrack[t.id] ? `(${allMvCountByTrack[t.id]} MV)` : ''}
                </option>
              ))}
            </select>
          )}

          <span className="text-xs px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white/75">
            {standaloneMvConnected
              ? '独立网页已连接同步 · 原网页仅留音频'
              : '独立网页未连接 · 点击右上角在新网页打开'}
          </span>
        </div>
      </section>

      {/* Navigation Tabs */}
      <nav
        aria-label="MV 管理分页"
        className="flex flex-wrap gap-2 border-b border-white/10 pb-3"
      >
        {[
          { id: 'timeline' as MvTab, label: '前瞻 / 中段 / 后段对齐', icon: Clock },
          { id: 'upload' as MvTab, label: '上传本地 MV / 链接', icon: Upload },
          {
            id: 'library' as MvTab,
            label: `已保存 MV 版本 (${trackMvs.length})`,
            icon: Layers,
          },
          { id: 'display' as MvTab, label: '画面与分离播放设置', icon: Sliders },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 py-2 rounded-2xl text-xs sm:text-sm font-medium flex items-center gap-2 border transition-colors cursor-pointer ${
                active
                  ? 'bg-white/14 border-white/25 text-white'
                  : 'bg-white/[0.03] border-white/10 text-white/65 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* TAB 1: TIMELINE CALIBRATION (Intro / Mid-Breaks / Outro) */}
      {activeTab === 'timeline' && (
        <div className="space-y-6">
          {!activeMv || !activeMvVideoUrl ? (
            <div className="space-y-4">
              <div className="rounded-3xl bg-white/[0.04] border border-dashed border-white/18 p-8 text-center space-y-4">
                <p className="text-sm text-white/75">
                  当前歌曲还没有可用 MV，请先上传视频文件（推荐 MP4 / WebM），即可开启前瞻、中段和后段剧情同步。
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className="min-h-[44px] px-5 py-2 rounded-2xl text-sm font-medium text-white inline-flex items-center gap-2 cursor-pointer"
                  style={{ backgroundColor: activePalette.primary }}
                >
                  <Upload className="w-4 h-4" />
                  <span>前往上传本地 MV</span>
                </button>
              </div>

              {currentTrack && (
                <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-5">
                  <SongAudioWaveformBar
                    trackId={currentTrack.id}
                    trackTitle={currentTrack.title}
                    durationSec={trackDuration}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    timeline={timeline}
                    palette={activePalette}
                    guideTime={musicGuideTime}
                    mvPreviewTime={displayPreviewTime}
                    onSeekAudio={seekTo}
                    onGuideChange={setMusicGuideTime}
                    onPlayFromGuide={handlePlayMusicFromGuide}
                    onTogglePlay={togglePlayPause}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <MvTheaterAiAssistantCard
                track={currentTrack}
                mv={activeMv}
                mvVideoUrl={activeMvVideoUrl}
                mvDurationSec={effectivePreviewDuration}
                songDurationSec={trackDuration}
                palette={activePalette}
                analysisResult={aiAnalysis}
                onAnalysisResult={setAiAnalysis}
                onPreviewVideoAt={handlePreviewVideoAt}
                onAuditionMusicAt={handleAuditionMusicAt}
                onApplyIntro={handleApplyAiIntro}
                onApplyOutro={handleApplyAiOutro}
                onApplyBoth={handleApplyAllAiSuggestions}
                onOpenAiCenter={() => setActivePage('ai')}
              />

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left 5 cols: 16:9 Frame Calibrator Video Preview */}
              <div className="xl:col-span-5 rounded-3xl bg-white/[0.04] border border-white/10 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/85">
                    视频帧定位预览器（支持进度条拖动与画面左右滑动）
                  </span>
                  <span className="text-xs font-mono-tabular text-white/75">
                    {formatTime(displayPreviewTime)} / {formatTime(previewDuration)}
                  </span>
                </div>

                <div
                  className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-white/10 touch-pan-y select-none cursor-ew-resize"
                  onPointerDown={(e) => {
                    videoSwipeStartRef.current = {
                      x: e.clientX,
                      startTime: displayPreviewTime,
                    };
                  }}
                  onPointerMove={(e) => {
                    if (!videoSwipeStartRef.current) return;
                    const dx = e.clientX - videoSwipeStartRef.current.x;
                    if (Math.abs(dx) < 4) return;
                    isScrubbingPreviewRef.current = true;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const deltaSec = (dx / Math.max(160, rect.width)) * Math.min(180, effectivePreviewDuration);
                    const nextT = Math.max(
                      0,
                      Math.min(effectivePreviewDuration, videoSwipeStartRef.current.startTime + deltaSec)
                    );
                    setScrubPreviewTime(nextT);
                    seekPreviewTo(nextT, false);
                  }}
                  onPointerUp={() => {
                    if (videoSwipeStartRef.current) {
                      videoSwipeStartRef.current = null;
                      if (isScrubbingPreviewRef.current) {
                        commitPreviewScrub();
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    videoSwipeStartRef.current = null;
                    if (isScrubbingPreviewRef.current) {
                      commitPreviewScrub();
                    }
                  }}
                >
                  <video
                    ref={previewVideoRef}
                    src={activeMvVideoUrl}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      const dur = e.currentTarget.duration;
                      if (Number.isFinite(dur) && dur > 0) {
                        setPreviewDuration(dur);
                        if (activeMv && (!activeMv.durationSec || Math.abs(activeMv.durationSec - dur) > 1)) {
                          updateTrackMvConfig(activeMv.id, { durationSec: dur });
                        }
                      }
                    }}
                    onTimeUpdate={(e) => {
                      if (!isScrubbingPreviewRef.current) {
                        setPreviewTime(e.currentTarget.currentTime);
                      }
                    }}
                    onPause={() => setPreviewPlaying(false)}
                    onPlay={() => setPreviewPlaying(true)}
                    className="w-full h-full object-contain bg-black pointer-events-none"
                  />
                </div>

                <div className="space-y-3">
                  {/* MV Audio Loudness Waveform Graph (click/drag to locate drops & silent segments) */}
                  <MvAudioWaveformBar
                    mvId={activeMv.id}
                    sourceType={activeMv.sourceType}
                    externalUrl={activeMv.externalUrl}
                    durationSec={effectivePreviewDuration}
                    currentTime={displayPreviewTime}
                    timeline={timeline}
                    palette={activePalette}
                    alignMarkerTime={projectedMvGuideTime}
                    aiSuggestedMarkers={
                      aiAnalysis
                        ? {
                            introEndSec: aiAnalysis.intro.recommended
                              ? aiAnalysis.intro.introEndSec
                              : undefined,
                            outroStartSec: aiAnalysis.outro.recommended
                              ? aiAnalysis.outro.outroStartSec
                              : undefined,
                            outroEndSec: aiAnalysis.outro.recommended
                              ? aiAnalysis.outro.outroEndSec
                              : undefined,
                          }
                        : null
                    }
                    onScrubStart={() => {
                      isScrubbingPreviewRef.current = true;
                    }}
                    onScrubMove={(t) => {
                      isScrubbingPreviewRef.current = true;
                      setScrubPreviewTime(t);
                      seekPreviewTo(t, false);
                    }}
                    onScrubCommit={(t) => {
                      commitPreviewScrub(t);
                    }}
                  />

                  {/* Smooth 60fps scrub bar with glowing progress track */}
                  <div className="relative flex items-center h-8">
                    <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                    <div
                      className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                      style={{
                        width: `${previewProgressPct}%`,
                        background: `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={effectivePreviewDuration}
                      step={0.1}
                      value={Math.min(displayPreviewTime, effectivePreviewDuration)}
                      onPointerDown={() => {
                        isScrubbingPreviewRef.current = true;
                      }}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        isScrubbingPreviewRef.current = true;
                        setScrubPreviewTime(val);
                        seekPreviewTo(val, false);
                      }}
                      onPointerUp={(e) =>
                        commitPreviewScrub(parseFloat(e.currentTarget.value))
                      }
                      onTouchEnd={(e) =>
                        commitPreviewScrub(parseFloat(e.currentTarget.value))
                      }
                      onBlur={() => {
                        if (isScrubbingPreviewRef.current) commitPreviewScrub();
                      }}
                      aria-label="预览视频时间轴"
                      className="lumina-range w-full relative z-10"
                    />
                  </div>

                  {/* Frame nudge buttons for pinpoint Intro / Mid-Break calibration */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {[-5, -1, 1, 5].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          onClick={() =>
                            seekPreviewTo(displayPreviewTime + delta, true)
                          }
                          className="min-h-[34px] px-2.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.15] border border-white/10 text-[11px] font-mono-tabular text-white/85 cursor-pointer"
                        >
                          {delta > 0 ? `+${delta}s` : `${delta}s`}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={togglePreviewPlay}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/12 hover:bg-white/20 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        {previewPlaying ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>暂停</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>播放预览</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          await restartTrackWithMvIntro();
                          setActivePage('player');
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                        style={{ backgroundColor: activePalette.primary }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>从前瞻播</span>
                      </button>
                    </div>
                  </div>

                  {/* Current Song Audio Waveform (读谱) + Interactive Alignment Guide Bar (辅助条) */}
                  {currentTrack && (
                    <SongAudioWaveformBar
                      trackId={currentTrack.id}
                      trackTitle={currentTrack.title}
                      durationSec={trackDuration}
                      currentTime={currentTime}
                      isPlaying={isPlaying}
                      timeline={timeline}
                      palette={activePalette}
                      guideTime={musicGuideTime}
                      mvPreviewTime={displayPreviewTime}
                      onSeekAudio={seekTo}
                      onGuideChange={setMusicGuideTime}
                      onPlayFromGuide={handlePlayMusicFromGuide}
                      onTogglePlay={togglePlayPause}
                      onAlignToMvFrame={handleAlignGuideToCurrentMvFrame}
                    />
                  )}
                </div>
              </div>

              {/* Right 7 cols: Intro / Mid-Breaks / Outro Rules */}
              <div className="xl:col-span-7 space-y-5">
                {/* 1. Intro / Pre-roll */}
                <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        1. 前瞻播放段（歌曲开始前的 MV 剧情）
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5">
                        开启后，将从 MV 0:00 完整清晰播放并保留视频原声，隐藏专辑、进度条、按钮与歌词；快到音乐开始前这些元素渐显出来、MV 变为虚化静音背景并与主歌对齐播放；左上角提供「跳过前瞻播放」。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        patchTimeline({ introEnabled: !timeline.introEnabled })
                      }
                      className={`min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                        timeline.introEnabled
                          ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                          : 'bg-white/[0.06] border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      {timeline.introEnabled ? '前瞻已开启' : '点击开启前瞻'}
                    </button>
                  </div>

                  {timeline.introEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/10">
                      <div className="space-y-1.5">
                        <label className="text-xs text-white/75 flex justify-between">
                          <span>音乐正式开始于 MV 第几秒</span>
                          <span className="font-mono-tabular text-white">
                            {timeline.introEndSec.toFixed(1)}s ({formatTime(timeline.introEndSec)})
                          </span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={Math.max(600, previewDuration || 600)}
                          step={0.1}
                          value={timeline.introEndSec}
                          onChange={(e) =>
                            patchTimeline({
                              introEndSec: Math.max(0, parseFloat(e.target.value) || 0),
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl bg-black/40 border border-white/15 text-sm text-white font-mono-tabular"
                        />
                      </div>

                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => {
                            patchTimeline({
                              introEndSec: Number(displayPreviewTime.toFixed(1)),
                            });
                            showToast(
                              `已将当前视频画面 ${displayPreviewTime.toFixed(1)}s 设为前瞻终点`
                            );
                          }}
                          className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/18 border border-white/15 text-xs font-medium text-white cursor-pointer"
                        >
                          以当前视频帧 ({displayPreviewTime.toFixed(1)}s) 设为前瞻终点
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Mid-Breaks */}
                <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        2. 中间无音频段（MV 间奏插曲 / 对白）
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5">
                        歌曲播到触发时间点时暂离歌声，UI 淡出并恢复 MV 清晰画面与视频声；左上角显示「跳过中段播放」，结束后UI渐显并精准继续对唱。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addMidBreak}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/12 hover:bg-white/20 border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>添加中段</span>
                    </button>
                  </div>

                  {(!timeline.midBreaks || timeline.midBreaks.length === 0) ? (
                    <p className="text-xs text-white/45 py-2">
                      暂无中间无音频段，若 MV 中间包含纯剧情暂停，请点击右上角「添加中段」。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {timeline.midBreaks.map((brk, idx) => (
                        <div
                          key={brk.id}
                          className="rounded-2xl bg-black/30 border border-white/10 p-3.5 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={brk.label || `中段 ${idx + 1}`}
                              onChange={(e) =>
                                updateMidBreak(brk.id, { label: e.target.value })
                              }
                              className="bg-transparent text-xs font-semibold text-white border-b border-white/15 focus:outline-none focus:border-white/40 pb-0.5"
                            />
                            <button
                              type="button"
                              onClick={() => removeMidBreak(brk.id)}
                              aria-label="删除中段"
                              className="p-1.5 rounded-lg text-white/55 hover:text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="space-y-1">
                              <span className="text-white/60 block">歌曲触发暂停 (秒)</span>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={brk.audioTriggerSec}
                                onChange={(e) =>
                                  updateMidBreak(brk.id, {
                                    audioTriggerSec: Math.max(
                                      0,
                                      parseFloat(e.target.value) || 0
                                    ),
                                  })
                                }
                                className="w-full min-h-[36px] px-2.5 rounded-lg bg-black/40 border border-white/15 text-white font-mono-tabular"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateMidBreak(brk.id, {
                                    audioTriggerSec: Number(currentTime.toFixed(1)),
                                  })
                                }
                                className="text-[11px] text-white/65 hover:text-white underline cursor-pointer"
                              >
                                设为当前歌曲时间 ({currentTime.toFixed(1)}s)
                              </button>
                            </div>

                            <div className="space-y-1">
                              <span className="text-white/60 block">MV 剧情开始 (秒)</span>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={brk.mvStartSec}
                                onChange={(e) =>
                                  updateMidBreak(brk.id, {
                                    mvStartSec: Math.max(
                                      0,
                                      parseFloat(e.target.value) || 0
                                    ),
                                  })
                                }
                                className="w-full min-h-[36px] px-2.5 rounded-lg bg-black/40 border border-white/15 text-white font-mono-tabular"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateMidBreak(brk.id, {
                                    mvStartSec: Number(displayPreviewTime.toFixed(1)),
                                  })
                                }
                                className="text-[11px] text-white/65 hover:text-white underline cursor-pointer"
                              >
                                设为当前视频帧 ({displayPreviewTime.toFixed(1)}s)
                              </button>
                            </div>

                            <div className="space-y-1">
                              <span className="text-white/60 block">MV 恢复唱歌 (秒)</span>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={brk.mvEndSec}
                                onChange={(e) =>
                                  updateMidBreak(brk.id, {
                                    mvEndSec: Math.max(
                                      0,
                                      parseFloat(e.target.value) || 0
                                    ),
                                  })
                                }
                                className="w-full min-h-[36px] px-2.5 rounded-lg bg-black/40 border border-white/15 text-white font-mono-tabular"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateMidBreak(brk.id, {
                                    mvEndSec: Number(displayPreviewTime.toFixed(1)),
                                  })
                                }
                                className="text-[11px] text-white/65 hover:text-white underline cursor-pointer"
                              >
                                设为当前视频帧 ({displayPreviewTime.toFixed(1)}s)
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Outro + Fine Alignment */}
                <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        3. 后段尾声（歌曲结束后的 MV 彩蛋 / 字幕）
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5">
                        歌曲音频播完后，如 MV 仍有剩余时长则自动进入无 UI 清晰原声播放；左上角支持「跳过后段播放」直达下一首。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        patchTimeline({ outroEnabled: !timeline.outroEnabled })
                      }
                      className={`min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                        timeline.outroEnabled
                          ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                          : 'bg-white/[0.06] border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      {timeline.outroEnabled ? '后段已开启' : '点击开启后段'}
                    </button>
                  </div>

                  {timeline.outroEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/10">
                      <div className="space-y-1.5">
                        <label className="text-xs text-white/75 flex justify-between">
                          <span>后段结束时间（留空则播到视频末尾）</span>
                          <span className="font-mono-tabular text-white">
                            {timeline.outroEndSec
                              ? `${timeline.outroEndSec.toFixed(1)}s`
                              : `视频末尾 (${formatTime(previewDuration)})`}
                          </span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          placeholder="留空默认播放到 MV 结束"
                          value={timeline.outroEndSec ?? ''}
                          onChange={(e) =>
                            patchTimeline({
                              outroEndSec:
                                e.target.value === ''
                                  ? undefined
                                  : Math.max(0, parseFloat(e.target.value) || 0),
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl bg-black/40 border border-white/15 text-sm text-white font-mono-tabular"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            patchTimeline({
                              outroEndSec: Number(displayPreviewTime.toFixed(1)),
                            })
                          }
                          className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/18 border border-white/15 text-xs font-medium text-white cursor-pointer"
                        >
                          以当前视频帧 ({displayPreviewTime.toFixed(1)}s) 设为后段终点
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-white/55 pt-2 border-t border-white/10">
                    说明：前瞻与中段结束前最后{' '}
                    <span className="text-white font-semibold">
                      {(personalization.mvUiFadeInSec ?? 1.0).toFixed(1)} 秒
                    </span>{' '}
                    自动渐显专辑与歌词；进入中段或后段前最后{' '}
                    <span className="text-white font-semibold">
                      {(personalization.mvUiFadeOutSec ?? 1.0).toFixed(1)} 秒
                    </span>{' '}
                    自动渐隐界面；MV 始终以 100% 原透明度与原画清晰度播放（可在「画面与分离播放设置」全局调整）。
                  </p>
                </div>
              </div>
            </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: UPLOAD LOCAL MV OR BIND URL */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <FolderOpen className="w-5 h-5" style={{ color: activePalette.primary }} />
              <h2 className="text-base font-semibold text-white">
                导入本地 MV 视频文件（保存在原网页 IndexedDB）
              </h2>
            </div>
            <p className="text-xs text-white/65 leading-relaxed">
              支持 MP4、WebM、MOV、M4V。视频文件保存在当前浏览器的本地数据库中，主网页保留音乐音频并在切换到「独立新网页播放」时无损跨标签页共享渲染，无需重复上传。
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading || !currentTrack}
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[120px] rounded-2xl border-2 border-dashed border-white/20 hover:border-white/40 bg-black/25 hover:bg-black/35 flex flex-col items-center justify-center gap-2 text-sm text-white/85 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-7 h-7" style={{ color: activePalette.primary }} />
              <span className="font-medium">
                {uploading
                  ? '正在解析并写入本地 MV 存储库...'
                  : currentTrack
                  ? `点击选择视频文件绑定到「${currentTrack.title}」`
                  : '请先选择一首歌曲'}
              </span>
            </button>
          </div>

          <form
            onSubmit={handleBindUrl}
            className="rounded-3xl bg-white/[0.04] border border-white/10 p-6 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <Link2 className="w-5 h-5" style={{ color: activePalette.secondary }} />
              <h2 className="text-base font-semibold text-white">
                绑定外部直链视频地址 (MP4 / WebM)
              </h2>
            </div>
            <p className="text-xs text-white/65 leading-relaxed">
              若您的 MV 托管在云存储 / CDN，可填写直接可播放的视频 URL。
            </p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="版本名称（可选，如：官方 4K 版 MV）"
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white placeholder:text-white/35"
              />
              <input
                type="url"
                required
                placeholder="https://example.com/video.mp4"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-black/40 border border-white/15 text-sm text-white placeholder:text-white/35"
              />
            </div>
            <button
              type="submit"
              disabled={uploading || !currentTrack}
              className="min-h-[44px] px-5 py-2 rounded-2xl text-sm font-medium text-white cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: activePalette.primary }}
            >
              保存 MV 直链
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: SAVED MV VERSIONS */}
      {activeTab === 'library' && (
        <div className="space-y-3">
          {trackMvs.length === 0 ? (
            <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-8 text-center text-sm text-white/60">
              当前歌曲暂无已保存的 MV 版本
            </div>
          ) : (
            trackMvs.map((mv) => (
              <div
                key={mv.id}
                className={`rounded-2xl p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  mv.isActive
                    ? 'bg-white/10 border-white/25'
                    : 'bg-white/[0.04] border-white/10'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {mv.title}
                    </span>
                    {mv.isActive && (
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-lg text-white"
                        style={{ backgroundColor: activePalette.primary }}
                      >
                        当前激活
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/55 font-mono-tabular">
                    时长 {formatTime(mv.durationSec)} · {formatBytes(mv.fileSizeBytes)} ·
                    前瞻 {mv.timeline.introEnabled ? `${mv.timeline.introEndSec}s` : '关闭'} ·
                    中段 {mv.timeline.midBreaks?.length || 0} 段 ·
                    后段 {mv.timeline.outroEnabled ? '开启' : '关闭'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!mv.isActive && currentTrack && (
                    <button
                      type="button"
                      onClick={() => selectActiveTrackMv(currentTrack.id, mv.id)}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/12 hover:bg-white/20 text-xs font-medium text-white cursor-pointer"
                    >
                      设为当前激活
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteTrackMv(mv.id)}
                    aria-label={`删除 ${mv.title}`}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-xs font-medium text-rose-200 cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: DISPLAY & STANDALONE PLAYBACK OPTIONS */}
      {activeTab === 'display' && (
        <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-6 space-y-5 max-w-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white">启用 MV 剧场与时间轴</h3>
              <p className="text-xs text-white/60 mt-0.5">
                开启后，歌曲全屏播放或独立 MV 网页将按配置自动运行前瞻、中段、后段与对齐同步。
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updatePersonalization({
                  mvBackgroundEnabled: personalization.mvBackgroundEnabled === false,
                })
              }
              className={`min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                personalization.mvBackgroundEnabled !== false
                  ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                  : 'bg-white/[0.06] border-white/15 text-white/65'
              }`}
            >
              {personalization.mvBackgroundEnabled !== false ? '已开启' : '已关闭'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t border-white/10">
            <div>
              <h3 className="text-sm font-semibold text-white">
                仅在独立新网页播放视频（原网页只保留音频）
              </h3>
              <p className="text-xs text-white/60 mt-0.5">
                开启后，原网页全屏时不再叠加渲染 video 图层，彻底避免复杂玻璃拟态与视频层冲突导致渲染失效；视频专门在新网页呈现。
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updatePersonalization({
                  mvStandaloneOnly: !personalization.mvStandaloneOnly,
                })
              }
              className={`min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                personalization.mvStandaloneOnly
                  ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                  : 'bg-white/[0.06] border-white/15 text-white/65'
              }`}
            >
              {personalization.mvStandaloneOnly ? '已开启' : '未开启'}
            </button>
          </div>

          {/* Global Auto Fade-In & Fade-Out Transition Durations (applies to all MVs) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div>
              <div className="flex justify-between text-xs text-white/75 mb-1.5">
                <span>全局 UI 自动渐显时间</span>
                <span className="font-mono-tabular text-white">
                  {(personalization.mvUiFadeInSec ?? 1.0).toFixed(1)} 秒
                </span>
              </div>
              <p className="text-[11px] text-white/50 mb-2">
                前瞻或中段结束前提前渐显专辑封面、进度条与歌词的时长（0.0 秒 = 立即切换）。
              </p>
              <div className="relative flex items-center h-7">
                <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                <div
                  className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                  style={{
                    width: `${((personalization.mvUiFadeInSec ?? 1.0) / 5.0) * 100}%`,
                    background: activePalette.primary,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={personalization.mvUiFadeInSec ?? 1.0}
                  onChange={(e) =>
                    updatePersonalization({
                      mvUiFadeInSec: parseFloat(e.target.value),
                    })
                  }
                  aria-label="全局 UI 自动渐显时间"
                  className="lumina-range w-full relative z-10"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-white/75 mb-1.5">
                <span>全局 UI 自动渐隐时间</span>
                <span className="font-mono-tabular text-white">
                  {(personalization.mvUiFadeOutSec ?? 1.0).toFixed(1)} 秒
                </span>
              </div>
              <p className="text-[11px] text-white/50 mb-2">
                进入中段剧情或后段尾声前自动渐隐播放器界面的时长（0.0 秒 = 立即隐藏）。
              </p>
              <div className="relative flex items-center h-7">
                <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                <div
                  className="absolute left-0 h-1.5 rounded-full pointer-events-none"
                  style={{
                    width: `${((personalization.mvUiFadeOutSec ?? 1.0) / 5.0) * 100}%`,
                    background: activePalette.secondary,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={personalization.mvUiFadeOutSec ?? 1.0}
                  onChange={(e) =>
                    updatePersonalization({
                      mvUiFadeOutSec: parseFloat(e.target.value),
                    })
                  }
                  aria-label="全局 UI 自动渐隐时间"
                  className="lumina-range w-full relative z-10"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 text-xs text-white/60 leading-relaxed">
            画质策略：已取消所有 MV 背景暗化、模糊与半透明降级，全阶段均以 100% 原透明度与原画清晰度直接播放。
          </div>
        </div>
      )}
    </div>
  );
};
