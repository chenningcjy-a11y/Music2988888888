import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Eye,
  Film,
  Loader2,
  Music2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import {
  MvTheaterAiAnalysisResult,
  runMvTheaterAiAnalysis,
} from '../../services/ai/mvTheaterAiService';
import { fetchProviders, saveProvider } from '../../services/ai/providerManager';
import { AiProviderConfig } from '../../types/ai';
import {
  TrackColorPalette,
  TrackMetadata,
  TrackMvMeta,
} from '../../types/music';
import { formatTime } from '../../utils/constants';

interface MvTheaterAiAssistantCardProps {
  track: TrackMetadata | null;
  mv: TrackMvMeta;
  mvVideoUrl: string;
  mvDurationSec: number;
  songDurationSec: number;
  palette: TrackColorPalette;
  analysisResult: MvTheaterAiAnalysisResult | null;
  onAnalysisResult: (res: MvTheaterAiAnalysisResult | null) => void;
  onPreviewVideoAt: (mvTimeSec: number, autoPlay?: boolean) => void;
  onAuditionMusicAt: (songTimeSec: number) => void;
  onApplyIntro: (introEndSec: number, recommended: boolean) => void;
  onApplyOutro: (outroEndSec: number, recommended: boolean) => void;
  onApplyBoth: (res: MvTheaterAiAnalysisResult) => void;
  onOpenAiCenter: () => void;
}

const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', { text: string; cls: string }> = {
  high: {
    text: '高置信度',
    cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/35',
  },
  medium: {
    text: '中置信度',
    cls: 'bg-sky-500/20 text-sky-200 border-sky-400/35',
  },
  low: {
    text: '低置信度（请重点试听核对）',
    cls: 'bg-amber-500/20 text-amber-200 border-amber-400/35',
  },
};

