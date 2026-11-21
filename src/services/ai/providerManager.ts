import {
  AiProviderConfig,
  AiProviderKind,
  DiscoveredModel,
  ModelCapabilities,
  StemServiceConfig,
  StemServiceKind,
} from '../../types/ai';

export function inferClientModelCapabilities(
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
      note: '支持文本推理与音频理解，音轨分离需使用独立音源分离服务',
    };
  }
  if (kind === 'deepseek') {
    return {
      textReasoning: true,
      lyricsProcessing: true,
      dspPlanning: true,
      audioInputAnalysis: false,
      stemSeparation: false,
      note: '纯文本模型（支持歌词、调音建议与任务规划；不支持音频信号识别与音轨分离）',
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
        ? '支持文本与音频输入分析；不支持音轨分离'
        : '纯文本模型（不支持原始音频信号听辨与音轨分离）',
    };
  }
  return {
    textReasoning: true,
    lyricsProcessing: true,
    dspPlanning: true,
    audioInputAnalysis: false,
    stemSeparation: false,
    note: '自定义接口（默认文本推理；音轨分离请配置独立分离服务）',
  };
}

export async function fetchProviders(): Promise<{
  defaultProviderId: string | null;
  providers: AiProviderConfig[];
  builtinGeminiAvailable?: boolean;
  builtinGeminiModels?: string[];
  securityMode: string;
}> {
  const res = await fetch('/api/ai/providers');
  if (!res.ok) {
    throw new Error(`加载 AI 服务配置失败 (${res.status})`);
  }
  return res.json();
}

export async function saveProvider(payload: {
  id?: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  availableModels?: string[];
  apiKey?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRequestsPerDay?: number;
  customHeadersJson?: string;
  setAsDefault?: boolean;
}): Promise<{ defaultProviderId: string | null; provider: AiProviderConfig }> {
  const res = await fetch('/api/ai/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '保存服务商失败');
  }
  return json;
}

export async function deleteProviderById(id: string): Promise<void> {
  const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || '删除服务商失败');
  }
}

export async function deleteProviderKey(id: string): Promise<AiProviderConfig> {
  const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/key`, {
    method: 'DELETE',
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '删除 API Key 失败');
  }
  return json.provider;
}

export async function setDefaultProviderById(id: string): Promise<void> {
  const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/default`, {
    method: 'POST',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || '切换默认服务商失败');
  }
}

export async function testProviderApi(id: string): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  modelsFound?: number;
  provider?: AiProviderConfig;
}> {
  const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
  return res.json();
}

export async function fetchProviderModels(id: string): Promise<{
  models: DiscoveredModel[];
  supportsModelListing: boolean;
  message?: string;
}> {
  const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/models`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '获取模型列表失败');
  }
  return json;
}

export async function fetchStemServices(): Promise<{
  activeStemServiceId: string | null;
  services: StemServiceConfig[];
}> {
  const res = await fetch('/api/ai/stem-services');
  if (!res.ok) {
    throw new Error('加载音源分离服务配置失败');
  }
  return res.json();
}

export async function saveStemService(payload: {
  id?: string;
  name: string;
  kind: StemServiceKind;
  baseUrl: string;
  endpointPath: string;
  apiKey?: string;
  clearKey?: boolean;
  enabled?: boolean;
  timeoutMs?: number;
  setActive?: boolean;
}): Promise<{ activeStemServiceId: string | null; service: StemServiceConfig }> {
  const res = await fetch('/api/ai/stem-services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || '保存音源分离服务失败');
  }
  return json;
}

export async function setActiveStemServiceId(serviceId: string | null): Promise<void> {
  const res = await fetch('/api/ai/stem-services/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || '切换音源分离服务失败');
  }
}

export async function deleteStemServiceById(id: string): Promise<void> {
  const res = await fetch(`/api/ai/stem-services/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || '删除分离服务失败');
  }
}

export async function testStemServiceById(id: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  service?: StemServiceConfig;
}> {
  const res = await fetch(`/api/ai/stem-services/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
  return res.json();
}
