import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Disc,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Square,
} from 'lucide-react';
import { useAi } from '../../context/AiContext';
import { useMusic } from '../../context/MusicContext';
import { useTaskCenter } from '../../context/TaskCenterContext';
import {
  checkStemSeparationPreflight,
  inferClientModelCapabilities,
  IntentRouteResponse,
  requestDspTuningPlan,
  routeAssistantIntent,
  runLyricsAiTask,
  runMusicAnalysisTask,
  validateProviderForTask,
} from '../../services/ai';
import { DspPlanResponse } from '../../types/ai';
import { TrackMetadata } from '../../types/music';
import { formatFileSize, formatTime } from '../../utils/constants';

interface AssistantTurn {
  id: string;
  userPrompt: string;
  providerName: string;
  modelName: string;
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'error';
  progress: number;
  route?: IntentRouteResponse;
  dspPlan?: DspPlanResponse;
  dspApplied?: boolean;
  lyricsUpdatedText?: string;
  lyricsApplied?: boolean;
  analysisSummary?: string;
  stemTaskId?: string;
  error?: string;
}

interface AiAssistantTabProps {
  externalPromptTrigger?: { id: number; prompt: string } | null;
}

const QUICK_COMMANDS = [
  '帮我把当前歌曲的人声和伴奏分开。',
  '让人声更加清晰，降低伴奏音量。',
  '增强低音，但是不要影响人声。',
  '给这首歌增加一点空间感。',
  '帮我把当前歌词翻译成唯美的双语版本。',
  '分析当前歌曲的音乐风格与情绪。',
];

