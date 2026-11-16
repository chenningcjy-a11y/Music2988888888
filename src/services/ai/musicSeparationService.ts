import { MDX_MODEL_CONFIG } from '../../audio/mdxDsp';
import {
  SeparationEngineMode,
  TrackMetadata,
  TrackStemsRecord,
} from '../../types/music';
import { formatFileSize, formatTime } from '../../utils/constants';
import { getAudioBlob, saveTrackStems } from '../storage';
import { fetchStemServices } from './providerManager';

const SUPPORTED_FORMATS = new Set([
  'MP3',
  'FLAC',
  'WAV',
  'AAC',
  'M4A',
  'OGG',
  'OPUS',
  'WEBM',
]);

export interface ServerStemJobDto {
  id: string;
  taskId?: string;
  sourceTrackId?: string;
  sourceTrackTitle?: string;
  sourceTrackArtist?: string;
  status:
    | 'queued'
    | 'downloading-model'
    | 'decoding'
    | 'separating'
    | 'encoding'
    | 'paused'
    | 'completed'
    | 'cancelled'
    | 'interrupted'
    | 'error';
  progress: number;
  stageLabel: string;
  detailLabel?: string;
  stepLabel?: string;
  currentChunk?: number;
  totalChunks?: number;
  estimatedRemainingSec: number | null;
  paused: boolean;
  cancelled: boolean;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  vocalReady: boolean;
  instrumentalReady: boolean;
  vocalSizeBytes?: number;
  instrumentalSizeBytes?: number;
}

function base64ToBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const clean = base64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export interface TrackSeparationPreflight {
  ok: boolean;
  format: string;
  fileSizeBytes: number;
  durationSec: number;
  serviceName: string;
  serviceKind: 'builtin-mdx' | 'remote-demucs-http' | 'none';
  error?: string;
}

export async function checkStemSeparationPreflight(
  track: TrackMetadata | null
): Promise<TrackSeparationPreflight> {
  if (!track) {
    return {
      ok: false,
      format: '-',
      fileSizeBytes: 0,
      durationSec: 0,
      serviceName: '未选择曲目',
      serviceKind: 'none',
      error: '请先选择一首本地音频曲目',
    };
  }

  const fmt = (track.format || '').toUpperCase();
  if (!SUPPORTED_FORMATS.has(fmt)) {
    return {
      ok: false,
      format: fmt || '未知',
      fileSizeBytes: track.fileSize,
      durationSec: track.duration,
      serviceName: '-',
      serviceKind: 'none',
      error: `格式 ${fmt || '未知'} 不受支持，请导入 MP3 / FLAC / WAV / AAC / M4A / OGG / OPUS 文件`,
    };
  }

  if (track.fileSize > 140 * 1024 * 1024) {
    return {
      ok: false,
      format: fmt,
      fileSizeBytes: track.fileSize,
      durationSec: track.duration,
      serviceName: '-',
      serviceKind: 'none',
      error: `文件体积过大 (${formatFileSize(track.fileSize)})，单曲上限为 140 MB`,
    };
  }

  if (track.duration > 15 * 60) {
    return {
      ok: false,
      format: fmt,
      fileSizeBytes: track.fileSize,
      durationSec: track.duration,
      serviceName: '-',
      serviceKind: 'none',
      error: `音频时长 (${formatTime(track.duration)}) 超过 15 分钟处理限制`,
    };
  }

  const stemConfig = await fetchStemServices();
  const active = stemConfig.services.find(
    (s) => s.id === stemConfig.activeStemServiceId
  );

  if (!active || !active.enabled || active.kind === 'none') {
    return {
      ok: false,
      format: fmt,
      fileSizeBytes: track.fileSize,
      durationSec: track.duration,
      serviceName: active?.name || '未配置',
      serviceKind: 'none',
      error:
        '尚未启用任何独立音源分离服务（DeepSeek 等文本模型无法直接分离音轨）。请前往「API 服务管理」开启内置 UVR MDX-Net 或配置外部 Demucs / Spleeter 服务。',
    };
  }

  if (active.kind === 'remote-demucs-http' && !active.baseUrl) {
    return {
      ok: false,
      format: fmt,
      fileSizeBytes: track.fileSize,
      durationSec: track.duration,
      serviceName: active.name,
      serviceKind: active.kind,
      error: `外部音源分离服务「${active.name}」尚未配置 Base URL。`,
    };
  }

  return {
    ok: true,
    format: fmt,
    fileSizeBytes: track.fileSize,
    durationSec: track.duration,
    serviceName: active.name,
    serviceKind: active.kind,
  };
}

export async function hasWorkingWebGpu(): Promise<boolean> {
  try {
    const nav = navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<unknown | null> };
    };
    if (!nav.gpu || typeof nav.gpu.requestAdapter !== 'function') return false;
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export async function resolveEffectiveSeparationBackend(
  mode: SeparationEngineMode,
  serviceKind: 'builtin-mdx' | 'remote-demucs-http' | 'none'
): Promise<'server' | 'local-worker' | 'remote-demucs-http'> {
  if (serviceKind === 'remote-demucs-http') return 'remote-demucs-http';
  if (mode === 'local') return 'local-worker';
  if (mode === 'server') return 'server';
  // In 'auto' mode: use local Web Worker ONLY if real WebGPU hardware acceleration is present;
  // otherwise prefer persistent backend queue (survives page refreshes, handles concurrency safely).
  const gpuReady = await hasWorkingWebGpu();
  return gpuReady ? 'local-worker' : 'server';
}

