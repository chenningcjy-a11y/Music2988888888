import * as ort from 'onnxruntime-web';
import {
  accumulateChunk,
  buildChunkPlan,
  encodeStereoWav,
  finalizeStems,
  MDX_MODEL_CONFIG,
  stftChunkToTensor,
  tensorToIstftChunk,
} from '../audio/mdxDsp';
import {
  SeparationEngineMode,
  SeparationProgressState,
  TrackStemsRecord,
} from '../types/music';
import {
  getCachedModelBytes,
  saveCachedModelBytes,
  saveTrackStems,
} from './storage';

const MODEL_DOWNLOAD_ENDPOINT = '/api/stems/model';

let cachedSession: ort.InferenceSession | null = null;
let cachedEngineType: 'local-webgpu' | 'local-wasm' | null = null;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('用户已停止音源分离', 'AbortError');
  }
}

async function downloadModelWithProgress(
  signal: AbortSignal,
  onProgress: (p: SeparationProgressState) => void,
  trackId: string
): Promise<ArrayBuffer> {
  const existing = await getCachedModelBytes(MDX_MODEL_CONFIG.id);
  if (existing && existing.byteLength > 10_000_000) {
    return existing;
  }

  onProgress({
    status: 'downloading-model',
    trackId,
    progress: 2,
    stageLabel: '首次使用正在下载本地 AI 分离模型 (Kim_Vocal_2)',
    detailLabel: '约 66.7 MB，下载后将缓存至本地设备',
    engineLabel: '本地浏览器引擎',
  });

  const res = await fetch(MODEL_DOWNLOAD_ENDPOINT, { signal });
  if (!res.ok) {
    throw new Error(`下载 AI 模型失败 (${res.status})`);
  }

  const totalHeader = Number(res.headers.get('Content-Length') || 66759214);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    await saveCachedModelBytes(MDX_MODEL_CONFIG.id, buf);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      const pct = Math.min(20, Math.round((received / totalHeader) * 20));
      onProgress({
        status: 'downloading-model',
        trackId,
        progress: Math.max(2, pct),
        stageLabel: '正在下载本地 AI 分离模型 (Kim_Vocal_2)',
        detailLabel: `${(received / (1024 * 1024)).toFixed(1)} MB / ${(
          totalHeader /
          (1024 * 1024)
        ).toFixed(1)} MB`,
        engineLabel: '本地浏览器引擎',
      });
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }

  const buffer = combined.buffer;
  await saveCachedModelBytes(MDX_MODEL_CONFIG.id, buffer);
  return buffer;
}

async function ensureLocalSession(
  signal: AbortSignal,
  onProgress: (p: SeparationProgressState) => void,
  trackId: string
): Promise<{
  session: ort.InferenceSession;
  engineUsed: 'local-webgpu' | 'local-wasm';
}> {
  if (cachedSession && cachedEngineType) {
    return { session: cachedSession, engineUsed: cachedEngineType };
  }

  ort.env.wasm.wasmPaths = '/ort-wasm/';
  const supportsSab =
    typeof SharedArrayBuffer !== 'undefined' &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
  ort.env.wasm.numThreads = supportsSab
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1;

  const modelBytes = await downloadModelWithProgress(signal, onProgress, trackId);
  throwIfAborted(signal);

  onProgress({
    status: 'decoding',
    trackId,
    progress: 22,
    stageLabel: '正在初始化本地神经网络推理会话',
    detailLabel: '检测 WebGPU / WebAssembly 硬件加速',
    engineLabel: '本地浏览器引擎',
  });

  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  if (hasWebGpu) {
    try {
      const gpuSession = await ort.InferenceSession.create(
        new Uint8Array(modelBytes),
        {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
        }
      );
      cachedSession = gpuSession;
      cachedEngineType = 'local-webgpu';
      return { session: gpuSession, engineUsed: 'local-webgpu' };
    } catch (gpuErr) {
      console.warn('WebGPU session init failed, falling back to WASM:', gpuErr);
    }
  }

  const wasmSession = await ort.InferenceSession.create(
    new Uint8Array(modelBytes),
    {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }
  );
  cachedSession = wasmSession;
  cachedEngineType = 'local-wasm';
  return { session: wasmSession, engineUsed: 'local-wasm' };
}

