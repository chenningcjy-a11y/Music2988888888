import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AiProviderKind,
  checkAndIncrementProviderQuota,
  getStoredProviderWithKey,
  recordProviderProbeResult,
  StoredAiProvider,
} from './keyVault.ts';

export interface ModelCapabilities {
  textReasoning: boolean;
  lyricsProcessing: boolean;
  dspPlanning: boolean;
  audioInputAnalysis: boolean;
  stemSeparation: boolean; // Always false for LLM text/multimodal APIs; requires dedicated separation service
  note?: string;
}

export interface DiscoveredModel {
  id: string;
  label: string;
  capabilities: ModelCapabilities;
}

const DEPRECATED_GEMINI_IDS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function inferModelCapabilities(
  kind: AiProviderKind,
  modelId: string
): ModelCapabilities {
  const m = (modelId || '').toLowerCase();

  if (kind === 'gemini') {
    const isTextOrMultimodal =
      !m.includes('embedding') && !m.includes('tts') && !m.includes('image');
    return {
      textReasoning: isTextOrMultimodal,
      lyricsProcessing: isTextOrMultimodal,
      dspPlanning: isTextOrMultimodal,
      audioInputAnalysis:
        m.includes('gemini-4') ||
        m.includes('gemini-3') ||
        m.includes('gemini-2.5') ||
        m.includes('transcribe'),
      stemSeparation: false,
      note: 'Gemini 支持文本规划与音频输入理解，但不能直接输出分离后的人声/伴奏音轨',
    };
  }

  if (kind === 'deepseek') {
    return {
      textReasoning: true,
      lyricsProcessing: true,
      dspPlanning: true,
      audioInputAnalysis: false,
      stemSeparation: false,
      note: 'DeepSeek 为纯文本推理模型：擅长任务调度、歌词处理与调音方案规划，不支持直接听辨音频流或分离音轨',
    };
  }

  if (kind === 'openai' || kind === 'openai-compatible') {
    const supportsAudio = m.includes('audio-preview') || m.includes('gpt-4o-audio');
    return {
      textReasoning: true,
      lyricsProcessing: true,
      dspPlanning: true,
      audioInputAnalysis: supportsAudio,
      stemSeparation: false,
      note: supportsAudio
        ? '支持文本与音频输入分析，但不能直接执行音轨分离'
        : '文本对话模型：支持歌词与调音规划，不支持直接解析原始音频频谱与分离音轨',
    };
  }

  return {
    textReasoning: true,
    lyricsProcessing: true,
    dspPlanning: true,
    audioInputAnalysis: false,
    stemSeparation: false,
    note: '自定义接口默认按文本模型处理；音轨分离请使用独立分离服务',
  };
}

function normalizeOpenAiBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://api.openai.com/v1';
  if (/\/v\d+(?:alpha|beta)?$/i.test(trimmed)) return trimmed;
  if (trimmed.includes('api.deepseek.com')) return trimmed;
  return `${trimmed}/v1`;
}

