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
import { getCachedModelBytes, saveCachedModelBytes } from '../services/storage';

export type WorkerInMessage =
  | {
      type: 'start';
      taskId: string;
      trackId: string;
      leftBuffer: ArrayBuffer;
      rightBuffer: ArrayBuffer;
      duration: number;
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };

export type WorkerOutMessage =
  | {
      type: 'progress';
      taskId: string;
      status: 'downloading-model' | 'decoding' | 'separating' | 'encoding' | 'paused';
      progress: number;
      stageLabel: string;
      detailLabel?: string;
      stepLabel?: string;
      currentChunk?: number;
      totalChunks?: number;
      estimatedRemainingSec?: number | null;
      engineLabel?: string;
    }
  | {
      type: 'completed';
      taskId: string;
      trackId: string;
      vocalWavBuffer: ArrayBuffer;
      instrumentalWavBuffer: ArrayBuffer;
      engineUsed: 'local-webgpu' | 'local-wasm';
      duration: number;
    }
  | {
      type: 'cancelled';
      taskId: string;
    }
  | {
      type: 'error';
      taskId: string;
      error: string;
    };

let cachedSession: ort.InferenceSession | null = null;
let cachedEngineType: 'local-webgpu' | 'local-wasm' | null = null;

let isPaused = false;
let isCancelled = false;
let resumeResolvers: Array<() => void> = [];

function waitWhilePaused(): Promise<void> {
  if (!isPaused || isCancelled) return Promise.resolve();
  return new Promise((resolve) => {
    resumeResolvers.push(resolve);
  });
}

function wakeResumeWaiters(): void {
  const list = resumeResolvers;
  resumeResolvers = [];
  for (const fn of list) fn();
}