async function decodeAndResampleTo44kStereo(
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

async function separateLocallyInBrowser(
  trackId: string,
  blob: Blob,
  signal: AbortSignal,
  onProgress: (p: SeparationProgressState) => void
): Promise<TrackStemsRecord> {
  const { session, engineUsed } = await ensureLocalSession(signal, onProgress, trackId);
  const engineLabel =
    engineUsed === 'local-webgpu' ? '本地 WebGPU (GPU加速)' : '本地 WebAssembly';

  throwIfAborted(signal);
  onProgress({
    status: 'decoding',
    trackId,
    progress: 25,
    stageLabel: '正在解码音频为 44.1kHz 立体声波形',
    detailLabel: '本地解码 · 无需上传文件',
    engineLabel,
  });

  const { left: mixL, right: mixR, duration } = await decodeAndResampleTo44kStereo(blob);
  throwIfAborted(signal);

  const totalSamples = mixL.length;
  const plan = buildChunkPlan(totalSamples);
  const totalChunks = plan.length;

  const accL = new Float32Array(totalSamples);
  const accR = new Float32Array(totalSamples);
  const weightAcc = new Float32Array(totalSamples);

  const chunkLen = MDX_MODEL_CONFIG.chunkSamples;
  const chunkInL = new Float32Array(chunkLen);
  const chunkInR = new Float32Array(chunkLen);
  const chunkOutL = new Float32Array(chunkLen);
  const chunkOutR = new Float32Array(chunkLen);
  const tensorData = new Float32Array(
    1 * 4 * MDX_MODEL_CONFIG.dimF * MDX_MODEL_CONFIG.framesPerChunk
  );

  for (let idx = 0; idx < totalChunks; idx++) {
    throwIfAborted(signal);
    const item = plan[idx];

    onProgress({
      status: 'separating',
      trackId,
      progress: Math.round(28 + (idx / totalChunks) * 64),
      stageLabel: `正在通过 AI 分离人声与伴奏 (${idx + 1}/${totalChunks})`,
      detailLabel: `Kim_Vocal_2 · 分段 ${idx + 1} / ${totalChunks}（可随时停止）`,
      engineLabel,
    });

    // Yield to UI event loop so audio playback, visualizers & stop button remain responsive
    await new Promise((r) => setTimeout(r, 0));
    throwIfAborted(signal);

    chunkInL.fill(0);
    chunkInR.fill(0);
    chunkInL.set(mixL.subarray(item.start, item.end), 0);
    chunkInR.set(mixR.subarray(item.start, item.end), 0);

    stftChunkToTensor(chunkInL, chunkInR, tensorData);
    const inputTensor = new ort.Tensor('float32', tensorData, [
      1,
      4,
      MDX_MODEL_CONFIG.dimF,
      MDX_MODEL_CONFIG.framesPerChunk,
    ]);

    const outputMap = await session.run({ input: inputTensor });
    throwIfAborted(signal);

    const outTensor = outputMap.output.data as Float32Array;
    tensorToIstftChunk(outTensor, chunkOutL, chunkOutR, MDX_MODEL_CONFIG.compensate);
    accumulateChunk(item, totalChunks, chunkOutL, chunkOutR, accL, accR, weightAcc);
  }

  throwIfAborted(signal);
  onProgress({
    status: 'encoding',
    trackId,
    progress: 94,
    stageLabel: '正在生成独立人声与伴奏音轨并写入缓存',
    detailLabel: '44.1kHz / 16-bit 立体声双轨封装',
    engineLabel,
  });

  const { vocalL, vocalR, instL, instR } = finalizeStems(
    mixL,
    mixR,
    accL,
    accR,
    weightAcc
  );

  const vocalBlob = new Blob(
    [encodeStereoWav(vocalL, vocalR, MDX_MODEL_CONFIG.sampleRate) as BlobPart],
    { type: 'audio/wav' }
  );
  const instrumentalBlob = new Blob(
    [encodeStereoWav(instL, instR, MDX_MODEL_CONFIG.sampleRate) as BlobPart],
    { type: 'audio/wav' }
  );

  const record: TrackStemsRecord = {
    trackId,
    vocalBlob,
    instrumentalBlob,
    modelId: MDX_MODEL_CONFIG.id,
    modelName: MDX_MODEL_CONFIG.name,
    engineUsed,
    duration,
    createdAt: Date.now(),
  };

  await saveTrackStems(record);
  return record;
}

async function separateOnServerFallback(
  trackId: string,
  blob: Blob,
  formatExt: string,
  duration: number,
  signal: AbortSignal,
  onProgress: (p: SeparationProgressState) => void
): Promise<TrackStemsRecord> {
  const engineLabel = '服务端 ONNX Runtime (CPU)';

  onProgress({
    status: 'downloading-model',
    trackId,
    progress: 5,
    stageLabel: '正在上传音频至服务端 AI 分离接口',
    detailLabel: `${(blob.size / (1024 * 1024)).toFixed(1)} MB · Kim_Vocal_2`,
    engineLabel,
  });

  const createRes = await fetch(
    `/api/stems/separate?ext=${encodeURIComponent(formatExt.toLowerCase() || 'bin')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
      signal,
    }
  );
  if (!createRes.ok) {
    const errBody = await createRes.json().catch(() => ({}));
    throw new Error(errBody.error || `服务端创建分离任务失败 (${createRes.status})`);
  }

  const { jobId } = (await createRes.json()) as { jobId: string };

  const cancelOnAbort = () => {
    void fetch(`/api/stems/job/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    let consecutivePollErrors = 0;
    while (true) {
      throwIfAborted(signal);
      await new Promise((r) => setTimeout(r, 1200));
      throwIfAborted(signal);

      let statusRes: Response;
      try {
        statusRes = await fetch(`/api/stems/job/${jobId}`, { signal });
      } catch (pollErr) {
        if (pollErr instanceof DOMException && pollErr.name === 'AbortError') {
          throw pollErr;
        }
        consecutivePollErrors++;
        if (consecutivePollErrors >= 5) {
          throw new Error('无法连接服务端分离任务接口，请稍后重试');
        }
        continue;
      }

      if (statusRes.status === 404) {
        throw new Error('服务端分离任务已过期或不存在');
      }
      if (!statusRes.ok) {
        consecutivePollErrors++;
        if (consecutivePollErrors >= 5) {
          throw new Error(`无法获取服务端分离任务进度 (${statusRes.status})`);
        }
        continue;
      }
      consecutivePollErrors = 0;

      const statusData = (await statusRes.json()) as {
        status: string;
        progress: number;
        stageLabel: string;
        detailLabel?: string;
        error?: string;
      };

      if (statusData.status === 'cancelled') {
        throw new DOMException('用户已停止音源分离', 'AbortError');
      }
      if (statusData.status === 'error') {
        throw new Error(statusData.error || '服务端音源分离失败');
      }

      onProgress({
        status:
          statusData.status === 'downloading-model'
            ? 'downloading-model'
            : statusData.status === 'decoding'
            ? 'decoding'
            : statusData.status === 'encoding'
            ? 'encoding'
            : 'separating',
        trackId,
        progress: Math.min(95, Math.max(6, statusData.progress || 10)),
        stageLabel: statusData.stageLabel || '服务端正在执行 AI 音源分离',
        detailLabel: statusData.detailLabel,
        engineLabel,
      });

      if (statusData.status === 'completed') break;
    }

    onProgress({
      status: 'encoding',
      trackId,
      progress: 96,
      stageLabel: '正在下载分离后的人声与伴奏音轨',
      detailLabel: '写入本地 IndexedDB 持久化缓存',
      engineLabel,
    });

    const [vocalRes, instRes] = await Promise.all([
      fetch(`/api/stems/job/${jobId}/download/vocal`, { signal }),
      fetch(`/api/stems/job/${jobId}/download/instrumental`, { signal }),
    ]);
    if (!vocalRes.ok || !instRes.ok) {
      throw new Error('下载分离音轨失败');
    }

    const [vocalBlob, instrumentalBlob] = await Promise.all([
      vocalRes.blob(),
      instRes.blob(),
    ]);

    const record: TrackStemsRecord = {
      trackId,
      vocalBlob,
      instrumentalBlob,
      modelId: MDX_MODEL_CONFIG.id,
      modelName: MDX_MODEL_CONFIG.name,
      engineUsed: 'server-onnx',
      duration,
      createdAt: Date.now(),
    };

    await saveTrackStems(record);
    return record;
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
  }
}

export async function runAiStemSeparation(params: {
  trackId: string;
  audioBlob: Blob;
  format: string;
  duration: number;
  engineMode: SeparationEngineMode;
  signal: AbortSignal;
  onProgress: (p: SeparationProgressState) => void;
}): Promise<TrackStemsRecord> {
  const { trackId, audioBlob, format, duration, engineMode, signal, onProgress } = params;

  if (engineMode === 'server') {
    return separateOnServerFallback(
      trackId,
      audioBlob,
      format,
      duration,
      signal,
      onProgress
    );
  }

  try {
    return await separateLocallyInBrowser(trackId, audioBlob, signal, onProgress);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (engineMode === 'local') {
      throw new Error(
        `本地浏览器模型运行失败（${
          err instanceof Error ? err.message : '未知错误'
        }）。请切换为「自动」或「服务端 AI 处理」后重试。`
      );
    }

    // Auto fallback to server-side ONNX separation
    onProgress({
      status: 'downloading-model',
      trackId,
      progress: 4,
      stageLabel: '本地浏览器运行受限，已自动切换至服务端 AI 分离',
      detailLabel: err instanceof Error ? err.message : undefined,
      engineLabel: '服务端 ONNX Runtime',
    });

    return await separateOnServerFallback(
      trackId,
      audioBlob,
      format,
      duration,
      signal,
      onProgress
    );
  }
}