function parseCustomHeaders(rawJson?: string): Record<string, string> {
  if (!rawJson || !rawJson.trim()) return {};
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        typeof v === 'string' &&
        k.toLowerCase() !== 'authorization' &&
        k.toLowerCase() !== 'x-goog-api-key'
      ) {
        clean[k] = v;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function buildTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`)),
    Math.max(3000, timeoutMs)
  );
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Scrub anything resembling sk-... or AIza... tokens
    return err.message
      .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
      .replace(/AIza[a-zA-Z0-9_-]{8,}/g, 'AIza***');
  }
  return '第三方 AI 接口调用失败';
}

export async function fetchModelsFromProvider(
  providerId: string
): Promise<{
  models: DiscoveredModel[];
  supportsModelListing: boolean;
  message?: string;
}> {
  const resolved = await getStoredProviderWithKey(providerId);
  if (!resolved) {
    throw new Error('未找到对应的 AI 服务商配置');
  }
  const { provider, apiKey } = resolved;
  if (!apiKey) {
    throw new Error(`「${provider.name}」尚未填写 API Key`);
  }

  const { signal, cleanup } = buildTimeoutSignal(Math.min(15000, provider.timeoutMs));

  try {
    if (provider.kind === 'gemini') {
      const base = (provider.baseUrl || 'https://generativelanguage.googleapis.com').replace(
        /\/+$/,
        ''
      );
      const res = await fetch(`${base}/v1beta/models`, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
        signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg =
          (errJson as { error?: { message?: string } })?.error?.message ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const data = (await res.json()) as {
        models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      };

      const rawIds = (data.models || [])
        .filter((m) =>
          (m.supportedGenerationMethods || []).includes('generateContent')
        )
        .map((m) => (m.name || '').replace(/^models\//, ''))
        .filter((id) => id && !DEPRECATED_GEMINI_IDS.has(id));

      // Merge curated active Gemini models supported by @google/genai if not present
      const mergedIds = Array.from(
        new Set([
          'gemini-4-hydrogen',
          'gemini-3.1-flash-lite',
          'gemini-4-argon',
          ...rawIds,
        ])
      );

      const models: DiscoveredModel[] = mergedIds.map((id) => ({
        id,
        label: id,
        capabilities: inferModelCapabilities('gemini', id),
      }));

      await recordProviderProbeResult(provider.id, {
        status: 'connected',
        availableModels: mergedIds,
      });

      return { models, supportsModelListing: true };
    }

    // OpenAI / DeepSeek / OpenAI-compatible / Custom
    const base = normalizeOpenAiBaseUrl(provider.baseUrl);
    const customHeaders = parseCustomHeaders(provider.customHeadersJson);
    const res = await fetch(`${base}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...customHeaders,
      },
      signal,
    });

    if (!res.ok) {
      if (provider.kind === 'custom' && (res.status === 404 || res.status === 405)) {
        return {
          models: provider.availableModels.map((id) => ({
            id,
            label: id,
            capabilities: inferModelCapabilities(provider.kind, id),
          })),
          supportsModelListing: false,
          message: '该自定义服务未提供 /models 列表接口，请手动输入模型名称',
        };
      }
      const errBody = await res.json().catch(() => ({}));
      const msg =
        (errBody as { error?: { message?: string }; message?: string })?.error?.message ||
        (errBody as { message?: string })?.message ||
        `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const json = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
    const list = (json.data || json.models || [])
      .map((item) => item?.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const uniqueIds = Array.from(new Set(list));
    if (uniqueIds.length > 0) {
      await recordProviderProbeResult(provider.id, {
        status: 'connected',
        availableModels: uniqueIds,
      });
    }

    return {
      models: uniqueIds.map((id) => ({
        id,
        label: id,
        capabilities: inferModelCapabilities(provider.kind, id),
      })),
      supportsModelListing: uniqueIds.length > 0,
      message:
        uniqueIds.length === 0
          ? '接口未返回模型列表，请手动填写模型名称'
          : undefined,
    };
  } catch (err) {
    const safeMsg = sanitizeErrorMessage(err);
    throw new Error(safeMsg);
  } finally {
    cleanup();
  }
}

export async function testProviderConnection(providerId: string): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  modelsFound?: number;
}> {
  const resolved = await getStoredProviderWithKey(providerId);
  if (!resolved) {
    return { ok: false, latencyMs: 0, error: '未找到服务商配置' };
  }
  const { provider, apiKey } = resolved;
  if (!apiKey) {
    await recordProviderProbeResult(provider.id, {
      status: 'error',
      error: '尚未配置 API Key',
    });
    return { ok: false, latencyMs: 0, error: '尚未填写 API Key' };
  }

  const startedAt = Date.now();
  try {
    // Prefer /models probe; if custom endpoint doesn't support /models, send a minimal ping completion
    try {
      const listRes = await fetchModelsFromProvider(provider.id);
      if (listRes.supportsModelListing) {
        const latencyMs = Date.now() - startedAt;
        await recordProviderProbeResult(provider.id, {
          status: 'connected',
          latencyMs,
          availableModels: listRes.models.map((m) => m.id),
        });
        return {
          ok: true,
          latencyMs,
          modelsFound: listRes.models.length,
        };
      }
    } catch (listErr) {
      if (provider.kind !== 'custom') {
        throw listErr;
      }
    }

    // Minimal completion probe for custom endpoints without /models
    const text = await callProviderTextCompletion({
      provider,
      apiKey,
      modelOverride: provider.model,
      systemInstruction: 'Reply strictly with OK.',
      userPrompt: 'ping',
      expectJson: false,
    });
    const latencyMs = Date.now() - startedAt;
    if (!text) throw new Error('模型返回为空');
    await recordProviderProbeResult(provider.id, {
      status: 'connected',
      latencyMs,
    });
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const safeErr = sanitizeErrorMessage(err);
    await recordProviderProbeResult(provider.id, {
      status: 'error',
      error: safeErr,
      latencyMs,
    });
    return { ok: false, latencyMs, error: safeErr };
  }
}

export async function callProviderTextCompletion(params: {
  provider: StoredAiProvider;
  apiKey: string;
  modelOverride?: string;
  systemInstruction: string;
  userPrompt: string;
  expectJson?: boolean;
  audioInline?: { mimeType: string; base64Data: string };
  imageFrames?: { label: string; mimeType: string; base64Data: string }[];
  signal?: AbortSignal;
}): Promise<string> {
  const {
    provider,
    apiKey,
    modelOverride,
    systemInstruction,
    userPrompt,
    expectJson,
    audioInline,
    imageFrames,
    signal: externalSignal,
  } = params;

  const model = (modelOverride || provider.model || '').trim();
  if (!model) {
    throw new Error(`服务商「${provider.name}」未指定模型名称`);
  }
  if (!provider.enabled) {
    throw new Error(`服务商「${provider.name}」当前处于禁用状态`);
  }
  if (!apiKey) {
    throw new Error(`服务商「${provider.name}」尚未配置 API Key`);
  }

  const quota = await checkAndIncrementProviderQuota(provider.id);
  if (!quota.allowed) {
    throw new Error(quota.error || '超出每日请求限制');
  }

  const { signal, cleanup } = buildTimeoutSignal(provider.timeoutMs, externalSignal);

  try {
    if (provider.kind === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];
      if (audioInline) {
        parts.push({
          inlineData: {
            mimeType: audioInline.mimeType,
            data: audioInline.base64Data,
          },
        });
      }
      if (imageFrames && imageFrames.length > 0) {
        for (const frame of imageFrames) {
          parts.push({ text: frame.label });
          parts.push({
            inlineData: {
              mimeType: frame.mimeType,
              data: frame.base64Data,
            },
          });
        }
      }
      parts.push({ text: userPrompt });

      const useThinking =
        model.startsWith('gemini-4') || model.startsWith('gemini-3');

      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          systemInstruction,
          ...(expectJson ? { responseMimeType: 'application/json' } : {}),
          ...(useThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });

      const out = (response.text ?? '').trim();
      if (!out) throw new Error('Gemini 返回内容为空');
      return out;
    }

    if (audioInline) {
      throw new Error(
        `当前模型「${model}」(${provider.name}) 不支持直接接收原始音频流输入，请切换至支持音频的多模态模型（如 Google Gemini）。`
      );
    }

    // OpenAI / DeepSeek / OpenAI-compatible / Custom
    const base = normalizeOpenAiBaseUrl(provider.baseUrl);
    const customHeaders = parseCustomHeaders(provider.customHeadersJson);
    const endpoint = `${base}/chat/completions`;

    const lowerModel = model.toLowerCase();
    const supportsVision =
      imageFrames &&
      imageFrames.length > 0 &&
      (provider.kind === 'openai' || provider.kind === 'openai-compatible') &&
      (lowerModel.includes('gpt-4o') ||
        lowerModel.includes('gpt-4.1') ||
        lowerModel.includes('gpt-4-turbo') ||
        lowerModel.includes('vision') ||
        lowerModel.includes('vl') ||
        lowerModel.includes('claude-3') ||
        lowerModel.includes('claude-sonnet') ||
        lowerModel.includes('gemini'));

    const userContent: unknown = supportsVision
      ? [
          { type: 'text', text: userPrompt },
          ...imageFrames!.flatMap((f) => [
            { type: 'text', text: f.label },
            {
              type: 'image_url',
              image_url: {
                url: `data:${f.mimeType};base64,${f.base64Data}`,
                detail: 'low',
              },
            },
          ]),
        ]
      : userPrompt;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
    };

    // DeepSeek reasoner does not always accept response_format json_object on older revisions,
    // so only pass response_format when explicitly safe or let JSON parser strip markdown fences
    if (expectJson && !model.includes('reasoner')) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...customHeaders,
      },
      body: JSON.stringify(body),
      signal,
    });

    const rawText = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      // keep rawText fallback
    }

    if (!res.ok) {
      const errMsg =
        (parsed?.error as { message?: string })?.message ||
        (parsed?.message as string) ||
        `HTTP ${res.status}: ${rawText.slice(0, 180)}`;
      throw new Error(`[${provider.name} · ${model}] ${errMsg}`);
    }

    const choices = parsed?.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    const content = choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`${provider.name} 返回了空响应`);
    }
    return content;
  } catch (err) {
    throw new Error(sanitizeErrorMessage(err));
  } finally {
    cleanup();
  }
}

export function extractJsonFromLlmText<T>(raw: string): T {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : withoutThink).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');
    if (
      arrStart !== -1 &&
      arrEnd > arrStart &&
      (objStart === -1 || arrStart < objStart)
    ) {
      return JSON.parse(candidate.slice(arrStart, arrEnd + 1)) as T;
    }
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(candidate.slice(objStart, objEnd + 1)) as T;
    }
    throw new Error('AI 返回的内容不是有效的 JSON 格式');
  }
}

export { Type };
