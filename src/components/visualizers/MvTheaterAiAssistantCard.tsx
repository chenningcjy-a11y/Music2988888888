import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Eye,
  Film,
  KeyRound,
  Loader2,
  Music2,
  PauseCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  LOCAL_ENGINE_PRESETS,
  LocalEnginePreset,
} from '../../services/ai/localAcousticAnalyzer';
import {
  MvTheaterAiAnalysisResult,
  MvTheaterAiMidBreakSuggestion,
  MvTheaterCloudError,
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
  onApplyMidBreaks: (midBreaks: MvTheaterAiMidBreakSuggestion[]) => void;
  onApplyOutro: (outroEndSec: number, recommended: boolean) => void;
  onApplyBoth: (res: MvTheaterAiAnalysisResult) => void;
  onOpenAiCenter: () => void;
}

interface SelectableModelOption {
  optionId: string;
  group: 'local' | 'builtin' | 'custom';
  title: string;
  subtitle: string;
  badge: string;
  providerId: string;
  model?: string;
  localPreset?: LocalEnginePreset | 'all';
}

const CONFIDENCE_LABEL: Record<
  'high' | 'medium' | 'low',
  { text: string; cls: string }
> = {
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

export const LOCAL_ENGINE_ID = '__local_engine__';

const BUILTIN_MODEL_META: Record<
  string,
  { title: string; badge: string; subtitle: string }
> = {
  __builtin_auto_ensemble__: {
    title: '内置谷歌双模型联合 + 自动容灾 (Flash Lite + Hydrogen)',
    badge: '系统推荐 · 防拥堵高可用',
    subtitle:
      '同时调度 Flash Lite 与 Hydrogen 交叉复核前/中/后；即使其中一个遇到高并发限流，另一个也会自动接管完成分析。',
  },
  'gemini-3.1-flash-lite::minimal': {
    title: 'Gemini 3.1 Flash Lite · 极速轻量 (MINIMAL)',
    badge: '系统内置 · 最宽松防排队',
    subtitle:
      '系统免费通道并发配额最宽松的极速版：本地全曲声纹 + 画面关键帧秒级快筛。',
  },
  'gemini-3.1-flash-lite::medium': {
    title: 'Gemini 3.1 Flash Lite · 均衡视觉 (MEDIUM)',
    badge: '系统内置 · 轻量中等思考',
    subtitle:
      '在 Flash Lite 通道下启用中等视觉思考深度，兼顾高可用率与开场/尾声转场辨识。',
  },
  'gemini-3.1-flash-lite::high': {
    title: 'Gemini 3.1 Flash Lite · 深度细查 (HIGH)',
    badge: '系统内置 · 轻量高阶推理',
    subtitle:
      '在 Flash Lite 上启用高思考深度，精细辨认片头黑屏字幕、歌词进歌时机与片尾演职员表。',
  },
  'gemini-4-hydrogen::low': {
    title: 'Gemini 4 Hydrogen · 标准多模态 (LOW)',
    badge: '系统内置 · Gemini 4 标准版',
    subtitle:
      'Gemini 4 Flash 标准低延迟多模态通道：本地全曲声纹对比 + 视频画面语义核对。',
  },
  'gemini-4-hydrogen::medium': {
    title: 'Gemini 4 Hydrogen · 均衡全能 (MEDIUM)',
    badge: '系统内置 · 剧情插曲精判',
    subtitle:
      'Gemini 4 均衡推理深度，擅长区分 MV 中段真停顿剧情与纯粹器乐间奏。',
  },
  'gemini-4-hydrogen::high': {
    title: 'Gemini 4 Hydrogen · 高精深思 (HIGH)',
    badge: '系统内置 · 强视觉逻辑核对',
    subtitle:
      '启用高深度推理，结合多帧画面字幕与声纹相关性轨迹反复验算三段临界点。',
  },
  'gemini-4-hydrogen::xhigh': {
    title: 'Gemini 4 Hydrogen · 极限深思 (XHIGH)',
    badge: '系统内置 · 最高深度推理',
    subtitle:
      '免 Key 通道最高深度思考模式：对超长剧情 MV 做全面交叉推敲（耗时略久）。',
  },
  'gemini-3.1-flash-lite': {
    title: 'Gemini 3.1 Flash Lite (系统轻量视觉)',
    badge: '系统内置 · 低门槛不易拥堵',
    subtitle:
      '系统免费额度下并发最宽松的轻量化多模态模型：本地全曲声纹 + 关键帧视觉快速复核。',
  },
  'gemini-4-hydrogen': {
    title: 'Gemini 4 Hydrogen (系统全能多模态)',
    badge: '系统内置 · 强画面字幕识别',
    subtitle:
      '均衡多模态推理引擎：本地全曲声纹对比 + 视频片头字幕/剧情画面识别。',
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
  onApplyMidBreaks,
  onApplyOutro,
  onApplyBoth,
  onOpenAiCenter,
}) => {
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [builtinGeminiAvailable, setBuiltinGeminiAvailable] = useState(false);
  const [builtinModels, setBuiltinModels] = useState<string[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string>('local:standard');
  const [showAllModels, setShowAllModels] = useState(true);

  // Custom API key quick drawer state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customKind, setCustomKind] = useState<'deepseek' | 'gemini' | 'openai-compatible'>('deepseek');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('deepseek-chat');
  const [savingCustom, setSavingCustom] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [stageText, setStageText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cloudFallbackDraft, setCloudFallbackDraft] =
    useState<MvTheaterAiAnalysisResult | null>(null);

  const loadProvidersList = async (preferredOptionId?: string) => {
    try {
      const res = await fetchProviders();
      const enabledReady = res.providers.filter((p) => p.enabled && p.hasKey);
      setProviders(enabledReady);
      setBuiltinGeminiAvailable(Boolean(res.builtinGeminiAvailable));
      setBuiltinModels(
        res.builtinGeminiAvailable
          ? res.builtinGeminiModels && res.builtinGeminiModels.length > 0
            ? res.builtinGeminiModels
            : [
                '__builtin_auto_ensemble__',
                'gemini-3.1-flash-lite::minimal',
                'gemini-3.1-flash-lite::medium',
                'gemini-3.1-flash-lite::high',
                'gemini-4-hydrogen::low',
                'gemini-4-hydrogen::medium',
                'gemini-4-hydrogen::high',
                'gemini-4-hydrogen::xhigh',
              ]
          : []
      );
      if (preferredOptionId) {
        setSelectedOptionId(preferredOptionId);
      }
    } catch {
      // Local engines stay 100% available even if /api/ai/providers is offline
    }
  };

  useEffect(() => {
    loadProvidersList();
  }, []);

  // Assemble ALL genuinely usable & analyzable models into one unified catalog
  const allModelOptions = useMemo<SelectableModelOption[]>(() => {
    const list: SelectableModelOption[] = [];

    // 1A. "All 4 Local Models Consensus" option (runs all 4 & picks highest-agreement group)
    list.push({
      optionId: 'local:all',
      group: 'local',
      title: '全部都用 · 4 模型全量联合投票 (DSP-All-4-Consensus)',
      subtitle:
        '同时运行下方全部 4 款本地声纹模型，逐一对比前瞻、中期、后期参数，自动选出一致数量最多的一组最佳方案并给出 4 模型对比报告。',
      badge: '免 API · 推荐全量比对选优',
      providerId: LOCAL_ENGINE_ID,
      localPreset: 'all',
    });

    // 1B. All 4 Individual Local DSP Engines (Zero-API, 100% reliable)
    (['standard', 'anti-dialogue', 'silence-split', 'fast-envelope'] as LocalEnginePreset[]).forEach(
      (presetKey) => {
        const cfg = LOCAL_ENGINE_PRESETS[presetKey];
        list.push({
          optionId: `local:${presetKey}`,
          group: 'local',
          title: `${cfg.name} (${cfg.modelCode})`,
          subtitle: cfg.description,
          badge: `免 API · ${cfg.badge}`,
          providerId: LOCAL_ENGINE_ID,
          localPreset: presetKey,
        });
      }
    );

    // 2. Built-in Low-Barrier Multimodal Gemini Models (No user API key required)
    if (builtinGeminiAvailable) {
      builtinModels.forEach((mId) => {
        const meta = BUILTIN_MODEL_META[mId] || {
          title: `${mId} (系统内置引擎)`,
          badge: '系统内置 · 多模态视觉',
          subtitle: '系统内置服务端通道：本地全曲声纹对比 + 视频画面关键帧校验。',
        };
        list.push({
          optionId: `builtin:${mId}`,
          group: 'builtin',
          title: meta.title,
          subtitle: meta.subtitle,
          badge: meta.badge,
          providerId: '__builtin_gemini__',
          model: mId,
          localPreset: 'standard',
        });
      });
    }

    // 3. All User-Configured Enabled Providers & Their Models
    providers.forEach((p) => {
      const defaultsForKind =
        p.kind === 'deepseek'
          ? ['deepseek-chat', 'deepseek-reasoner']
          : p.kind === 'openai'
          ? ['gpt-4o-mini', 'gpt-4o']
          : [];
      const modelIds = Array.from(
        new Set(
          [p.model, ...(p.availableModels || []), ...defaultsForKind].filter(Boolean)
        )
      ).slice(0, 8);

      modelIds.forEach((mId) => {
        list.push({
          optionId: `custom:${p.id}:${mId}`,
          group: 'custom',
          title: `${p.name} · ${mId}`,
          subtitle:
            p.kind === 'deepseek'
              ? '使用您的个人 API：本地先完成全曲 0.1s 声纹对齐，再由 DeepSeek 联合逻辑校核切点。'
              : '使用您的个人 API：本地先完成全曲声纹对齐，再结合您自选模型综合研判。',
          badge: `个人密钥 (${p.kind})`,
          providerId: p.id,
          model: mId,
          localPreset: 'standard',
        });
      });
    });

    return list;
  }, [providers, builtinGeminiAvailable, builtinModels]);

  const activeOption =
    allModelOptions.find((o) => o.optionId === selectedOptionId) ||
    allModelOptions[0];

  const handleAnalyze = async (overrideOption?: SelectableModelOption) => {
    if (!track || !mvVideoUrl) return;
    const chosen = overrideOption || activeOption;
    if (!chosen) return;

    setAnalyzing(true);
    setErrorMsg(null);
    setCloudFallbackDraft(null);
    setStageText(`正在启动「${chosen.title}」分析整首歌曲与整部 MV...`);
    try {
      const result = await runMvTheaterAiAnalysis({
        providerId: chosen.providerId,
        model: chosen.model,
        localPreset: chosen.localPreset || 'standard',
        track,
        mv,
        mvVideoUrl,
        mvDurationSec,
        songDurationSec,
        onStageProgress: setStageText,
      });
      onAnalysisResult(result);
    } catch (err) {
      if (err instanceof MvTheaterCloudError) {
        setCloudFallbackDraft(err.localDraftResult);
      }
      setErrorMsg(err instanceof Error ? err.message : '分析失败');
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
    setCloudFallbackDraft(null);
    try {
      const targetModel =
        customModel.trim() ||
        (customKind === 'deepseek'
          ? 'deepseek-chat'
          : customKind === 'gemini'
          ? 'gemini-3.1-flash-lite'
          : 'gpt-4o-mini');
      const saved = await saveProvider({
        name:
          customKind === 'deepseek'
            ? 'DeepSeek 自定义'
            : customKind === 'gemini'
            ? 'Gemini 自定义'
            : '自定义 API',
        kind: customKind,
        baseUrl:
          customKind === 'deepseek'
            ? 'https://api.deepseek.com'
            : customKind === 'gemini'
            ? 'https://generativelanguage.googleapis.com'
            : '',
        model: targetModel,
        apiKey: customApiKey.trim(),
        enabled: true,
        setAsDefault: true,
      });
      setShowCustomModal(false);
      setCustomApiKey('');
      const newOptId = `custom:${saved.provider.id}:${saved.provider.model}`;
      await loadProvidersList(newOptId);

      setAnalyzing(true);
      setStageText('正在解码整首歌曲与整部 MV 并联云端复核...');
      const result = await runMvTheaterAiAnalysis({
        providerId: saved.provider.id,
        model: saved.provider.model,
        localPreset: 'standard',
        track,
        mv,
        mvVideoUrl,
        mvDurationSec,
        songDurationSec,
        onStageProgress: setStageText,
      });
      onAnalysisResult(result);
    } catch (err) {
      if (err instanceof MvTheaterCloudError) {
        setCloudFallbackDraft(err.localDraftResult);
      }
      setErrorMsg(err instanceof Error ? err.message : '保存或调用 API 失败');
    } finally {
      setSavingCustom(false);
      setAnalyzing(false);
      setStageText('');
    }
  };

  const midBreaks = analysisResult?.midBreaks || [];
  const localOptions = allModelOptions.filter((o) => o.group === 'local');
  const builtinOptions = allModelOptions.filter((o) => o.group === 'builtin');
  const customOptions = allModelOptions.filter((o) => o.group === 'custom');

  return (
    <div className="rounded-3xl bg-white/[0.045] border border-white/12 p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: palette.primary }} />
            <h2 className="text-base font-semibold text-white">
              全曲 AI 视听分析模型库（共 {allModelOptions.length} 个可用模型 · 支持前瞻 / 中段 / 后段）
            </h2>
          </div>
          <p className="text-xs text-white/60">
            已将所有零门槛本地全曲声纹模型、系统免费内置多模态模型，以及您已配置的所有个人 API 模型全部集中在此，遇到云端繁忙随时可切换任意本地模型或直接采纳本地全曲对比结果。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAllModels((v) => !v)}
            className="min-h-[38px] px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 text-xs text-white/90 flex items-center gap-1.5 cursor-pointer"
          >
            {showAllModels ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>收起模型矩阵</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>展开全部 {allModelOptions.length} 个模型</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={analyzing || !track}
            onClick={() => handleAnalyze()}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg cursor-pointer disabled:opacity-50 transition-transform active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
            }}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>全曲分析中...</span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5" />
                <span>
                  {analysisResult ? '用当前所选模型重新分析' : '开始全曲分析（前/中/后）'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Currently Selected Model Quick Bar */}
      <div className="rounded-2xl bg-black/35 border border-white/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-white/55 shrink-0">当前已选模型：</span>
          <span className="font-semibold text-white truncate">
            {activeOption?.title}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-[10px] shrink-0">
            {activeOption?.badge}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCustomModal(true)}
          className="text-[11px] text-sky-300 hover:text-sky-200 flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加新 API 密钥 (DeepSeek / Gemini...)</span>
        </button>
      </div>

      {/* Categorized All-Models Selector Matrix */}
      {showAllModels && (
        <div className="space-y-3 pt-1">
          {/* Group 1: Local Zero-Barrier Engines (including "All 4 Consensus") */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                本地离线声纹分析模型（支持「全部都用」4 模型联合选优 · 免 API · 断网可用 · 永不限流）
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2.5">
              {localOptions.map((opt) => {
                const selected = opt.optionId === activeOption?.optionId;
                const isAll = opt.optionId === 'local:all';
                return (
                  <button
                    key={opt.optionId}
                    type="button"
                    onClick={() => setSelectedOptionId(opt.optionId)}
                    className={`text-left rounded-2xl p-3 border transition-all cursor-pointer space-y-1.5 ${
                      selected
                        ? isAll
                          ? 'bg-gradient-to-br from-emerald-500/25 to-cyan-500/18 border-emerald-300/70 shadow-md'
                          : 'bg-emerald-500/15 border-emerald-400/55 shadow-md'
                        : isAll
                        ? 'bg-emerald-950/35 border-emerald-400/30 hover:bg-emerald-900/35 hover:border-emerald-300/55'
                        : 'bg-black/30 border-white/10 hover:bg-white/[0.06] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-semibold text-white truncate">
                        {opt.title.split(' (')[0]}
                      </span>
                      {selected && (
                        <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                      )}
                    </div>
                    <div
                      className={`text-[10px] font-medium ${
                        isAll ? 'text-cyan-300' : 'text-emerald-300/90'
                      }`}
                    >
                      {opt.badge}
                    </div>
                    <p className="text-[11px] text-white/60 leading-snug line-clamp-2">
                      {opt.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group 2: Built-in System Free/Standard Multimodal Models */}
          {builtinOptions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300">
                <Cloud className="w-3.5 h-3.5" />
                <span>
                  系统内置免个人 Key 谷歌 AI 多模态模型（共 {builtinOptions.length} 档模式 + 自动容灾 · 无需填 Key）
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {builtinOptions.map((opt) => {
                  const selected = opt.optionId === activeOption?.optionId;
                  const isEnsemble = opt.model === '__builtin_auto_ensemble__';
                  return (
                    <button
                      key={opt.optionId}
                      type="button"
                      onClick={() => setSelectedOptionId(opt.optionId)}
                      className={`text-left rounded-2xl p-3 border transition-all cursor-pointer space-y-1.5 ${
                        selected
                          ? isEnsemble
                            ? 'bg-gradient-to-br from-sky-500/25 to-indigo-500/20 border-sky-300/70 shadow-md'
                            : 'bg-sky-500/15 border-sky-400/55 shadow-md'
                          : isEnsemble
                          ? 'bg-sky-950/35 border-sky-400/30 hover:bg-sky-900/35 hover:border-sky-300/55'
                          : 'bg-black/30 border-white/10 hover:bg-white/[0.06] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">
                          {opt.title}
                        </span>
                        {selected && (
                          <Check className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] font-medium text-sky-300/90">
                        {opt.badge}
                      </div>
                      <p className="text-[11px] text-white/60 leading-snug line-clamp-2">
                        {opt.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Group 3: User's Own Configured API Providers & Models */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-300">
                <KeyRound className="w-3.5 h-3.5" />
                <span>
                  您已配置的第三方模型（{customOptions.length} 个可用 · 结合本地全曲声纹联合推理）
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenAiCenter}
                className="text-[11px] text-white/55 hover:text-white underline cursor-pointer"
              >
                前往 API 服务管理
              </button>
            </div>

            {customOptions.length === 0 ? (
              <div className="rounded-2xl bg-black/25 border border-dashed border-white/15 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
                <span>
                  暂无已开启的个人第三方 API（上方 4 款本地模型与内置系统模型均可直接免费使用）。
                </span>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/18 text-white text-[11px] cursor-pointer"
                >
                  + 配置我的 DeepSeek / Gemini API
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {customOptions.map((opt) => {
                  const selected = opt.optionId === activeOption?.optionId;
                  return (
                    <button
                      key={opt.optionId}
                      type="button"
                      onClick={() => setSelectedOptionId(opt.optionId)}
                      className={`text-left rounded-2xl p-3 border transition-all cursor-pointer space-y-1 ${
                        selected
                          ? 'bg-purple-500/18 border-purple-400/55 shadow-md'
                          : 'bg-black/30 border-white/10 hover:bg-white/[0.06] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">
                          {opt.title}
                        </span>
                        {selected && (
                          <Check className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] font-medium text-purple-300/90">
                        {opt.badge}
                      </div>
                      <p className="text-[11px] text-white/60 leading-snug line-clamp-2">
                        {opt.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

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
              配置后可在本地全曲声纹分析的基础上，额外结合 DeepSeek、Google Gemini 或 OpenAI 兼容模型进行关键帧与剧情边界复核。
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/80 block mb-1">服务商类型</label>
                <select
                  value={customKind}
                  onChange={(e) => {
                    const k = e.target.value as 'deepseek' | 'gemini' | 'openai-compatible';
                    setCustomKind(k);
                    if (k === 'deepseek') setCustomModel('deepseek-chat');
                    else if (k === 'gemini') setCustomModel('gemini-3.1-flash-lite');
                    else setCustomModel('gpt-4o-mini');
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
                  placeholder="例如：deepseek-chat 或 gemini-3.1-flash-lite"
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
                  <span>保存并开始分析</span>
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
        <div className="rounded-2xl bg-rose-500/15 border border-rose-400/30 px-3.5 py-3 space-y-2 text-xs text-rose-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>云端模型暂未响应：{errorMsg}</span>
            </span>
            <button
              type="button"
              onClick={onOpenAiCenter}
              className="underline shrink-0 cursor-pointer hover:text-white"
            >
              检查 API 配置
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {cloudFallbackDraft && (
              <button
                type="button"
                onClick={() => {
                  onAnalysisResult(cloudFallbackDraft);
                  setErrorMsg(null);
                  setCloudFallbackDraft(null);
                  setSelectedOptionId('local:standard');
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/30 hover:bg-emerald-500/45 border border-emerald-400/45 text-emerald-100 font-semibold cursor-pointer"
              >
                直接采纳刚才已完成计算的本地全曲声纹分析结果
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedOptionId('local:anti-dialogue');
                const antiOpt = allModelOptions.find(
                  (o) => o.optionId === 'local:anti-dialogue'
                );
                if (antiOpt) handleAnalyze(antiOpt);
              }}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/18 border border-white/15 text-white cursor-pointer"
            >
              改用本地抗对白模型重算
            </button>
          </div>
        </div>
      )}

      {/* Interactive AI Suggestion Confirmation Panel */}
      {analysisResult && !analyzing && (
        <div className="rounded-2xl bg-black/35 border border-white/12 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-white">
                  全曲对比研判结论（点击时间戳可跳至视频画面核对）
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/80 text-[11px]">
                  {analysisResult.providerName} · {analysisResult.modelUsed}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/75 text-[11px]">
                  {analysisResult.usedVisualFrames
                    ? '本地全曲声纹 + 视频关键帧复核'
                    : '多频段能量/低音/瞬态全曲动态对齐'}
                </span>
              </div>
              <p className="text-xs text-white/75">{analysisResult.summary}</p>
              {analysisResult.analysisStats && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-mono-tabular text-white/65">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10">
                    <Activity className="w-3 h-3 text-emerald-300" />
                    全曲匹配覆盖率 {analysisResult.analysisStats.fullTrackCoveragePct}%
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10">
                    平均相关性 {(analysisResult.analysisStats.meanCorrelation * 100).toFixed(0)}%
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10">
                    峰值相关性 {(analysisResult.analysisStats.peakCorrelation * 100).toFixed(0)}%
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10">
                    稳定乐段数 {analysisResult.analysisStats.plateauCount} 段
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onApplyBoth(analysisResult)}
                className="min-h-[36px] px-3.5 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/38 border border-emerald-400/40 text-xs font-semibold text-emerald-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>确认并应用全部参数（前/中/后）</span>
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

          {analysisResult.ensembleComparison && (
            <div className="rounded-2xl bg-gradient-to-br from-emerald-500/[0.08] to-cyan-500/[0.06] border border-emerald-400/30 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-emerald-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                    <span>
                      4 模型全量投票对比分析（已自动选出前瞻 / 中期 / 后期相同数量最多的一组）
                    </span>
                  </div>
                  <p className="text-[11px] text-white/70">
                    {analysisResult.ensembleComparison.consensusSummary}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono-tabular shrink-0">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/35 text-emerald-200">
                    全段一致 {analysisResult.ensembleComparison.exactGroupCount}/4
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/35 text-sky-200">
                    前瞻共识 {analysisResult.ensembleComparison.introConsensusCount}/4
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-purple-500/20 border border-purple-400/35 text-purple-200">
                    中期共识 {analysisResult.ensembleComparison.midConsensusCount}/4
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/35 text-amber-200">
                    后期共识 {analysisResult.ensembleComparison.outroConsensusCount}/4
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {analysisResult.ensembleComparison.candidates.map((cand) => {
                  const r = cand.fullResult;
                  const introTxt = r.intro.recommended
                    ? `0→${r.intro.introEndSec.toFixed(1)}s`
                    : '无前瞻';
                  const midTxt =
                    r.midBreaks.length > 0
                      ? `${r.midBreaks.length}处 (${r.midBreaks[0].mvStartSec.toFixed(1)}→${r.midBreaks[0].mvEndSec.toFixed(1)}s)`
                      : '0处';
                  const outroTxt = r.outro.recommended
                    ? `${r.outro.outroStartSec.toFixed(1)}→${r.outro.outroEndSec.toFixed(1)}s`
                    : '无后段';
                  return (
                    <div
                      key={cand.preset}
                      className={`rounded-xl p-2.5 border text-[11px] space-y-1.5 ${
                        cand.isWinner
                          ? 'bg-emerald-500/18 border-emerald-400/55'
                          : cand.inWinningGroup
                          ? 'bg-cyan-500/12 border-cyan-400/40'
                          : 'bg-black/30 border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-white truncate">
                          {cand.name.replace(/^本地/, '')}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] shrink-0 ${
                            cand.isWinner
                              ? 'bg-emerald-500/35 text-emerald-100'
                              : cand.inWinningGroup
                              ? 'bg-cyan-500/30 text-cyan-100'
                              : 'bg-white/10 text-white/60'
                          }`}
                        >
                          {cand.isWinner
                            ? `胜出主组 (${cand.exactAllMatchCount}/4 同组)`
                            : cand.inWinningGroup
                            ? '同组一致'
                            : `${cand.exactAllMatchCount}/4 同组`}
                        </span>
                      </div>
                      <div className="font-mono-tabular text-[10px] text-white/80 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-sky-300">前瞻：{introTxt}</span>
                          <span className="text-white/50">{cand.introAgreeCount}/4 同票</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-purple-300">中期：{midTxt}</span>
                          <span className="text-white/50">{cand.midAgreeCount}/4 同票</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-amber-300">后期：{outroTxt}</span>
                          <span className="text-white/50">{cand.outroAgreeCount}/4 同票</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[10px]">
                        <span className="text-white/50 font-mono-tabular">
                          相关性{' '}
                          {((r.analysisStats?.meanCorrelation || 0) * 100).toFixed(0)}%
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onAnalysisResult({
                              ...r,
                              ensembleComparison: analysisResult.ensembleComparison,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                        >
                          改采此组数据
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Intro Suggestion */}
            <div className="rounded-2xl bg-sky-500/[0.06] border border-sky-400/25 p-3.5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-sky-300" />
                    <span className="text-sm font-semibold text-white">
                      1. 前瞻播放段（Intro）
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
                      建议区间：
                      <strong className="text-sky-300">
                        00:00.0 → {analysisResult.intro.introEndSec.toFixed(1)}s
                      </strong>{' '}
                      ({formatTime(analysisResult.intro.introEndSec)})
                    </span>
                  ) : (
                    <span className="text-white/65">
                      歌曲开头基本直接对齐 MV 0:00，无需单独前瞻段
                    </span>
                  )}
                </div>

                <p className="text-xs text-white/70 leading-relaxed">
                  {analysisResult.intro.reason}
                </p>

                {analysisResult.intro.evidenceTimestamps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-white/50">临界帧：</span>
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
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
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
                  <span>看视频帧</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAuditionMusicAt(0)}
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Music2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>试听 0:00</span>
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
                  <span>应用前瞻</span>
                </button>
              </div>
            </div>

            {/* 2. Mid-Breaks Suggestion */}
            <div className="rounded-2xl bg-purple-500/[0.06] border border-purple-400/25 p-3.5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PauseCircle className="w-4 h-4 text-purple-300" />
                    <span className="text-sm font-semibold text-white">
                      2. 中间剧情段（Mid）
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md border border-purple-400/35 bg-purple-500/20 text-purple-200 text-[10px] font-medium">
                    {midBreaks.length > 0
                      ? `检出 ${midBreaks.length} 处插曲`
                      : '全曲连续对齐'}
                  </span>
                </div>

                {midBreaks.length === 0 ? (
                  <p className="text-xs text-white/65 leading-relaxed">
                    全曲声纹对齐轨迹连续稳定，未发现 MV 在歌曲中途插入额外对白或静默暂停片段（若对白噪音多或停顿较轻，可切换上方的「抗对白穿透模型」或「静默高敏模型」再测）。
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[240px] overflow-y-auto lumina-scroll pr-1">
                    {midBreaks.map((brk) => (
                      <div
                        key={brk.id}
                        className="rounded-xl bg-black/30 border border-purple-400/20 p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-purple-200">
                            {brk.label}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] ${
                              CONFIDENCE_LABEL[brk.confidence].cls
                            }`}
                          >
                            {CONFIDENCE_LABEL[brk.confidence].text}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-tabular text-white/85 space-y-0.5">
                          <div>
                            歌曲暂停：<strong className="text-emerald-300">{brk.audioTriggerSec.toFixed(1)}s</strong>
                          </div>
                          <div>
                            MV 剧情：<strong className="text-purple-300">{brk.mvStartSec.toFixed(1)}s → {brk.mvEndSec.toFixed(1)}s</strong>（{(brk.mvEndSec - brk.mvStartSec).toFixed(1)}s）
                          </div>
                        </div>
                        <p className="text-[11px] text-white/65 leading-relaxed">
                          {brk.reason}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              onPreviewVideoAt(Math.max(0, brk.mvStartSec - 1.5), true)
                            }
                            className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/35 border border-purple-400/30 text-[10px] text-purple-100 cursor-pointer"
                          >
                            看剧情起点 {brk.mvStartSec.toFixed(1)}s
                          </button>
                          <button
                            type="button"
                            onClick={() => onPreviewVideoAt(brk.mvEndSec, true)}
                            className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/35 border border-purple-400/30 text-[10px] text-purple-100 cursor-pointer"
                          >
                            看复唱点 {brk.mvEndSec.toFixed(1)}s
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onAuditionMusicAt(Math.max(0, brk.audioTriggerSec - 2.5))
                            }
                            className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/30 text-[10px] text-emerald-100 cursor-pointer"
                          >
                            试听触发点
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => onApplyMidBreaks(midBreaks)}
                  className="min-h-[32px] px-2.5 rounded-lg bg-purple-500/28 hover:bg-purple-500/42 border border-purple-400/40 text-[11px] font-semibold text-purple-100 flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{midBreaks.length > 0 ? '应用中段参数' : '确认无中段'}</span>
                </button>
              </div>
            </div>

            {/* 3. Outro Suggestion */}
            <div className="rounded-2xl bg-amber-500/[0.06] border border-amber-400/25 p-3.5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-amber-300" />
                    <span className="text-sm font-semibold text-white">
                      3. 后段尾声（Outro）
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
                      歌曲结束时 MV 基本已播完，暂无需开启独立后段尾声
                    </span>
                  )}
                </div>

                <p className="text-xs text-white/70 leading-relaxed">
                  {analysisResult.outro.reason}
                </p>

                {analysisResult.outro.evidenceTimestamps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-white/50">临界帧：</span>
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
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
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
                  <span>看视频帧</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAuditionMusicAt(Math.max(0, songDurationSec - 5))
                  }
                  className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer"
                >
                  <Music2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>试听结尾</span>
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
                  <span>应用后段</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