export const AiAssistantTab: React.FC<AiAssistantTabProps> = ({
  externalPromptTrigger,
}) => {
  const {
    currentTrack,
    currentTrackStemMeta,
    audioSettings,
    updateAudioSettings,
    updateTrackLyrics,
    setActivePage,
    activePalette,
    showToast,
  } = useMusic();

  const {
    enqueueStemSeparationTask,
    getActiveStemTaskForTrack,
    cancelTask,
    setSelectedTaskId,
  } = useTaskCenter();

  const {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    selectedModel,
    setSelectedModel,
    activeProvider,
    activeCapabilities,
    openAiCenter,
    beginTask,
    updateTask,
    finishTask,
    cancelActiveTask,
    activeTaskId,
  } = useAi();

  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [stemConfirmationReady, setStemConfirmationReady] = useState<{
    turnId: string;
    trackSnapshot: TrackMetadata;
    format: string;
    size: string;
    duration: string;
    serviceName: string;
  } | null>(null);

  const activeCurrentTrackStemTask = currentTrack
    ? getActiveStemTaskForTrack(currentTrack.id)
    : undefined;

  const runPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    const check = validateProviderForTask(activeProvider, selectedModel, 'text');
    const turnId = `turn-${Date.now()}`;
    const pName = activeProvider?.name || '未配置服务商';
    const mName = selectedModel || activeProvider?.model || '未选择模型';

    if (!check.ok || !activeProvider) {
      setTurns((prev) => [
        {
          id: turnId,
          userPrompt: trimmed,
          providerName: pName,
          modelName: mName,
          status: 'error',
          progress: 0,
          error: check.error || '请先在「API 服务管理」配置并启用 AI 服务商与 API Key',
        },
        ...prev,
      ]);
      return;
    }

    const { task, signal } = beginTask({
      taskName: `AI 助手：${trimmed.slice(0, 24)}`,
      category: 'intent_routing',
      providerName: pName,
      modelName: mName,
      track: currentTrack,
      trackTitle: currentTrack?.title,
      replayPayload: { prompt: trimmed, category: 'intent_routing' },
    });

    setTurns((prev) => [
      {
        id: turnId,
        userPrompt: trimmed,
        providerName: pName,
        modelName: mName,
        status: 'running',
        progress: 20,
      },
      ...prev,
    ]);

    try {
      const routeRes = await routeAssistantIntent({
        providerId: activeProvider.id,
        model: mName,
        prompt: trimmed,
        track: currentTrack,
        hasSeparatedStems: Boolean(currentTrackStemMeta),
        currentSettings: audioSettings,
        signal,
      });

      const plan = routeRes.plan;
      updateTask(task.id, { progress: 55 });

      if (plan.taskType === 'stem_separation') {
        const pre = await checkStemSeparationPreflight(currentTrack);
        if (!pre.ok || !currentTrack) {
          const errText =
            pre.error || plan.replyMessage || '当前不满足音源分离条件，请先选择歌曲并配置音源分离服务';
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? { ...t, status: 'error', progress: 0, route: routeRes, error: errText }
                : t
            )
          );
          finishTask(task.id, 'error', { errorMessage: errText });
          return;
        }

        setStemConfirmationReady({
          turnId,
          trackSnapshot: currentTrack,
          format: pre.format,
          size: formatFileSize(pre.fileSizeBytes),
          duration: formatTime(pre.durationSec),
          serviceName: pre.serviceName,
        });
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? { ...t, status: 'awaiting_confirmation', progress: 70, route: routeRes }
              : t
          )
        );
        finishTask(task.id, 'awaiting_confirmation', {
          resultSummary: `音源分离服务「${pre.serviceName}」已就绪，等待用户确认开始处理`,
        });
        return;
      }

      if (plan.taskType === 'dsp_tuning') {
        const dspPlan = await requestDspTuningPlan({
          providerId: activeProvider.id,
          model: mName,
          instruction: plan.dspInstruction || trimmed,
          currentSettings: audioSettings,
          track: currentTrack,
          hasSeparatedStems: Boolean(currentTrackStemMeta),
          signal,
        });
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: 'awaiting_confirmation',
                  progress: 100,
                  route: routeRes,
                  dspPlan,
                }
              : t
          )
        );
        finishTask(task.id, 'awaiting_confirmation', {
          resultSummary: dspPlan.explanation,
        });
        return;
      }

      if (plan.taskType === 'lyrics_assistant') {
        if (!currentTrack?.lyricsRaw?.trim()) {
          throw new Error('当前歌曲暂无歌词，无法执行歌词处理任务');
        }
        const action =
          plan.lyricsAction === 'detect-language' ||
          plan.lyricsAction === 'proofread' ||
          plan.lyricsAction === 'explain' ||
          plan.lyricsAction === 'timeline-align'
            ? plan.lyricsAction
            : 'translate';

        const lRes = await runLyricsAiTask({
          providerId: activeProvider.id,
          model: mName,
          action,
          rawLyrics: currentTrack.lyricsRaw,
          trackTitle: currentTrack.title,
          artistName: currentTrack.artist,
          durationSec: currentTrack.duration,
          signal,
        });

        const updatedText = lRes.bilingualLyrics || lRes.correctedLyrics;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: 'completed',
                  progress: 100,
                  route: routeRes,
                  lyricsUpdatedText: updatedText,
                  analysisSummary: lRes.result
                    ? JSON.stringify(lRes.result, null, 2)
                    : lRes.summary,
                }
              : t
          )
        );
        finishTask(task.id, 'completed', {
          resultSummary: lRes.summary || '已完成歌词处理',
        });
        return;
      }

      if (plan.taskType === 'audio_analysis') {
        if (!currentTrack) {
          throw new Error('请先选择一首曲目后再执行音乐分析');
        }
        const aType =
          plan.analysisType === 'instruments' || plan.analysisType === 'rhythm-audio'
            ? plan.analysisType
            : 'comprehensive';
        const needsAudio = aType === 'instruments' || aType === 'rhythm-audio';
        const capCheck = validateProviderForTask(
          activeProvider,
          mName,
          needsAudio ? 'audio' : 'text'
        );
        if (!capCheck.ok) {
          throw new Error(capCheck.error);
        }
        const aRes = await runMusicAnalysisTask({
          providerId: activeProvider.id,
          model: mName,
          track: currentTrack,
          analysisType: aType,
          includeAudioSignal: needsAudio,
          signal,
        });
        const summaryText = `风格：${aRes.result.genre} · 情绪：${aRes.result.mood}\n节奏：${aRes.result.rhythmAndTempo}\n${aRes.result.curatedSummary}`;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: 'completed',
                  progress: 100,
                  route: routeRes,
                  analysisSummary: summaryText,
                }
              : t
          )
        );
        finishTask(task.id, 'completed', {
          resultSummary: `${aRes.result.genre} · ${aRes.result.mood}`,
        });
        return;
      }

      // General Q&A
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, status: 'completed', progress: 100, route: routeRes }
            : t
        )
      );
      finishTask(task.id, 'completed', { resultSummary: plan.replyMessage });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const msg = isAbort
        ? '已取消任务'
        : err instanceof Error
        ? err.message
        : '执行失败';
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: isAbort ? 'cancelled' : 'error',
                progress: 0,
                error: msg,
              }
            : t
        )
      );
      finishTask(task.id, isAbort ? 'cancelled' : 'error', {
        errorMessage: msg,
      });
    }
  };

  useEffect(() => {
    if (externalPromptTrigger?.prompt) {
      setInput(externalPromptTrigger.prompt);
      void runPrompt(externalPromptTrigger.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPromptTrigger?.id]);

  const modelChoices = activeProvider
    ? Array.from(
        new Set(
          [activeProvider.model, ...(activeProvider.availableModels || [])].filter(
            Boolean
          )
        )
      )
    : [];

  return (
    <div className="space-y-5">
      {/* Top Bar: Provider, Model, Current Capability Summary */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1 text-xs">
            <span className="text-white/60 block">当前 AI 服务商</span>
            <select
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              aria-label="选择 AI 服务商"
              className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white outline-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#180713]">
                  {p.name}
                  {p.hasKey ? '' : '（未填密钥）'}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-white/60 block">当前模型</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="选择当前模型"
              className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
            >
              {modelChoices.map((m) => (
                <option key={m} value={m} className="bg-[#180713]">
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1 text-xs">
            <span className="text-white/60 block">当前播放曲目</span>
            <div className="px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-sm text-white truncate">
              {currentTrack ? `${currentTrack.title} · ${currentTrack.artist}` : '未加载曲目'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60 border-t border-white/8 pt-3">
          <span>
            模型能力：
            {activeCapabilities.textReasoning ? '自然语言调度 / 歌词 / 调音规划' : '未就绪'}
            {' · '}
            {activeCapabilities.audioInputAnalysis
              ? '支持音频流输入分析'
              : '纯文本（不支持直接解析音频波形）'}
            {' · '}
            音轨分离由独立分离服务执行
          </span>
          <button
            type="button"
            onClick={() => openAiCenter('providers')}
            className="text-white/80 hover:text-white underline cursor-pointer"
          >
            管理 API 与模型
          </button>
        </div>

        {/* Prompt Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = input;
            setInput('');
            void runPrompt(text);
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入自然语言音乐指令，例如：帮我把当前歌曲的人声和伴奏分开 / 增强低音但不影响人声…"
            className="flex-1 px-4 py-3 rounded-2xl bg-black/35 border border-white/15 text-sm text-white outline-none focus:border-white/40"
          />
          {!activeTaskId ? (
            <button
              type="submit"
              disabled={!input.trim()}
              className="min-h-[46px] px-5 py-2.5 rounded-2xl text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 shrink-0"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              <Send className="w-4 h-4" />
              <span>发送调度指令</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={cancelActiveTask}
              className="min-h-[46px] px-5 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Square className="w-3.5 h-3.5" fill="currentColor" />
              <span>取消当前任务</span>
            </button>
          )}
        </form>

        {/* Quick Command Suggestions */}
        <div className="flex flex-wrap gap-2">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => setInput(cmd)}
              className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/12 border border-white/10 text-xs text-white/75 hover:text-white cursor-pointer transition-colors"
            >
              {cmd}
            </button>
          ))}
        </div>
      </section>

      {/* Active Stem Separation Progress Bar strictly for currentTrack's own task */}
      {activeCurrentTrackStemTask && (
        <section className="rounded-2xl bg-white/[0.05] border border-fuchsia-400/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-fuchsia-200 flex items-center gap-2 min-w-0 truncate">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span className="truncate">
                {activeCurrentTrackStemTask.sourceTrackTitle} · {activeCurrentTrackStemTask.stageLabel}
              </span>
            </span>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="font-mono-tabular text-white">
                {activeCurrentTrackStemTask.progress}%
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedTaskId(activeCurrentTrackStemTask.id);
                  setActivePage('tasks');
                }}
                className="px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] cursor-pointer"
              >
                任务中心
              </button>
              <button
                type="button"
                onClick={() => void cancelTask(activeCurrentTrackStemTask.id)}
                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] cursor-pointer"
              >
                停止分离
              </button>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(4, activeCurrentTrackStemTask.progress)}%`,
                background: 'linear-gradient(90deg, #ec4899, #8b5cf6)',
              }}
            />
          </div>
        </section>
      )}

      {/* Assistant Execution Stream */}
      {turns.length === 0 ? (
        <section className="rounded-3xl bg-white/[0.03] border border-white/10 p-8 text-center space-y-2">
          <p className="text-sm font-medium text-white/80">
            欢迎使用 LUMINA AI 智能调度助手
          </p>
          <p className="text-xs text-white/50 max-w-xl mx-auto leading-relaxed">
            支持通过 DeepSeek / OpenAI / Gemini 等模型规划调音参数、处理歌词与识别需求，并严格校验模型能力与独立音源分离服务状态后再执行操作。
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) => {
            const capNote = inferClientModelCapabilities(
              activeProvider?.kind || 'deepseek',
              turn.modelName
            );
            return (
              <section
                key={turn.id}
                className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 space-y-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{turn.userPrompt}</p>
                    <p className="text-[11px] text-white/50 mt-0.5 font-mono-tabular">
                      {turn.providerName} · {turn.modelName} ·{' '}
                      {turn.status === 'running'
                        ? `处理中 (${turn.progress}%)`
                        : turn.status === 'awaiting_confirmation'
                        ? '等待用户确认执行'
                        : turn.status === 'completed'
                        ? '已完成'
                        : turn.status === 'cancelled'
                        ? '已取消'
                        : '执行失败'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void runPrompt(turn.userPrompt)}
                    disabled={Boolean(activeTaskId)}
                    className="px-3 py-1.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/80 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>重新执行</span>
                  </button>
                </div>

                {turn.status === 'running' && (
                  <div className="flex items-center gap-2 text-xs text-white/75">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>AI Task Manager 正在调度分析并校验能力…</span>
                  </div>
                )}

                {turn.error && (
                  <div className="rounded-xl bg-rose-500/12 border border-rose-400/25 p-3 text-xs text-rose-100 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                    <div className="space-y-1.5">
                      <p>{turn.error}</p>
                      <button
                        type="button"
                        onClick={() => openAiCenter('providers')}
                        className="underline text-white cursor-pointer"
                      >
                        检查 API 与音源服务配置 →
                      </button>
                    </div>
                  </div>
                )}

                {turn.route && (
                  <p className="text-xs sm:text-sm text-white/85 leading-relaxed">
                    {turn.route.plan.replyMessage}
                  </p>
                )}

                {/* Stem Separation Confirmation Card */}
                {turn.route?.plan.taskType === 'stem_separation' &&
                  stemConfirmationReady?.turnId === turn.id && (
                    <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-3 text-xs">
                      <p className="text-white/80">
                        已通过音频检查（{stemConfirmationReady.trackSnapshot.title}）：{stemConfirmationReady.format} · {stemConfirmationReady.size} ·{' '}
                        {stemConfirmationReady.duration} · 分离引擎：{stemConfirmationReady.serviceName}
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const snap = stemConfirmationReady.trackSnapshot;
                            const newTaskId = await enqueueStemSeparationTask(snap);
                            setTurns((prev) =>
                              prev.map((t) =>
                                t.id === turn.id
                                  ? {
                                      ...t,
                                      status: 'completed',
                                      progress: 100,
                                      stemTaskId: newTaskId,
                                    }
                                  : t
                              )
                            );
                          }}
                          className="min-h-[38px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                          style={{
                            background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                          }}
                        >
                          <Play className="w-3.5 h-3.5" fill="currentColor" />
                          <span>确认加入独立分离任务队列</span>
                        </button>
                        {turn.stemTaskId && (
                          <button
                            type="button"
                            onClick={() => {
                              if (turn.stemTaskId) setSelectedTaskId(turn.stemTaskId);
                              setActivePage('tasks');
                            }}
                            className="min-h-[38px] px-3.5 py-2 rounded-xl bg-white/12 text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>前往 AI 任务中心查看进度</span>
                          </button>
                        )}
                        {currentTrackStemMeta && (
                          <button
                            type="button"
                            onClick={() => setActivePage('player')}
                            className="min-h-[38px] px-3.5 py-2 rounded-xl bg-white/12 text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            <Disc className="w-3.5 h-3.5" />
                            <span>返回播放器调节双轨</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                {/* DSP Plan Confirmation Card */}
                {turn.dspPlan && (
                  <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-3 text-xs">
                    <p className="text-white/90 leading-relaxed">
                      {turn.dspPlan.explanation}
                    </p>
                    <pre className="whitespace-pre-wrap font-mono-tabular text-[11px] text-white/75 bg-black/25 p-3 rounded-xl border border-white/8">
                      {JSON.stringify(turn.dspPlan.patch, null, 2)}
                    </pre>
                    {turn.dspPlan.suggestStemSeparation && !currentTrackStemMeta && (
                      <p className="text-amber-200/90">
                        说明：{capNote.note ? '为避免 EQ 影响人声/伴奏干净度，建议执行 AI 音源分离后单独调节双轨增益。' : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (!turn.dspPlan) return;
                          updateAudioSettings(turn.dspPlan.patch);
                          setTurns((prev) =>
                            prev.map((t) =>
                              t.id === turn.id
                                ? { ...t, status: 'completed', dspApplied: true }
                                : t
                            )
                          );
                          showToast('已确认并将 AI 音效参数应用到播放器');
                        }}
                        className="min-h-[38px] px-4 py-2 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-100 font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>{turn.dspApplied ? '已应用到音效引擎' : '确认并执行音效调整'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePage('audio')}
                        className="min-h-[38px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-white/80 cursor-pointer"
                      >
                        前往音效设置
                      </button>
                    </div>
                  </div>
                )}

                {/* Lyrics Result Card */}
                {turn.lyricsUpdatedText && (
                  <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-2.5 text-xs">
                    <pre className="whitespace-pre-wrap font-sans text-white/90 max-h-48 overflow-y-auto lumina-scroll">
                      {turn.lyricsUpdatedText}
                    </pre>
                    {currentTrack && (
                      <button
                        type="button"
                        onClick={async () => {
                          await updateTrackLyrics(
                            currentTrack.id,
                            turn.lyricsUpdatedText || ''
                          );
                          setTurns((prev) =>
                            prev.map((t) =>
                              t.id === turn.id ? { ...t, lyricsApplied: true } : t
                            )
                          );
                          showToast('已将处理后的歌词应用到当前歌曲');
                        }}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/35 text-emerald-100 font-medium cursor-pointer"
                      >
                        {turn.lyricsApplied ? '已应用到当前曲目' : '应用到当前曲目歌词'}
                      </button>
                    )}
                  </div>
                )}

                {turn.analysisSummary && !turn.lyricsUpdatedText && (
                  <pre className="whitespace-pre-wrap font-sans text-xs text-white/85 bg-black/25 p-3.5 rounded-2xl border border-white/8 leading-relaxed">
                    {turn.analysisSummary}
                  </pre>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
