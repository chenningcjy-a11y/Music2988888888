import {
  AiProviderConfig,
  AiTaskRecord,
  DspPlanResponse,
} from '../../types/ai';
import { AudioDspSettings, EqPresetName, TrackMetadata } from '../../types/music';
import { EQ_PRESETS } from '../../utils/constants';
import { inferClientModelCapabilities } from './providerManager';

const VALID_EQ_PRESETS = new Set(Object.keys(EQ_PRESETS).concat(['自定义']));

export interface IntentRoutePlan {
  taskType:
    | 'stem_separation'
    | 'dsp_tuning'
    | 'lyrics_assistant'
    | 'audio_analysis'
    | 'general_qa';
  canExecute: boolean;
  requiresConfirmation: boolean;
  replyMessage: string;
  lyricsAction?: string | null;
  dspInstruction?: string | null;
  analysisType?: 'comprehensive' | 'instruments' | 'rhythm-audio' | null;
}

export interface IntentRouteResponse {
  providerName: string;
  modelUsed: string;
  stemServiceReady: boolean;
  stemServiceName: string | null;
  plan: IntentRoutePlan;
}

export function sanitizeDspPatch(
  rawPatch: Record<string, unknown>
): Partial<AudioDspSettings> {
  const clean: Partial<AudioDspSettings> = {};
  const clamp = (n: unknown, min: number, max: number): number | undefined => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, n));
  };

  if (typeof rawPatch.masterEnabled === 'boolean') {
    clean.masterEnabled = rawPatch.masterEnabled;
  }
  if (
    rawPatch.qualityMode === 'original' ||
    rawPatch.qualityMode === 'high' ||
    rawPatch.qualityMode === 'lossless' ||
    rawPatch.qualityMode === 'auto'
  ) {
    clean.qualityMode = rawPatch.qualityMode;
  }
  if (
    typeof rawPatch.eqPreset === 'string' &&
    VALID_EQ_PRESETS.has(rawPatch.eqPreset)
  ) {
    clean.eqPreset = rawPatch.eqPreset as EqPresetName;
  }
  if (Array.isArray(rawPatch.eqGains) && rawPatch.eqGains.length === 7) {
    clean.eqGains = rawPatch.eqGains.map((v) =>
      Math.max(-12, Math.min(12, Number(v) || 0))
    ) as [number, number, number, number, number, number, number];
  }
  const bass = clamp(rawPatch.bassBoost, 0, 12);
  if (bass !== undefined) clean.bassBoost = bass;
  const treble = clamp(rawPatch.trebleBoost, 0, 12);
  if (treble !== undefined) clean.trebleBoost = treble;
  const vocal = clamp(rawPatch.vocalEnhance, 0, 10);
  if (vocal !== undefined) clean.vocalEnhance = vocal;
  const reverb = clamp(rawPatch.reverbMix, 0, 100);
  if (reverb !== undefined) clean.reverbMix = reverb;
  const width = clamp(rawPatch.stereoWidth, 0, 100);
  if (width !== undefined) clean.stereoWidth = width;

  if (typeof rawPatch.surroundEnabled === 'boolean') {
    clean.surroundEnabled = rawPatch.surroundEnabled;
  }
  const sWidth = clamp(rawPatch.surroundWidth, 0, 100);
  if (sWidth !== undefined) clean.surroundWidth = sWidth;
  const sInt = clamp(rawPatch.surroundIntensity, 0, 100);
  if (sInt !== undefined) clean.surroundIntensity = sInt;
  if (typeof rawPatch.headphoneOptimize === 'boolean') {
    clean.headphoneOptimize = rawPatch.headphoneOptimize;
  }
  if (typeof rawPatch.loudnessNormalization === 'boolean') {
    clean.loudnessNormalization = rawPatch.loudnessNormalization;
  }
  if (typeof rawPatch.stemModeActive === 'boolean') {
    clean.stemModeActive = rawPatch.stemModeActive;
  }
  const vGain = clamp(rawPatch.vocalGain, 0, 200);
  if (vGain !== undefined) clean.vocalGain = Math.round(vGain);
  const iGain = clamp(rawPatch.instrumentalGain, 0, 200);
  if (iGain !== undefined) clean.instrumentalGain = Math.round(iGain);
  const vb = clamp(rawPatch.vocalAccompanimentBalance, -100, 100);
  if (vb !== undefined) clean.vocalAccompanimentBalance = Math.round(vb);

  return clean;
}

