import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AudioLines,
  Check,
  Disc,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Music2,
  Pause,
  Play,
  Sliders,
  Sparkles,
  Square,
} from 'lucide-react';
import { useAi } from '../../context/AiContext';
import { useMusic } from '../../context/MusicContext';
import { useTaskCenter } from '../../context/TaskCenterContext';
import {
  checkStemSeparationPreflight,
  MusicAnalysisType,
  requestDspTuningPlan,
  runLyricsAiTask,
  runMusicAnalysisTask,
  TrackSeparationPreflight,
  validateProviderForTask,
} from '../../services/ai';
import { LyricsAiAction, LyricsAiResponse } from '../../services/ai/lyricsAiService';
import { AudioAnalysisResult, DspPlanResponse } from '../../types/ai';
import { formatFileSize, formatTime } from '../../utils/constants';
import { LyricsSearchModal } from '../lyrics/LyricsSearchModal';

type ToolboxSection = 'separation' | 'lyrics' | 'analysis' | 'dsp';

export const AiToolboxTab: React.FC = () => {
  const {
    tracks,
    currentTrack,
    currentTrackStemMeta,
    stemMetas,
    audioSettings,
    updateAudioSettings,
    updateTrackLyrics,
    updateLyricsOffset,
    setActivePage,
    activePalette,
    showToast,
  } = useMusic();

  const {
    enqueueStemSeparationTask,
    getActiveStemTaskForTrack,
    pauseTask,
    resumeTask,
    cancelTask,
    setSelectedTaskId,
    runningCount,
    queuedCount,
  } = useTaskCenter();

  const {
    activeProvider,
    selectedModel,
    activeStemService,
    openAiCenter,
    beginTask,
    finishTask,
    cancelActiveTask,
    activeTaskId,
  } = useAi();

  const [section, setSection] = useState<ToolboxSection>('separation');
  const [targetTrackId, setTargetTrackId] = useState<string>('');
  const [pinnedTarget, setPinnedTarget] = useState(false);
  const [preflight, setPreflight] = useState<TrackSeparationPreflight | null>(null);

  useEffect(() => {
    if (!pinnedTarget && currentTrack?.id) {
      setTargetTrackId(currentTrack.id);
    } else if (!targetTrackId && tracks.length > 0) {
      setTargetTrackId(currentTrack?.id || tracks[0].id);
    }
  }, [currentTrack?.id, tracks, targetTrackId, pinnedTarget]);

  const targetTrack =
    tracks.find((t) => t.id === targetTrackId) || currentTrack || null;
  const targetStemMeta = targetTrack
    ? stemMetas[targetTrack.id] || null
    : null;
  const activeStemTask = targetTrack
    ? getActiveStemTaskForTrack(targetTrack.id)
    : undefined;

  // Lyrics tool state
  const [lyricsAction, setLyricsAction] = useState<LyricsAiAction>('translate');
  const [targetLang, setTargetLang] = useState<'zh-CN' | 'zh-TW' | 'en' | 'ja'>('zh-CN');
  const [lyricsResult, setLyricsResult] = useState<LyricsAiResponse | null>(null);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Music analysis state
  const [analysisType, setAnalysisType] = useState<MusicAnalysisType>('comprehensive');
  const [analysisOutput, setAnalysisOutput] = useState<{
    providerName: string;
    modelUsed: string;
    result: AudioAnalysisResult;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Smart DSP state
  const [dspPrompt, setDspPrompt] = useState('');
  const [dspPlan, setDspPlan] = useState<DspPlanResponse | null>(null);
  const [dspError, setDspError] = useState<string | null>(null);
  const [dspApplied, setDspApplied] = useState(false);

  useEffect(() => {
    let active = true;
    checkStemSeparationPreflight(targetTrack).then((res) => {
      if (active) setPreflight(res);
    });
    return () => {
      active = false;
    };
  }, [targetTrack, activeStemService]);

  const isSeparating = Boolean(activeStemTask);

  const isRunningTask = Boolean(activeTaskId);

  const handleRunLyricsTool = async () => {
    setLyricsError(null);
    setLyricsResult(null);
    if (!currentTrack) {
      setLyricsError('请先选择一首歌曲');
      return;
    }
    const check = validateProviderForTask(activeProvider, selectedModel, 'text');
    if (!check.ok || !activeProvider) {
      setLyricsError(check.error || 'AI 服务商未就绪');
      return;
    }
    if (!currentTrack.lyricsRaw?.trim()) {
      setLyricsError('当前曲目暂无歌词，请先点击「在线搜索与匹配歌词」或导入 LRC 文件');
      return;
    }

    const modelName = selectedModel || activeProvider.model;
    const { task, signal } = beginTask({
      taskName: `歌词助手 · ${lyricsAction}`,
      category: 'lyrics_assistant',
      providerName: activeProvider.name,
      modelName,
      track: currentTrack,
      trackTitle: currentTrack.title,
    });

    try {
      const res = await runLyricsAiTask({
        providerId: activeProvider.id,
        model: modelName,
        action: lyricsAction,
        rawLyrics: currentTrack.lyricsRaw,
        trackTitle: currentTrack.title,
        artistName: currentTrack.artist,
        targetLanguage: targetLang,
        durationSec: currentTrack.duration,
        signal,
      });
      setLyricsResult(res);
      finishTask(task.id, 'completed', {
        resultSummary: res.summary || `已完成 ${lyricsAction} 处理`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '歌词处理失败';
      setLyricsError(msg);
      finishTask(task.id, 'error', { errorMessage: msg });
    }
  };

  const handleRunAnalysis = async () => {
    setAnalysisError(null);
    setAnalysisOutput(null);
    if (!currentTrack) {
      setAnalysisError('请先选择一首曲目');
      return;
    }
    const requiresAudio =
      analysisType === 'instruments' || analysisType === 'rhythm-audio';
    const check = validateProviderForTask(
      activeProvider,
      selectedModel,
      requiresAudio ? 'audio' : 'text'
    );
    if (!check.ok || !activeProvider) {
      setAnalysisError(check.error || '当前模型不满足该分析任务的能力要求');
      return;
    }

    const modelName = selectedModel || activeProvider.model;
    const { task, signal } = beginTask({
      taskName: `音乐分析 · ${
        analysisType === 'instruments'
          ? '乐器识别'
          : analysisType === 'rhythm-audio'
          ? '音频节奏分析'
          : '风格情绪整理'
      }`,
      category: 'audio_analysis',
      providerName: activeProvider.name,
      modelName,
      track: currentTrack,
      trackTitle: currentTrack.title,
    });

    try {
      const res = await runMusicAnalysisTask({
        providerId: activeProvider.id,
        model: modelName,
        track: currentTrack,
        analysisType,
        includeAudioSignal: requiresAudio,
        signal,
      });
      setAnalysisOutput(res);
      finishTask(task.id, 'completed', {
        resultSummary: `${res.result.genre} · ${res.result.mood}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '音乐分析失败';
      setAnalysisError(msg);
      finishTask(task.id, 'error', { errorMessage: msg });
    }
  };

  const handleGenerateDspPlan = async (customText?: string) => {
    const promptText = (customText ?? dspPrompt).trim();
    if (!promptText) {
      setDspError('请输入调音指令');
      return;
    }
    setDspError(null);
    setDspPlan(null);
    setDspApplied(false);

    const check = validateProviderForTask(activeProvider, selectedModel, 'text');
    if (!check.ok || !activeProvider) {
      setDspError(check.error || 'AI 服务商未就绪');
      return;
    }

    const modelName = selectedModel || activeProvider.model;
    const { task, signal } = beginTask({
      taskName: 'AI 智能调音规划',
      category: 'dsp_tuning',
      providerName: activeProvider.name,
      modelName,
      track: currentTrack,
      trackTitle: currentTrack?.title,
    });

    try {
      const plan = await requestDspTuningPlan({
        providerId: activeProvider.id,
        model: modelName,
        instruction: promptText,
        currentSettings: audioSettings,
        track: currentTrack,
        hasSeparatedStems: Boolean(currentTrackStemMeta),
        signal,
      });
      setDspPlan(plan);
      finishTask(task.id, 'completed', {
        resultSummary: plan.explanation,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成调音方案失败';
      setDspError(msg);
      finishTask(task.id, 'error', { errorMessage: msg });
    }
  };

  const applyGeneratedDspPlan = () => {
    if (!dspPlan) return;
    updateAudioSettings(dspPlan.patch);
    setDspApplied(true);
    showToast('已将 AI 调音方案实际应用至音频引擎');
  };

  return (
    <div className="space-y-5">
      {/* Sub-tool Selector */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {(
          [
            { id: 'separation', label: 'A. 人声与伴奏分离', icon: AudioLines },
            { id: 'lyrics', label: 'B. AI 歌词助手', icon: MessageSquareText },
            { id: 'analysis', label: 'C. AI 音乐分析', icon: Music2 },
            { id: 'dsp', label: 'D. AI 智能调音助手', icon: Sliders },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`min-h-[48px] px-4 py-3 rounded-2xl border text-xs sm:text-sm font-medium flex items-center gap-2.5 transition-all cursor-pointer ${
                active
                  ? 'bg-white/14 border-white/30 text-white shadow-lg'
                  : 'bg-white/[0.04] border-white/10 text-white/65 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={active ? { color: activePalette.primary } : undefined}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tool A: Vocal & Instrumental Separation */}
      {section === 'separation' && (
        <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                人声与伴奏分离工作流
              </h2>
              <p className="text-xs text-white/55 mt-0.5">
                每个分离任务分配独立 Task ID 后台运行，切换曲目或离开页面均不影响进度（后台活动任务：{runningCount + queuedCount}）
              </p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <button
                type="button"
                onClick={() => setActivePage('tasks')}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>打开 AI 任务中心</span>
              </button>
              <button
                type="button"
                onClick={() => openAiCenter('providers')}
                className="px-3 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/80 cursor-pointer whitespace-nowrap"
              >
                配置分离服务
              </button>
            </div>
          </div>

          {/* Preflight Check Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs border-y border-white/10 py-4">
            <div>
              <span className="text-white/45 block">选择目标歌曲</span>
              {tracks.length > 0 ? (
                <select
                  value={targetTrack?.id || ''}
                  onChange={(e) => {
                    setTargetTrackId(e.target.value);
                    setPinnedTarget(e.target.value !== currentTrack?.id);
                  }}
                  aria-label="选择要分离的曲目"
                  className="mt-1 w-full bg-white/8 border border-white/12 rounded-lg px-2 py-1 text-white outline-none truncate cursor-pointer"
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id} className="bg-[#180713] text-white">
                      {t.title} · {t.artist}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-white font-medium block mt-1">未选择</span>
              )}
            </div>
            <div>
              <span className="text-white/45 block">格式校验</span>
              <span className="text-white font-mono-tabular block mt-1.5">
                {preflight?.format || '-'}
              </span>
            </div>
            <div>
              <span className="text-white/45 block">文件大小与时长</span>
              <span className="text-white font-mono-tabular block mt-1.5">
                {targetTrack
                  ? `${formatFileSize(targetTrack.fileSize)} · ${formatTime(targetTrack.duration)}`
                  : '-'}
              </span>
            </div>
            <div>
              <span className="text-white/45 block">音源分离服务</span>
              <span className="text-white font-medium truncate block mt-1.5">
                {preflight?.serviceName || '未配置'}
              </span>
            </div>
          </div>

          {preflight && !preflight.ok && (
            <div className="rounded-2xl bg-rose-500/12 border border-rose-400/30 p-4 flex items-start gap-3 text-xs text-rose-100">
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{preflight.error}</p>
                <button
                  type="button"
                  onClick={() => openAiCenter('providers')}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/25 hover:bg-rose-500/35 text-white cursor-pointer"
                >
                  前往「API 服务管理」配置音源分离服务 →
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!isSeparating ? (
              <button
                type="button"
                disabled={!preflight?.ok || !targetTrack}
                onClick={async () => {
                  if (!targetTrack) return;
                  await enqueueStemSeparationTask(targetTrack);
                }}
                className="min-h-[42px] px-5 py-2.5 rounded-xl text-xs font-semibold text-white flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                <Play className="w-3.5 h-3.5" fill="currentColor" />
                <span>{targetStemMeta ? '重新创建分离任务' : '加入独立后台分离队列'}</span>
              </button>
            ) : (
              <>
                {activeStemTask?.status === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => activeStemTask && void resumeTask(activeStemTask.id)}
                    className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/12 hover:bg-white/18 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" fill="currentColor" />
                    <span>继续 ({activeStemTask.progress}%)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => activeStemTask && void pauseTask(activeStemTask.id)}
                    className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/12 hover:bg-white/18 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>暂停 ({activeStemTask?.progress || 0}%)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => activeStemTask && void cancelTask(activeStemTask.id)}
                  className="min-h-[42px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" fill="currentColor" />
                  <span>停止分离 ({activeStemTask?.progress || 0}%)</span>
                </button>
              </>
            )}

            {activeStemTask && (
              <button
                type="button"
                onClick={() => {
                  setSelectedTaskId(activeStemTask.id);
                  setActivePage('tasks');
                }}
                className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/85 cursor-pointer"
              >
                在任务详情页监控 →
              </button>
            )}

            {currentTrackStemMeta && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    updateAudioSettings({ stemModeActive: true });
                    setActivePage('player');
                  }}
                  className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/12 hover:bg-white/18 border border-white/18 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Disc className="w-4 h-4" />
                  <span>返回播放器</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage('audio')}
                  className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/85 cursor-pointer"
                >
                  前往音效控制台完整调节 →
                </button>
              </>
            )}
          </div>

          {activeStemTask && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-white/80">
                <span>
                  {activeStemTask.stageLabel}
                  {activeStemTask.stepLabel ? ` · ${activeStemTask.stepLabel}` : ''}
                </span>
                <span className="font-mono-tabular">
                  {activeStemTask.estimatedRemainingSec != null &&
                  activeStemTask.estimatedRemainingSec > 0 &&
                  activeStemTask.status === 'running'
                    ? `约剩 ${activeStemTask.estimatedRemainingSec}s · `
                    : ''}
                  {activeStemTask.progress}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(4, activeStemTask.progress)}%`,
                    background: 'linear-gradient(90deg, #ec4899, #8b5cf6)',
                  }}
                />
              </div>
            </div>
          )}

          {currentTrackStemMeta && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/10">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-fuchsia-200 font-medium">Vocal · 人声音量</span>
                  <span className="font-mono-tabular text-white">{audioSettings.vocalGain}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={audioSettings.vocalGain}
                  onChange={(e) =>
                    updateAudioSettings({
                      stemModeActive: true,
                      vocalGain: Number(e.target.value),
                      vocalMuted: false,
                    })
                  }
                  className="lumina-range w-full"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-indigo-200 font-medium">Instrumental · 伴奏音量</span>
                  <span className="font-mono-tabular text-white">{audioSettings.instrumentalGain}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={audioSettings.instrumentalGain}
                  onChange={(e) =>
                    updateAudioSettings({
                      stemModeActive: true,
                      instrumentalGain: Number(e.target.value),
                      instrumentalMuted: false,
                    })
                  }
                  className="lumina-range w-full"
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tool B: AI Lyrics Assistant */}
      {section === 'lyrics' && (
        <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                AI 歌词助手
              </h2>
              <p className="text-xs text-white/55 mt-0.5">
                严格区分纯文本歌词与带时间戳的 LRC 歌词，绝不虚构逐字时间轴
              </p>
            </div>

            <button
              type="button"
              disabled={!currentTrack}
              onClick={() => setSearchOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white cursor-pointer disabled:opacity-40 self-start"
            >
              歌词搜索与在线匹配
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'translate', label: '唯美双语翻译' },
                { id: 'detect-language', label: '语言与格式识别' },
                { id: 'proofread', label: '错别字与排版校对' },
                { id: 'explain', label: '意境内容解析' },
                { id: 'timeline-align', label: 'LRC 时间轴诊断' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLyricsAction(opt.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                  lyricsAction === opt.id
                    ? 'bg-white/16 border-white/30 text-white'
                    : 'bg-black/25 border-white/10 text-white/65 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {lyricsAction === 'translate' && (
              <select
                value={targetLang}
                onChange={(e) =>
                  setTargetLang(e.target.value as 'zh-CN' | 'zh-TW' | 'en' | 'ja')
                }
                aria-label="选择目标语言"
                className="px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-xs text-white outline-none ml-auto"
              >
                <option value="zh-CN" className="bg-[#180713]">简体中文（诗意）</option>
                <option value="zh-TW" className="bg-[#180713]">繁體中文（詩意）</option>
                <option value="en" className="bg-[#180713]">English</option>
                <option value="ja" className="bg-[#180713]">日本語</option>
              </select>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isRunningTask ? (
              <button
                type="button"
                onClick={handleRunLyricsTool}
                className="min-h-[40px] px-5 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                执行 AI 歌词处理
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelActiveTask}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-600 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>取消当前任务</span>
              </button>
            )}
            <span className="text-xs text-white/50">
              使用：{activeProvider?.name || '未配置'} · {selectedModel || activeProvider?.model || '-'}
            </span>
          </div>

          {lyricsError && (
            <div className="rounded-xl bg-rose-500/12 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200">
              {lyricsError}
            </div>
          )}

          {lyricsResult && (
            <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-white/60">
                <span>
                  {lyricsResult.providerName} · {lyricsResult.modelUsed} ·{' '}
                  {lyricsResult.isTimedLrc ? '带时间戳 LRC 歌词（已保留原时间标签）' : '纯文本歌词'}
                </span>
                {currentTrack && (lyricsResult.bilingualLyrics || lyricsResult.correctedLyrics) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const nextText =
                        lyricsResult.bilingualLyrics || lyricsResult.correctedLyrics || '';
                      if (!nextText) return;
                      await updateTrackLyrics(currentTrack.id, nextText);
                      showToast('已更新当前歌曲歌词');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/30 text-emerald-100 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>应用到当前曲目</span>
                  </button>
                )}
              </div>

              {(lyricsResult.bilingualLyrics || lyricsResult.correctedLyrics) && (
                <pre className="whitespace-pre-wrap font-sans text-white/90 leading-relaxed max-h-64 overflow-y-auto lumina-scroll bg-black/25 p-3 rounded-xl border border-white/8">
                  {lyricsResult.bilingualLyrics || lyricsResult.correctedLyrics}
                </pre>
              )}

              {lyricsResult.result && (
                <div className="space-y-2 text-white/85 leading-relaxed">
                  <pre className="whitespace-pre-wrap font-sans bg-black/25 p-3 rounded-xl border border-white/8">
                    {JSON.stringify(lyricsResult.result, null, 2)}
                  </pre>
                  {typeof lyricsResult.result.recommendedOffsetMs === 'number' &&
                    lyricsResult.result.recommendedOffsetMs !== 0 &&
                    currentTrack && (
                      <button
                        type="button"
                        onClick={async () => {
                          await updateLyricsOffset(
                            currentTrack.id,
                            Number(lyricsResult.result?.recommendedOffsetMs || 0)
                          );
                          showToast('已更新全局歌词时间偏移');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/12 hover:bg-white/18 text-white cursor-pointer"
                      >
                        应用推荐全局时间偏移 ({String(lyricsResult.result.recommendedOffsetMs)} ms)
                      </button>
                    )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Tool C: AI Music Analysis */}
      {section === 'analysis' && (
        <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">
              AI 音乐深度分析
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              「乐器识别」与「真实音频节奏分析」仅支持可接收音频输入的模型（如 Google Gemini），纯文本模型不可伪造听辨结果
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'comprehensive', label: '风格 · 情绪 · 歌曲信息整理' },
                { id: 'instruments', label: '真实音频乐器识别（需音频模型）' },
                { id: 'rhythm-audio', label: '真实音频节奏律动分析（需音频模型）' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAnalysisType(opt.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium border cursor-pointer ${
                  analysisType === opt.id
                    ? 'bg-white/16 border-white/30 text-white'
                    : 'bg-black/25 border-white/10 text-white/65 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {!isRunningTask ? (
              <button
                type="button"
                onClick={handleRunAnalysis}
                className="min-h-[40px] px-5 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                开始音乐分析
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelActiveTask}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-600 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>取消分析</span>
              </button>
            )}
          </div>

          {analysisError && (
            <div className="rounded-xl bg-rose-500/12 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200">
              {analysisError}
            </div>
          )}

          {analysisOutput && (
            <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-3 text-xs">
              <div className="text-white/55">
                {analysisOutput.providerName} · {analysisOutput.modelUsed} ·{' '}
                {analysisOutput.result.analyzedFromAudio
                  ? '已基于真实音频波形片段完成分析'
                  : '基于曲目元信息与歌词文本推理（未使用音频信号）'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <span className="text-white/45 block">音乐风格</span>
                  <span className="text-sm font-medium text-white mt-0.5 block">
                    {analysisOutput.result.genre}
                  </span>
                </div>
                <div>
                  <span className="text-white/45 block">核心情绪</span>
                  <span className="text-sm font-medium text-white mt-0.5 block">
                    {analysisOutput.result.mood}
                  </span>
                </div>
                <div>
                  <span className="text-white/45 block">节奏特征</span>
                  <span className="text-sm font-medium text-white mt-0.5 block">
                    {analysisOutput.result.rhythmAndTempo}
                  </span>
                </div>
              </div>
              {analysisOutput.result.instruments?.length > 0 && (
                <div>
                  <span className="text-white/45 block">识别要素 / 乐器编配</span>
                  <p className="text-white/85 mt-1">
                    {analysisOutput.result.instruments.join(' · ')}
                  </p>
                </div>
              )}
              <div>
                <span className="text-white/45 block">综合乐评与档案整理</span>
                <p className="text-white/90 leading-relaxed mt-1">
                  {analysisOutput.result.curatedSummary}
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tool D: AI Smart Tuning Assistant */}
      {section === 'dsp' && (
        <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">
              AI 智能调音助手
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              用自然语言描述目标听感，AI 将生成精确的参数调整建议，经您确认后由 Web Audio 引擎实际执行
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              '让人声更加清晰，降低伴奏音量',
              '增强低音，但是不要影响人声',
              '给这首歌增加一点空间感',
              '让高频更通透明亮，减少闷糊感',
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setDspPrompt(sample)}
                className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/12 border border-white/10 text-xs text-white/75 hover:text-white cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={dspPrompt}
              onChange={(e) => setDspPrompt(e.target.value)}
              placeholder="输入调音需求，例如：增强低音，但是不要影响人声…"
              className="flex-1 px-4 py-3 rounded-2xl bg-black/35 border border-white/15 text-sm text-white outline-none focus:border-white/40"
            />
            {!isRunningTask ? (
              <button
                type="button"
                onClick={() => handleGenerateDspPlan()}
                className="min-h-[44px] px-5 py-2.5 rounded-2xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                <Sparkles className="w-4 h-4" />
                <span>生成调音方案</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelActiveTask}
                className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-rose-600 text-xs font-semibold text-white cursor-pointer shrink-0"
              >
                取消
              </button>
            )}
          </div>

          {dspError && (
            <div className="rounded-xl bg-rose-500/12 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200">
              {dspError}
            </div>
          )}

          {dspPlan && (
            <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-3 text-xs">
              <div className="text-white/55">
                {dspPlan.providerName} · {dspPlan.modelUsed}（等待您的确认后再执行）
              </div>
              <p className="text-sm text-white leading-relaxed">{dspPlan.explanation}</p>

              <pre className="whitespace-pre-wrap font-mono-tabular text-[11px] text-white/80 bg-black/30 p-3 rounded-xl border border-white/8">
                {JSON.stringify(dspPlan.patch, null, 2)}
              </pre>

              {dspPlan.suggestStemSeparation && !currentTrackStemMeta && (
                <p className="text-amber-200/90">
                  提示：当前歌曲尚未执行 AI 人声分离，建议先完成「人声与伴奏分离」以获得更干净的独立人声/伴奏音量比例控制。
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={applyGeneratedDspPlan}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/40 text-xs font-semibold text-emerald-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{dspApplied ? '已应用到播放器音效' : '确认并实际应用音效'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage('audio')}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs text-white/80 cursor-pointer"
                >
                  打开音效设置查看参数变化
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {currentTrack && (
        <LyricsSearchModal
          open={searchOpen}
          track={currentTrack}
          palette={activePalette}
          onClose={() => setSearchOpen(false)}
          onApplyLyrics={(raw) => updateTrackLyrics(currentTrack.id, raw)}
        />
      )}
    </div>
  );
};