async function downloadModelInWorker(taskId: string): Promise<ArrayBuffer> {
  const existing = await getCachedModelBytes(MDX_MODEL_CONFIG.id);
  if (existing && existing.byteLength > 10_000_000) {
    return existing;
  }

  self.postMessage({
    type: 'progress',
    taskId,
    status: 'downloading-model',
    progress: 2,
    stageLabel: '首次使用正在下载本地 AI 模型 (Kim_Vocal_2)',
    detailLabel: '约 66.7 MB · 独立 Web Worker 线程加载',
    engineLabel: '本地 Web Worker',
  } satisfies WorkerOutMessage);

  const res = await fetch('/api/stems/model');
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
    if (isCancelled) {
      await reader.cancel().catch(() => {});
      throw new DOMException('用户已取消任务', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      const pct = Math.min(20, Math.round((received / totalHeader) * 20));
      self.postMessage({
        type: 'progress',
        taskId,
        status: 'downloading-model',
        progress: Math.max(2, pct),
        stageLabel: '正在下载本地 AI 分离模型 (Kim_Vocal_2)',
        detailLabel: `${(received / (1024 * 1024)).toFixed(1)} MB / ${(
          totalHeader /
          (1024 * 1024)
        ).toFixed(1)} MB`,
        engineLabel: '本地 Web Worker',
      } satisfies WorkerOutMessage);
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  await saveCachedModelBytes(MDX_MODEL_CONFIG.id, combined.buffer);
  return combined.buffer;
}

async function ensureWorkerSession(taskId: string): Promise<{
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

  const modelBytes = await downloadModelInWorker(taskId);
  if (isCancelled) throw new DOMException('用户已取消任务', 'AbortError');

  self.postMessage({
    type: 'progress',
    taskId,
    status: 'decoding',
    progress: 22,
    stageLabel: '正在初始化 Web Worker 神经网络推理会话',
    detailLabel: '检测 WebGPU / WebAssembly 硬件加速',
    engineLabel: '本地 Web Worker',
  } satisfies WorkerOutMessage);

  const navGpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  if (navGpu && typeof navGpu.requestAdapter === 'function') {
    try {
      const adapter = await navGpu.requestAdapter();
      if (adapter) {
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
      }
    } catch {
      // Fallback to WASM
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

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  if (msg.type === 'pause') {
    isPaused = true;
    return;
  }
  if (msg.type === 'resume') {
    isPaused = false;
    wakeResumeWaiters();
    return;
  }
  if (msg.type === 'cancel') {
    isCancelled = true;
    isPaused = false;
    wakeResumeWaiters();
    return;
  }

  if (msg.type !== 'start') return;

  isPaused = false;
  isCancelled = false;
  const { taskId, trackId, leftBuffer, rightBuffer, duration } = msg;

  try {
    const mixL = new Float32Array(leftBuffer);
    const mixR = new Float32Array(rightBuffer);

    const { session, engineUsed } = await ensureWorkerSession(taskId);
    const engineLabel =
      engineUsed === 'local-webgpu'
        ? '本地 Web Worker · WebGPU'
        : '本地 Web Worker · WASM';

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

    let elapsedMsSum = 0;
    let completedChunks = 0;

    for (let idx = 0; idx < totalChunks; idx++) {
      if (isCancelled) {
        self.postMessage({ type: 'cancelled', taskId } satisfies WorkerOutMessage);
        return;
      }

      if (isPaused) {
        self.postMessage({
          type: 'progress',
          taskId,
          status: 'paused',
          progress: Math.round(25 + (idx / totalChunks) * 67),
          stageLabel: `本地推理已暂停 (${idx}/${totalChunks})`,
          detailLabel: '等待点击「继续」恢复推理（请保持当前标签页打开）',
          stepLabel: `${idx}/${totalChunks}`,
          currentChunk: idx,
          totalChunks,
          estimatedRemainingSec: null,
          engineLabel,
        } satisfies WorkerOutMessage);
        await waitWhilePaused();
        if (isCancelled) {
          self.postMessage({ type: 'cancelled', taskId } satisfies WorkerOutMessage);
          return;
        }
      }

      const item = plan[idx];
      const currentAvgSec =
        completedChunks >= 1
          ? Math.max(
              1,
              Math.round(((totalChunks - completedChunks) * (elapsedMsSum / completedChunks)) / 1000)
            )
          : null;

      self.postMessage({
        type: 'progress',
        taskId,
        status: 'separating',
        progress: Math.round(25 + (idx / totalChunks) * 67),
        stageLabel: `本地 Web Worker 正在分离 (${idx + 1}/${totalChunks})`,
        detailLabel: `Kim_Vocal_2 · 分段 ${idx + 1} / ${totalChunks}`,
        stepLabel: `${idx + 1}/${totalChunks}`,
        currentChunk: idx + 1,
        totalChunks,
        estimatedRemainingSec: currentAvgSec,
        engineLabel,
      } satisfies WorkerOutMessage);

      // Yield briefly to receive pause/cancel postMessages between chunks
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled) {
        self.postMessage({ type: 'cancelled', taskId } satisfies WorkerOutMessage);
        return;
      }

      const t0 = performance.now();
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
      if (isCancelled) {
        self.postMessage({ type: 'cancelled', taskId } satisfies WorkerOutMessage);
        return;
      }

      const outTensor = outputMap.output.data as Float32Array;
      tensorToIstftChunk(outTensor, chunkOutL, chunkOutR, MDX_MODEL_CONFIG.compensate);
      accumulateChunk(item, totalChunks, chunkOutL, chunkOutR, accL, accR, weightAcc);

      elapsedMsSum += Math.max(1, performance.now() - t0);
      completedChunks++;
    }

    self.postMessage({
      type: 'progress',
      taskId,
      status: 'encoding',
      progress: 94,
      stageLabel: '正在封装人声与伴奏独立 WAV 音轨',
      detailLabel: '44.1kHz / 16-bit 立体声双轨输出',
      stepLabel: `${totalChunks}/${totalChunks}`,
      currentChunk: totalChunks,
      totalChunks,
      estimatedRemainingSec: 1,
      engineLabel,
    } satisfies WorkerOutMessage);

    const { vocalL, vocalR, instL, instR } = finalizeStems(
      mixL,
      mixR,
      accL,
      accR,
      weightAcc
    );
    const vocalWav = encodeStereoWav(vocalL, vocalR, MDX_MODEL_CONFIG.sampleRate);
    const instWav = encodeStereoWav(instL, instR, MDX_MODEL_CONFIG.sampleRate);

    const vCopy = vocalWav.slice().buffer;
    const iCopy = instWav.slice().buffer;

    (
      self as unknown as {
        postMessage(message: WorkerOutMessage, transfer: Transferable[]): void;
      }
    ).postMessage(
      {
        type: 'completed',
        taskId,
        trackId,
        vocalWavBuffer: vCopy,
        instrumentalWavBuffer: iCopy,
        engineUsed,
        duration,
      } satisfies WorkerOutMessage,
      [vCopy, iCopy]
    );
  } catch (err) {
    if (isCancelled || (err instanceof DOMException && err.name === 'AbortError')) {
      self.postMessage({ type: 'cancelled', taskId } satisfies WorkerOutMessage);
    } else {
      self.postMessage({
        type: 'error',
        taskId,
        error: err instanceof Error ? err.message : '本地 Web Worker 分离失败',
      } satisfies WorkerOutMessage);
    }
  }
};