export function validateProviderForTask(
  provider: AiProviderConfig | null,
  model: string,
  requirement: 'text' | 'audio'
): { ok: boolean; error?: string } {
  if (!provider) {
    return {
      ok: false,
      error: '尚未选择或配置 AI 服务商，请先前往「API 服务管理」配置 API Key。',
    };
  }
  if (!provider.enabled) {
    return {
      ok: false,
      error: `服务商「${provider.name}」当前未启用，请在 API 服务管理中开启。`,
    };
  }
  if (!provider.hasKey) {
    return {
      ok: false,
      error: `服务商「${provider.name}」尚未填写 API Key。`,
    };
  }
  const effectiveModel = model || provider.model;
  if (!effectiveModel) {
    return {
      ok: false,
      error: `服务商「${provider.name}」尚未指定模型名称。`,
    };
  }
  const caps = inferClientModelCapabilities(provider.kind, effectiveModel);
  if (requirement === 'audio' && !caps.audioInputAnalysis) {
    return {
      ok: false,
      error: `模型「${effectiveModel}」(${provider.name}) 为纯文本模型，不支持直接接收音频信号，请切换为支持音频的多模态模型（如 Google Gemini）。`,
    };
  }
  return { ok: true };
}

export async function requestDspTuningPlan(params: {
  providerId?: string;
  model?: string;
  instruction: string;
  currentSettings: AudioDspSettings;
  track: TrackMetadata | null;
  hasSeparatedStems: boolean;
  signal?: AbortSignal;
}): Promise<DspPlanResponse> {
  const res = await fetch('/api/ai/tasks/dsp-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: params.providerId,
      model: params.model,
      instruction: params.instruction,
      currentSettings: params.currentSettings,
      hasSeparatedStems: params.hasSeparatedStems,
      trackInfo: params.track
        ? {
            title: params.track.title,
            artist: params.track.artist,
            format: params.track.format,
          }
        : null,
    }),
    signal: params.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `AI 调音规划失败 (${res.status})`);
  }

  return {
    providerName: json.providerName,
    modelUsed: json.modelUsed,
    explanation: json.explanation,
    patch: sanitizeDspPatch(json.patch || {}),
    suggestStemSeparation: Boolean(json.suggestStemSeparation),
    warnings: Array.isArray(json.warnings) ? json.warnings : [],
  };
}

export async function routeAssistantIntent(params: {
  providerId?: string;
  model?: string;
  prompt: string;
  track: TrackMetadata | null;
  hasSeparatedStems: boolean;
  currentSettings: AudioDspSettings;
  signal?: AbortSignal;
}): Promise<IntentRouteResponse> {
  const res = await fetch('/api/ai/tasks/route-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: params.providerId,
      model: params.model,
      prompt: params.prompt,
      trackInfo: params.track
        ? {
            id: params.track.id,
            title: params.track.title,
            artist: params.track.artist,
            album: params.track.album,
            duration: params.track.duration,
            format: params.track.format,
          }
        : null,
      hasLyrics: Boolean(params.track?.lyricsRaw?.trim()),
      hasSeparatedStems: params.hasSeparatedStems,
      currentSettings: params.currentSettings,
    }),
    signal: params.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `AI 调度分析失败 (${res.status})`);
  }
  return json as IntentRouteResponse;
}

export function createTaskRecord(params: {
  taskName: string;
  category: AiTaskRecord['category'];
  providerName: string;
  modelName: string;
  trackTitle?: string;
  replayPayload?: AiTaskRecord['replayPayload'];
}): AiTaskRecord {
  const now = Date.now();
  return {
    id: `task-${now}-${Math.random().toString(36).slice(2, 7)}`,
    taskName: params.taskName,
    category: params.category,
    providerName: params.providerName,
    modelName: params.modelName,
    sourceTrackTitle: params.trackTitle,
    trackTitle: params.trackTitle,
    createdAt: now,
    startedAt: now,
    status: 'running',
    progress: 10,
    replayPayload: params.replayPayload,
  };
}
