import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Cpu,
  Disc,
  ExternalLink,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { audioEngine } from '../../audio/AudioEngine';
import { useMusic } from '../../context/MusicContext';
import { useTaskCenter } from '../../context/TaskCenterContext';
import { SeparationEngineMode } from '../../types/music';
import { formatFileSize } from '../../utils/constants';

export const StemSeparationPanel: React.FC = () => {
  const {
    tracks,
    currentTrack,
    isPlaying,
    audioSettings,
    updateAudioSettings,
    stemMetas,
    currentTrackStemMeta,
    separationEngineMode,
    setSeparationEngineMode,
    removeTrackStems,
    togglePlayPause,
    setActivePage,
  } = useMusic();

  const {
    tasks,
    runningCount,
    queuedCount,
    enqueueStemSeparationTask,
    getActiveStemTaskForTrack,
    getLatestStemTaskForTrack,
    pauseTask,
    resumeTask,
    cancelTask,
    setSelectedTaskId,
  } = useTaskCenter();

  const [targetTrackId, setTargetTrackId] = useState<string>('');
  const [userPinnedTarget, setUserPinnedTarget] = useState(false);

  useEffect(() => {
    if (!userPinnedTarget && currentTrack?.id) {
      setTargetTrackId(currentTrack.id);
    } else if (!targetTrackId && tracks.length > 0) {
      setTargetTrackId(currentTrack?.id || tracks[0].id);
    }
  }, [currentTrack?.id, tracks, targetTrackId, userPinnedTarget]);

  const targetTrack = useMemo(
    () => tracks.find((t) => t.id === targetTrackId) || currentTrack || null,
    [tracks, targetTrackId, currentTrack]
  );

  const targetTrackStemMeta = useMemo(
    () => (targetTrack ? stemMetas[targetTrack.id] || null : null),
    [stemMetas, targetTrack]
  );

  const activeTaskForTarget = targetTrack
    ? getActiveStemTaskForTrack(targetTrack.id)
    : undefined;
  const latestTaskForTarget = targetTrack
    ? getLatestStemTaskForTrack(targetTrack.id)
    : undefined;

  const isTargetTaskActive = Boolean(activeTaskForTarget);
  const totalBackgroundStemTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.category === 'stem_separation' &&
          (t.status === 'running' || t.status === 'queued' || t.status === 'paused')
      ).length,
    [tasks]
  );

  const vocalMeterRef = useRef<HTMLDivElement | null>(null);
  const instMeterRef = useRef<HTMLDivElement | null>(null);
  const [vocalDbPct, setVocalDbPct] = useState(0);
  const [instDbPct, setInstDbPct] = useState(0);

  const hasCurrentStems = Boolean(currentTrackStemMeta);
  const stemsOutputActive = Boolean(audioSettings.stemModeActive && hasCurrentStems);

  // Real-time 60fps per-stem AnalyserNode level meters
  useEffect(() => {
    let rafId = 0;
    let smoothV = 0;
    let smoothI = 0;
    let frameCounter = 0;

    const tick = () => {
      const levels = audioEngine.getStemLevels();
      smoothV +=
        (levels.vocalLevel - smoothV) * (levels.vocalLevel > smoothV ? 0.35 : 0.14);
      smoothI +=
        (levels.instrumentalLevel - smoothI) *
        (levels.instrumentalLevel > smoothI ? 0.35 : 0.14);

      if (vocalMeterRef.current) {
        vocalMeterRef.current.style.width = `${Math.round(smoothV * 100)}%`;
      }
      if (instMeterRef.current) {
        instMeterRef.current.style.width = `${Math.round(smoothI * 100)}%`;
      }

      frameCounter++;
      if (frameCounter % 6 === 0) {
        setVocalDbPct(Math.round(smoothV * 100));
        setInstDbPct(Math.round(smoothI * 100));
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const vocalGain = Math.max(0, Math.min(200, Math.round(audioSettings.vocalGain ?? 100)));
  const instGain = Math.max(
    0,
    Math.min(200, Math.round(audioSettings.instrumentalGain ?? 100))
  );

  const ensurePlaying = async () => {
    if (!isPlaying && currentTrack) {
      await togglePlayPause();
    }
  };

  const handleSoloVocal = async () => {
    if (!hasCurrentStems) return;
    updateAudioSettings({
      stemModeActive: true,
      vocalGain: 100,
      vocalMuted: false,
      instrumentalGain: 0,
      instrumentalMuted: false,
    });
    await ensurePlaying();
  };

  const handleSoloInstrumental = async () => {
    if (!hasCurrentStems) return;
    updateAudioSettings({
      stemModeActive: true,
      vocalGain: 0,
      vocalMuted: false,
      instrumentalGain: 100,
      instrumentalMuted: false,
    });
    await ensurePlaying();
  };

  const handleMixedAudition = async () => {
    if (!hasCurrentStems) return;
    updateAudioSettings({
      stemModeActive: true,
      vocalGain: 100,
      vocalMuted: false,
      instrumentalGain: 100,
      instrumentalMuted: false,
    });
    await ensurePlaying();
  };

  const handleRestoreOriginal = () => {
    updateAudioSettings({
      stemModeActive: false,
    });
  };

  const handleReset100 = () => {
    updateAudioSettings({
      vocalGain: 100,
      instrumentalGain: 100,
      vocalMuted: false,
      instrumentalMuted: false,
    });
  };

  const isSoloVocal =
    stemsOutputActive &&
    !audioSettings.vocalMuted &&
    vocalGain > 0 &&
    (audioSettings.instrumentalMuted || instGain === 0);

  const isSoloInst =
    stemsOutputActive &&
    !audioSettings.instrumentalMuted &&
    instGain > 0 &&
    (audioSettings.vocalMuted || vocalGain === 0);

  const isMixed100 =
    stemsOutputActive &&
    !audioSettings.vocalMuted &&
    !audioSettings.instrumentalMuted &&
    vocalGain === 100 &&
    instGain === 100;

  return (
    <section className="rounded-3xl bg-[#160818]/70 backdrop-blur-2xl border border-white/14 p-5 sm:p-6 space-y-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      {/* Header + Standalone Original / Separated Toggle */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-fuchsia-500/25 via-pink-500/20 to-indigo-500/30 border border-white/15 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-fuchsia-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-semibold text-white">
                AI 人声与伴奏分离及独立调节
              </h2>
              <span className="text-[11px] font-mono-tabular text-fuchsia-200/80">
                UVR MDX-Net (Kim_Vocal_2)
              </span>
            </div>
            <p className="text-xs text-white/60 mt-1">
              分离任务由「AI 任务中心」按独立 Task ID 后台队列执行，切换播放器曲目不会更改或中断已有任务
            </p>
          </div>
        </div>

        {/* Standalone Toggle Switch: 原始音频 / 分离音频 (bound to live player track) */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-black/40 border border-white/12 shrink-0 self-start lg:self-auto">
          <button
            type="button"
            onClick={handleRestoreOriginal}
            className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              !stemsOutputActive
                ? 'bg-white/16 text-white shadow-sm border border-white/15'
                : 'text-white/60 hover:text-white'
            }`}
          >
            原始音频
          </button>
          <button
            type="button"
            disabled={!hasCurrentStems}
            onClick={() => updateAudioSettings({ stemModeActive: true })}
            title={
              hasCurrentStems
                ? '切换当前播放歌曲至 AI 分离双轨混音'
                : '请先对当前播放歌曲执行 AI 分离'
            }
            className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
              stemsOutputActive
                ? 'bg-gradient-to-r from-fuchsia-500/85 to-indigo-500/85 text-white shadow-lg border border-white/20'
                : 'text-white/60 hover:text-white'
            }`}
          >
            分离音频
          </button>
        </div>
      </div>

      {/* Background Queue Banner when tasks exist */}
      {totalBackgroundStemTasks > 0 && (
        <div className="rounded-2xl bg-white/[0.045] border border-white/12 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-white/80 font-mono-tabular">
            后台任务队列：正在运行 {runningCount} · 等待 / 暂停 {queuedCount}（切换曲目不受影响）
          </span>
          <button
            type="button"
            onClick={() => {
              if (activeTaskForTarget) setSelectedTaskId(activeTaskForTarget.id);
              setActivePage('tasks');
            }}
            className="text-fuchsia-200 hover:text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>前往 AI 任务中心查看队列</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Target Track Separation Status & Independent Task Controls */}
      <div className="rounded-2xl bg-black/30 border border-white/10 p-4 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Disc className="w-4 h-4 text-white/60 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/60 shrink-0">分离目标曲目：</span>
                {tracks.length > 0 ? (
                  <select
                    value={targetTrack?.id || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTargetTrackId(val);
                      setUserPinnedTarget(val !== currentTrack?.id);
                    }}
                    aria-label="选择要执行音源分离的目标曲目"
                    className="bg-white/8 border border-white/12 rounded-xl px-2.5 py-1 text-xs text-white outline-none max-w-[260px] truncate cursor-pointer"
                  >
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id} className="bg-[#1b0816] text-white">
                        {t.title} — {t.artist}
                        {currentTrack?.id === t.id ? ' (正在播放)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-white/50">尚未导入曲目</span>
                )}
              </div>

              <p className="text-[11px] text-white/50 truncate">
                {!targetTrack
                  ? '请先在「我的音乐」选择或导入一首歌曲'
                  : targetTrackStemMeta
                  ? `已完成分离 · ${
                      targetTrackStemMeta.engineUsed === 'local-webgpu'
                        ? '本地 WebGPU'
                        : targetTrackStemMeta.engineUsed === 'local-wasm'
                        ? '本地 WebAssembly'
                        : '服务端 ONNX'
                    } · 人声 ${formatFileSize(
                      targetTrackStemMeta.vocalSizeBytes
                    )} + 伴奏 ${formatFileSize(targetTrackStemMeta.instrumentalSizeBytes)}`
                  : '该曲目尚未分离音轨（点击「开始分离」将加入独立后台队列）'}
              </p>
            </div>
          </div>

          {/* Engine Mode Selector */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Cpu className="w-3.5 h-3.5 text-white/50" />
            <span className="text-[11px] text-white/55 whitespace-nowrap">推理引擎：</span>
            <select
              value={separationEngineMode}
              onChange={(e) =>
                setSeparationEngineMode(e.target.value as SeparationEngineMode)
              }
              aria-label="AI分离推理引擎"
              className="bg-white/8 border border-white/12 rounded-xl px-2.5 py-1.5 text-[11px] text-white outline-none cursor-pointer"
            >
              <option value="auto" className="bg-[#1b0816] text-white">
                自动（优先本地，受限转服务端）
              </option>
              <option value="local" className="bg-[#1b0816] text-white">
                仅本地浏览器 (WebGPU/WASM)
              </option>
              <option value="server" className="bg-[#1b0816] text-white">
                服务端 ONNX 接口
              </option>
            </select>
          </div>
        </div>

        {/* Separation Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {!isTargetTaskActive ? (
            <button
              type="button"
              disabled={!targetTrack}
              onClick={() =>
                targetTrack && void enqueueStemSeparationTask(targetTrack)
              }
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg transition-transform active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{
                background: 'linear-gradient(135deg, #e8437f, #7c3aed)',
              }}
            >
              {targetTrackStemMeta ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重新分离</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" fill="currentColor" />
                  <span>开始分离</span>
                </>
              )}
            </button>
          ) : (
            <>
              {(activeTaskForTarget?.status === 'running' ||
                activeTaskForTarget?.status === 'queued') && (
                <button
                  type="button"
                  onClick={() =>
                    activeTaskForTarget && void pauseTask(activeTaskForTarget.id)
                  }
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/12 hover:bg-white/18 border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>暂停</span>
                </button>
              )}

              {activeTaskForTarget?.status === 'paused' && (
                <button
                  type="button"
                  onClick={() =>
                    activeTaskForTarget && void resumeTask(activeTaskForTarget.id)
                  }
                  className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  style={{
                    background: 'linear-gradient(135deg, #e8437f, #7c3aed)',
                  }}
                >
                  <Play className="w-3.5 h-3.5" fill="currentColor" />
                  <span>继续分离</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  activeTaskForTarget && void cancelTask(activeTaskForTarget.id)
                }
                className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
              >
                <Square className="w-3.5 h-3.5" fill="currentColor" />
                <span>停止分离</span>
              </button>
            </>
          )}

          {targetTrackStemMeta && targetTrack && !isTargetTaskActive && (
            <button
              type="button"
              onClick={() => void removeTrackStems(targetTrack.id)}
              title="删除该曲目的分离音轨缓存"
              className="min-h-[40px] px-3 py-2 rounded-xl bg-white/6 hover:bg-white/12 border border-white/10 text-xs text-white/70 hover:text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清除缓存</span>
            </button>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleReset100}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs font-medium text-white/85 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>一键恢复 100% / 100%</span>
          </button>
        </div>

        {/* Live Progress Indicator STRICTLY for targetTrack's own activeTask */}
        {activeTaskForTarget && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-fuchsia-200 flex items-center gap-1.5 min-w-0 truncate">
                {activeTaskForTarget.status === 'running' && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                )}
                <span className="truncate">
                  {activeTaskForTarget.stageLabel || '正在处理'}
                  {activeTaskForTarget.stepLabel
                    ? ` · 分段 ${activeTaskForTarget.stepLabel}`
                    : ''}
                </span>
              </span>
              <div className="flex items-center gap-2.5 shrink-0 font-mono-tabular">
                {activeTaskForTarget.estimatedRemainingSec != null &&
                  activeTaskForTarget.estimatedRemainingSec > 0 &&
                  activeTaskForTarget.status === 'running' && (
                    <span className="text-white/55">
                      约剩 {activeTaskForTarget.estimatedRemainingSec}s
                    </span>
                  )}
                <span className="text-white/85 font-semibold">
                  {activeTaskForTarget.progress}%
                </span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.max(3, activeTaskForTarget.progress)}%`,
                  background: 'linear-gradient(90deg, #e8437f, #a855f7, #6366f1)',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/50">
              <span>归属任务：{activeTaskForTarget.sourceTrackTitle}</span>
              <span>{activeTaskForTarget.engineLabel || ''}</span>
            </div>
          </div>
        )}

        {/* Honest Error Feedback strictly for targetTrack's latest task */}
        {!activeTaskForTarget &&
          latestTaskForTarget &&
          (latestTaskForTarget.status === 'error' ||
            latestTaskForTarget.status === 'interrupted') &&
          latestTaskForTarget.errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/15 border border-rose-400/30 text-xs text-rose-100">
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-medium">
                  「{latestTaskForTarget.sourceTrackTitle}」AI 音源分离未能完成（未伪造分离效果）
                </p>
                <p className="text-rose-200/85 leading-relaxed">
                  {latestTaskForTarget.errorMessage}
                </p>
              </div>
            </div>
          )}
      </div>

      {/* Stacked Vocal (Pink-Purple) & Instrumental (Blue-Purple) Dual Track Controls */}
      <div className="space-y-4">
        {/* Track 1: Vocal (人声) - Pink-Purple */}
        <div
          className={`rounded-2xl p-4 border transition-all ${
            stemsOutputActive
              ? 'bg-gradient-to-r from-fuchsia-500/[0.12] via-pink-500/[0.06] to-transparent border-fuchsia-400/30'
              : 'bg-white/[0.03] border-white/10'
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() =>
                  updateAudioSettings({ vocalMuted: !audioSettings.vocalMuted })
                }
                title={audioSettings.vocalMuted ? '取消静音人声' : '静音人声'}
                aria-label={audioSettings.vocalMuted ? '取消静音人声' : '静音人声'}
                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors cursor-pointer shrink-0 ${
                  audioSettings.vocalMuted
                    ? 'bg-white/8 border-white/12 text-white/45'
                    : 'bg-fuchsia-500/25 border-fuchsia-400/40 text-fuchsia-200 hover:bg-fuchsia-500/35'
                }`}
              >
                {audioSettings.vocalMuted || vocalGain === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Mic2 className="w-3.5 h-3.5 text-fuchsia-300 shrink-0" />
                  <span className="text-sm font-semibold text-white">
                    Vocal · 人声轨道
                  </span>
                </div>
                <span className="text-[11px] text-white/50 block">
                  独立增益 0% ~ 200% · {audioSettings.vocalMuted ? '已静音' : '实时混音'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono-tabular text-xs text-fuchsia-200/75 hidden sm:inline">
                电平 {vocalDbPct}%
              </span>
              <span className="font-mono-tabular text-lg font-bold text-fuchsia-200 min-w-[54px] text-right">
                {audioSettings.vocalMuted ? '0%' : `${vocalGain}%`}
              </span>
            </div>
          </div>

          {/* 0% - 200% Vocal Slider */}
          <div className="relative h-7 flex items-center">
            <div className="absolute inset-x-0 h-2 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-3.5 bg-white/40 rounded-full pointer-events-none" />
            <div
              className="absolute left-0 h-2 rounded-full pointer-events-none transition-[width] duration-75"
              style={{
                width: `${audioSettings.vocalMuted ? 0 : (vocalGain / 200) * 100}%`,
                background: 'linear-gradient(90deg, #ec4899, #d946ef)',
                boxShadow: stemsOutputActive ? '0 0 12px rgba(236,72,153,0.65)' : undefined,
              }}
            />
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={audioSettings.vocalMuted ? 0 : vocalGain}
              onChange={(e) =>
                updateAudioSettings({
                  vocalGain: Number(e.target.value),
                  vocalMuted: false,
                })
              }
              aria-label="Vocal 人声音量百分比"
              className="lumina-range w-full relative z-10"
            />
          </div>

          {/* Real-time Vocal Output Level Meter */}
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="text-[10px] font-mono-tabular text-white/45 w-14 shrink-0">
              VOCAL OUT
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-black/45 overflow-hidden border border-white/5">
              <div
                ref={vocalMeterRef}
                className="h-full rounded-full transition-none"
                style={{
                  width: '0%',
                  background: 'linear-gradient(90deg, #f472b6, #e879f9, #fdf4ff)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Track 2: Instrumental (伴奏) - Blue-Purple */}
        <div
          className={`rounded-2xl p-4 border transition-all ${
            stemsOutputActive
              ? 'bg-gradient-to-r from-indigo-500/[0.14] via-violet-500/[0.07] to-transparent border-indigo-400/30'
              : 'bg-white/[0.03] border-white/10'
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() =>
                  updateAudioSettings({
                    instrumentalMuted: !audioSettings.instrumentalMuted,
                  })
                }
                title={audioSettings.instrumentalMuted ? '取消静音伴奏' : '静音伴奏'}
                aria-label={
                  audioSettings.instrumentalMuted ? '取消静音伴奏' : '静音伴奏'
                }
                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors cursor-pointer shrink-0 ${
                  audioSettings.instrumentalMuted
                    ? 'bg-white/8 border-white/12 text-white/45'
                    : 'bg-indigo-500/25 border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/35'
                }`}
              >
                {audioSettings.instrumentalMuted || instGain === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Music2 className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                  <span className="text-sm font-semibold text-white">
                    Instrumental · 伴奏轨道
                  </span>
                </div>
                <span className="text-[11px] text-white/50 block">
                  独立增益 0% ~ 200% ·{' '}
                  {audioSettings.instrumentalMuted ? '已静音' : '实时混音'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono-tabular text-xs text-indigo-200/75 hidden sm:inline">
                电平 {instDbPct}%
              </span>
              <span className="font-mono-tabular text-lg font-bold text-indigo-200 min-w-[54px] text-right">
                {audioSettings.instrumentalMuted ? '0%' : `${instGain}%`}
              </span>
            </div>
          </div>

          {/* 0% - 200% Instrumental Slider */}
          <div className="relative h-7 flex items-center">
            <div className="absolute inset-x-0 h-2 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-3.5 bg-white/40 rounded-full pointer-events-none" />
            <div
              className="absolute left-0 h-2 rounded-full pointer-events-none transition-[width] duration-75"
              style={{
                width: `${audioSettings.instrumentalMuted ? 0 : (instGain / 200) * 100}%`,
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                boxShadow: stemsOutputActive ? '0 0 12px rgba(99,102,241,0.65)' : undefined,
              }}
            />
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={audioSettings.instrumentalMuted ? 0 : instGain}
              onChange={(e) =>
                updateAudioSettings({
                  instrumentalGain: Number(e.target.value),
                  instrumentalMuted: false,
                })
              }
              aria-label="Instrumental 伴奏音量百分比"
              className="lumina-range w-full relative z-10"
            />
          </div>

          {/* Real-time Instrumental Output Level Meter */}
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="text-[10px] font-mono-tabular text-white/45 w-14 shrink-0">
              INST OUT
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-black/45 overflow-hidden border border-white/5">
              <div
                ref={instMeterRef}
                className="h-full rounded-full transition-none"
                style={{
                  width: '0%',
                  background: 'linear-gradient(90deg, #6366f1, #818cf8, #e0e7ff)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Audition Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <button
          type="button"
          disabled={!hasCurrentStems}
          onClick={handleSoloVocal}
          className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            isSoloVocal
              ? 'bg-fuchsia-500/25 border-fuchsia-400/50 text-white shadow-md'
              : 'bg-white/[0.04] border-white/10 text-white/75 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          仅人声试听
        </button>

        <button
          type="button"
          disabled={!hasCurrentStems}
          onClick={handleSoloInstrumental}
          className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            isSoloInst
              ? 'bg-indigo-500/25 border-indigo-400/50 text-white shadow-md'
              : 'bg-white/[0.04] border-white/10 text-white/75 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          仅伴奏试听
        </button>

        <button
          type="button"
          disabled={!hasCurrentStems}
          onClick={handleMixedAudition}
          className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            isMixed100
              ? 'bg-gradient-to-r from-fuchsia-500/25 to-indigo-500/25 border-white/35 text-white shadow-md'
              : 'bg-white/[0.04] border-white/10 text-white/75 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          人声与伴奏混合试听
        </button>

        <button
          type="button"
          onClick={handleRestoreOriginal}
          className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
            !stemsOutputActive
              ? 'bg-white/15 border-white/30 text-white'
              : 'bg-white/[0.04] border-white/10 text-white/75 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          恢复原始音频
        </button>
      </div>
    </section>
  );
};