export const MvTheaterAiAssistantCard: React.FC<MvTheaterAiAssistantCardProps> = ({
  track,
  mv,
  mvVideoUrl,
  mvDurationSec,
  songDurationSec,
  palette,
  analysisResult,
  onAnalysisResult,
  onPreviewVideoAt,
  onAuditionMusicAt,
  onApplyIntro,
  onApplyOutro,
  onApplyBoth,
  onOpenAiCenter,
}) => {
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [builtinGeminiAvailable, setBuiltinGeminiAvailable] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingProviders, setLoadingProviders] = useState(true);

  // Custom API key quick drawer state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customKind, setCustomKind] = useState<'deepseek' | 'gemini' | 'openai-compatible'>('deepseek');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('deepseek-chat');
  const [savingCustom, setSavingCustom] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [stageText, setStageText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProvidersList = async (preferredId?: string) => {
    setLoadingProviders(true);
    try {
      const res = await fetchProviders();
      const enabledReady = res.providers.filter((p) => p.enabled && p.hasKey);
      setProviders(enabledReady);
      setBuiltinGeminiAvailable(Boolean(res.builtinGeminiAvailable));

      if (preferredId) {
        setSelectedProviderId(preferredId);
        const match = enabledReady.find((p) => p.id === preferredId);
        if (match) setSelectedModel(match.model);
        setLoadingProviders(false);
        return;
      }

      if (res.defaultProviderId) {
        const def = enabledReady.find((p) => p.id === res.defaultProviderId);
        if (def) {
          setSelectedProviderId(def.id);
          setSelectedModel(def.model);
          setLoadingProviders(false);
          return;
        }
      }
      if (enabledReady.length > 0) {
        setSelectedProviderId(enabledReady[0].id);
        setSelectedModel(enabledReady[0].model);
      } else if (res.builtinGeminiAvailable) {
        setSelectedProviderId('__builtin_gemini__');
        setSelectedModel('gemini-4-hydrogen');
      }
    } catch {
      // ignore
    } finally {
      setLoadingProviders(false);
    }
  };

  useEffect(() => {
    loadProvidersList();
  }, []);

  const currentProvider = providers.find((p) => p.id === selectedProviderId);
  const availableModels: string[] =
    selectedProviderId === '__builtin_gemini__'
      ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']
      : currentProvider
      ? Array.from(
          new Set([currentProvider.model, ...(currentProvider.availableModels || [])].filter(Boolean))
        )
      : [];

  const handleAnalyze = async () => {
    if (!track || !mvVideoUrl) return;
    if (selectedProviderId === '__custom_api_key__') {
      setShowCustomModal(true);
      return;
    }

    setAnalyzing(true);
    setErrorMsg(null);
    setStageText('正在读取 MV 与歌曲波形...');
    try {
      const result = await runMvTheaterAiAnalysis({
        providerId: selectedProviderId || undefined,
        model: selectedModel || undefined,
        track,
        mv,
        mvVideoUrl,
        mvDurationSec,
        songDurationSec,
        onStageProgress: setStageText,
      });
      onAnalysisResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 分析失败');
    } finally {
      setAnalyzing(false);
      setStageText('');
    }
  };

  const handleSaveCustomApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!track) return;
    if (!customApiKey.trim()) {
      setErrorMsg('请输入有效的 API 密钥');
      return;
    }
    setSavingCustom(true);
    setErrorMsg(null);
    try {
      const saved = await saveProvider({
        name: customKind === 'deepseek' ? 'DeepSeek 自定义' : customKind === 'gemini' ? 'Gemini 自定义' : '自定义 API',
        kind: customKind,
        baseUrl:
          customKind === 'deepseek'
            ? 'https://api.deepseek.com'
            : customKind === 'gemini'
            ? 'https://generativelanguage.googleapis.com'
            : '',
        model: customModel.trim() || (customKind === 'deepseek' ? 'deepseek-chat' : 'gemini-4-hydrogen'),
        apiKey: customApiKey.trim(),
        enabled: true,
        setAsDefault: true,
      });
      setShowCustomModal(false);
      setCustomApiKey('');
      await loadProvidersList(saved.provider.id);
      // Run analyze immediately
      setAnalyzing(true);
      setStageText('正在读取 MV 与歌曲波形...');
      const result = await runMvTheaterAiAnalysis({
        providerId: saved.provider.id,
        model: saved.provider.model,
        track,
        mv,
        mvVideoUrl,
        mvDurationSec,
        songDurationSec,
        onStageProgress: setStageText,
      });
      onAnalysisResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存 API 密钥失败');
    } finally {
      setSavingCustom(false);
      setAnalyzing(false);
      setStageText('');
    }
  };

  return (
    <div className="rounded-3xl bg-white/[0.045] border border-white/12 p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: palette.primary }} />
            <h2 className="text-base font-semibold text-white">
              AI 剧场智能识别：自动定位前瞻播放段与后段尾声
            </h2>
          </div>
          <p className="text-xs text-white/60">
            支持系统原生态 AI、已配置的 DeepSeek/Gemini 或自定义 API 密钥，结合 MV 声波互相关对齐与关键帧画面精准识别。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="选择 AI 服务商"
            value={selectedProviderId}
            onChange={(e) => {
              const id = e.target.value;
              if (id === '__custom_api_key__') {
                setShowCustomModal(true);
                return;
              }
              setSelectedProviderId(id);
              if (id === '__builtin_gemini__') {
                setSelectedModel('gemini-4-hydrogen');
              } else {
                const p = providers.find((item) => item.id === id);
                setSelectedModel(p?.model || '');
              }
            }}
            className="min-h-[38px] px-3 rounded-xl bg-black/45 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35"
          >
            {builtinGeminiAvailable && (
              <option value="__builtin_gemini__" className="bg-[#160710] text-white">
                内置原生态 AI (系统 Gemini 多模态引擎)
              </option>
            )}
            {providers.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#160710] text-white">
                {p.name} ({p.kind})
              </option>
            ))}
            <option value="__custom_api_key__" className="bg-[#160710] text-emerald-300 font-medium">
              + 自定义 API 密钥 (DeepSeek / Gemini...)
            </option>
          </select>

          {selectedProviderId !== '__custom_api_key__' && availableModels.length > 0 && (
            <select
              aria-label="选择 AI 模型"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="min-h-[38px] px-3 rounded-xl bg-black/45 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35 max-w-[190px]"
            >
              {availableModels.map((m) => (
                <option key={m} value={m} className="bg-[#160710] text-white">
                  {m}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={analyzing || !track}
            onClick={handleAnalyze}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg cursor-pointer disabled:opacity-50 transition-transform active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
            }}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>分析中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{analysisResult ? '重新 AI 识别' : 'AI 识别前瞻与后段'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Custom API Key Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <form
            onSubmit={handleSaveCustomApiKey}
            className="w-full max-w-md rounded-3xl bg-[#190712] border border-white/20 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-rose-400" />
                <span>配置自定义 AI API 密钥</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/65">
              您可以输入自己的 DeepSeek、Google Gemini 或 OpenAI 兼容 API 密钥，即时用于 MV 剧场识别与歌词处理。
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/80 block mb-1">服务商类型</label>
                <select
                  value={customKind}
                  onChange={(e) => {
                    const k = e.target.value as any;
                    setCustomKind(k);
                    if (k === 'deepseek') setCustomModel('deepseek-chat');
                    else if (k === 'gemini') setCustomModel('gemini-4-hydrogen');
                    else setCustomModel('gpt-4o');
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35"
                >
                  <option value="deepseek">DeepSeek (deepseek.com)</option>
                  <option value="gemini">Google Gemini (Google AI Studio)</option>
                  <option value="openai-compatible">OpenAI 兼容接口 / 其他</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-white/80 block mb-1">API 密钥 (API Key)</label>
                <input
                  type="password"
                  required
                  placeholder="请输入您的 API Key..."
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-white/80 block mb-1">模型名称 (Model)</label>
                <input
                  type="text"
                  required
                  placeholder="例如：deepseek-chat 或 gemini-4-hydrogen"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-white/35 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/18 text-xs text-white cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={savingCustom}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-purple-600 hover:opacity-90 text-xs font-semibold text-white shadow-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {savingCustom ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>保存并分析...</span>
                  </>
                ) : (
                  <span>保存并开始 AI 识别</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {analyzing && stageText && (
        <div className="rounded-2xl bg-black/35 border border-white/10 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-white/85">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: palette.primary }} />
          <span>{stageText}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-2xl bg-rose-500/15 border border-rose-400/30 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-rose-200">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </span>
          <button
            type="button"
            onClick={onOpenAiCenter}
            className="underline shrink-0 cursor-pointer hover:text-white"
          >
            检查 API 配置
          </button>
        </div>
      )}

      {/* Interactive AI Suggestion Confirmation Panel */}
      {analysisResult && !analyzing && (
        <div className="rounded-2xl bg-black/35 border border-white/12 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-white">
                  AI 研判结论（请先查看视频帧并试听音频确认）
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/75 text-[11px]">
                  {analysisResult.providerName} · {analysisResult.modelUsed}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/75 text-[11px]">
                  {analysisResult.usedVisualFrames
                    ? '已结合视频关键帧 + 声波对齐'
                    : '基于双轨声波互相关分析'}
                </span>
              </div>
              <p className="text-xs text-white/70">{analysisResult.summary}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onApplyBoth(analysisResult)}
                className="min-h-[34px] px-3 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/38 border border-emerald-400/40 text-xs font-semibold text-emerald-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>确认并应用全部建议</span>
              </button>
              <button
                type="button"
                onClick={() => onAnalysisResult(null)}
                aria-label="收起 AI 建议"
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Intro Suggestion + Video/Audio Inspection */}
            <div className="rounded-2xl bg-sky-500/[0.06] border border-sky-400/25 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-sky-300" />
                  <span className="text-sm font-semibold text-white">
                    前瞻播放段（Intro）
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${
                    CONFIDENCE_LABEL[analysisResult.intro.confidence].cls
                  }`}
                >
                  {CONFIDENCE_LABEL[analysisResult.intro.confidence].text}
                </span>
              </div>

              <div className="text-xs text-white/85 font-mono-tabular">
                {analysisResult.intro.recommended ? (
                  <span>
                    建议区间：<strong className="text-sky-300">00:00.0 → {analysisResult.intro.introEndSec.toFixed(1)}s</strong>{' '}
                    ({formatTime(analysisResult.intro.introEndSec)})
                  </span>
                ) : (
                  <span className="text-white/65">
                    AI 判定本片无需单独前瞻段（音乐开头基本直接对齐 MV 0:00）
                  </span>
                )}
              </div>

              <p className="text-xs text-white/70 leading-relaxed">
                {analysisResult.intro.reason}
              </p>

              {analysisResult.intro.evidenceTimestamps.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-white/50">证据时间点：</span>
                  {analysisResult.intro.evidenceTimestamps.map((ts, i) => (
                    <button
                      key={`${ts}-${i}`}
                      type="button"
                      onClick={() => onPreviewVideoAt(ts, true)}
                      className="px-2 py-0.5 rounded-md bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/30 text-sky-200 font-mono-tabular cursor-pointer"
                    >
                      {ts.toFixed(1)}s
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onPreviewVideoAt(
                      Math.max(0, analysisResult.intro.introEndSec - 2.0),
                      true
                    )
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-sky-300" />
                  <span>查看此处视频确认</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAuditionMusicAt(0)}
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Music2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>试听音乐 0:00 起点</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onApplyIntro(
                      analysisResult.intro.introEndSec,
                      analysisResult.intro.recommended
                    )
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-sky-500/28 hover:bg-sky-500/42 border border-sky-400/40 text-[11px] font-semibold text-sky-100 flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>确认应用前瞻</span>
                </button>
              </div>
            </div>

            {/* 2. Outro Suggestion + Video/Audio Inspection */}
            <div className="rounded-2xl bg-amber-500/[0.06] border border-amber-400/25 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-amber-300" />
                  <span className="text-sm font-semibold text-white">
                    后段尾声（Outro）
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${
                    CONFIDENCE_LABEL[analysisResult.outro.confidence].cls
                  }`}
                >
                  {CONFIDENCE_LABEL[analysisResult.outro.confidence].text}
                </span>
              </div>

              <div className="text-xs text-white/85 font-mono-tabular">
                {analysisResult.outro.recommended ? (
                  <span>
                    建议区间：
                    <strong className="text-amber-300">
                      {analysisResult.outro.outroStartSec.toFixed(1)}s →{' '}
                      {analysisResult.outro.outroEndSec.toFixed(1)}s
                    </strong>{' '}
                    ({formatTime(analysisResult.outro.outroStartSec)} ~{' '}
                    {formatTime(analysisResult.outro.outroEndSec)})
                  </span>
                ) : (
                  <span className="text-white/65">
                    AI 判定歌曲结束时 MV 基本已播完，暂无需开启独立后段尾声
                  </span>
                )}
              </div>

              <p className="text-xs text-white/70 leading-relaxed">
                {analysisResult.outro.reason}
              </p>

              {analysisResult.outro.evidenceTimestamps.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-white/50">证据时间点：</span>
                  {analysisResult.outro.evidenceTimestamps.map((ts, i) => (
                    <button
                      key={`${ts}-${i}`}
                      type="button"
                      onClick={() => onPreviewVideoAt(ts, true)}
                      className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/30 text-amber-200 font-mono-tabular cursor-pointer"
                    >
                      {ts.toFixed(1)}s
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onPreviewVideoAt(
                      Math.max(0, analysisResult.outro.outroStartSec - 2.0),
                      true
                    )
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-amber-300" />
                  <span>查看此处视频确认</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAuditionMusicAt(Math.max(0, songDurationSec - 5))
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Music2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>试听音乐结尾</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onApplyOutro(
                      analysisResult.outro.outroEndSec,
                      analysisResult.outro.recommended
                    )
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-amber-500/28 hover:bg-amber-500/42 border border-amber-400/40 text-[11px] font-semibold text-amber-100 flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>确认应用后段</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