export async function decodeAudioBlobTo44kStereo(
  blob: Blob
): Promise<{ left: Float32Array; right: Float32Array; duration: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    await decodeCtx.close().catch(() => {});
  }

  const targetRate = MDX_MODEL_CONFIG.sampleRate;
  const duration = decoded.duration;
  const targetFrames = Math.max(1, Math.ceil(duration * targetRate));

  if (decoded.sampleRate === targetRate && decoded.numberOfChannels >= 2) {
    return {
      left: new Float32Array(decoded.getChannelData(0)),
      right: new Float32Array(decoded.getChannelData(1)),
      duration,
    };
  }

  const offline = new OfflineAudioContext(2, targetFrames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  return {
    left: new Float32Array(rendered.getChannelData(0)),
    right: new Float32Array(rendered.getChannelData(1)),
    duration,
  };
}

export async function submitServerStemJob(params: {
  taskId: string;
  track: TrackMetadata;
  audioBlob: Blob;
  signal?: AbortSignal;
}): Promise<ServerStemJobDto> {
  const ext = (params.track.format || 'bin').toLowerCase();
  const qs = new URLSearchParams({
    ext,
    taskId: params.taskId,
    trackId: params.track.id,
    title: params.track.title,
    artist: params.track.artist,
  });

  const res = await fetch(`/api/stems/separate?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: params.audioBlob,
    signal: params.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.jobId) {
    throw new Error(json.error || `提交服务端分离任务失败 (${res.status})`);
  }
  return json.job as ServerStemJobDto;
}

export async function fetchServerStemJobStatus(
  jobId: string,
  signal?: AbortSignal
): Promise<{ statusCode: number; job: ServerStemJobDto | null; error?: string }> {
  const res = await fetch(`/api/stems/job/${encodeURIComponent(jobId)}`, { signal });
  if (res.status === 404) {
    return { statusCode: 404, job: null, error: '服务端分离任务不存在或已过期' };
  }
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    return {
      statusCode: res.status,
      job: null,
      error: errJson.error || `查询服务端任务状态失败 (${res.status})`,
    };
  }
  const job = (await res.json()) as ServerStemJobDto;
  return { statusCode: 200, job };
}

export async function pauseServerStemJobApi(jobId: string): Promise<ServerStemJobDto> {
  const res = await fetch(`/api/stems/job/${encodeURIComponent(jobId)}/pause`, {
    method: 'POST',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || '暂停服务端任务失败');
  return json.job as ServerStemJobDto;
}

export async function resumeServerStemJobApi(jobId: string): Promise<ServerStemJobDto> {
  const res = await fetch(`/api/stems/job/${encodeURIComponent(jobId)}/resume`, {
    method: 'POST',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || '恢复服务端任务失败');
  return json.job as ServerStemJobDto;
}

export async function cancelServerStemJobApi(jobId: string): Promise<void> {
  await fetch(`/api/stems/job/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  }).catch(() => {});
}

export async function deleteServerStemJobApi(jobId: string): Promise<void> {
  await fetch(`/api/stems/job/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

export async function downloadServerStemsAndSave(params: {
  jobId: string;
  trackId: string;
  duration: number;
  signal?: AbortSignal;
}): Promise<TrackStemsRecord> {
  const [vocalRes, instRes] = await Promise.all([
    fetch(`/api/stems/job/${encodeURIComponent(params.jobId)}/download/vocal`, {
      signal: params.signal,
    }),
    fetch(`/api/stems/job/${encodeURIComponent(params.jobId)}/download/instrumental`, {
      signal: params.signal,
    }),
  ]);

  if (!vocalRes.ok || !instRes.ok) {
    throw new Error('下载分离后的人声与伴奏音轨失败');
  }

  const [vocalBlob, instrumentalBlob] = await Promise.all([
    vocalRes.blob(),
    instRes.blob(),
  ]);

  const record: TrackStemsRecord = {
    trackId: params.trackId,
    vocalBlob,
    instrumentalBlob,
    modelId: MDX_MODEL_CONFIG.id,
    modelName: MDX_MODEL_CONFIG.name,
    engineUsed: 'server-onnx',
    duration: params.duration,
    createdAt: Date.now(),
  };

  await saveTrackStems(record);
  return record;
}

export async function executeRemoteDemucsSeparation(params: {
  track: TrackMetadata;
  serviceName: string;
  signal?: AbortSignal;
}): Promise<TrackStemsRecord> {
  const audioBlob = await getAudioBlob(params.track.id);
  if (!audioBlob) {
    throw new Error('本地曲库中未找到该曲目的音频数据');
  }

  const ext = (params.track.format || 'wav').toLowerCase();
  const res = await fetch(
    `/api/ai/stem-remote/separate?filename=${encodeURIComponent(
      `${params.track.title}.${ext}`
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: audioBlob,
      signal: params.signal,
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `外部分离服务失败 (${res.status})`);
  }

  const vocalBlob = base64ToBlob(json.vocalBase64, 'audio/wav');
  const instrumentalBlob = base64ToBlob(json.instrumentalBase64, 'audio/wav');

  const record: TrackStemsRecord = {
    trackId: params.track.id,
    vocalBlob,
    instrumentalBlob,
    modelId: 'remote-demucs',
    modelName: params.serviceName,
    engineUsed: 'server-onnx',
    duration: params.track.duration,
    createdAt: Date.now(),
  };

  await saveTrackStems(record);
  return record;
}
