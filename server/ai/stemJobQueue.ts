import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import {
  accumulateChunk,
  buildChunkPlan,
  encodeStereoWav,
  finalizeStems,
  MDX_MODEL_CONFIG,
  stftChunkToTensor,
  tensorToIstftChunk,
} from '../../src/audio/mdxDsp.ts';

export type ServerStemJobStatus =
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

export interface ServerStemJobPublic {
  id: string;
  taskId?: string;
  sourceTrackId?: string;
  sourceTrackTitle?: string;
  sourceTrackArtist?: string;
  status: ServerStemJobStatus;
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

interface ServerStemJobInternal extends ServerStemJobPublic {
  jobDir: string;
  inputFileName: string;
  vocalFileName: string;
  instrumentalFileName: string;
  ckptFileName: string;
}

const CACHE_ROOT = path.resolve(process.cwd(), '.cache');
const MODEL_CACHE_DIR = path.join(CACHE_ROOT, 'models');
const MODEL_FILE_PATH = path.join(MODEL_CACHE_DIR, MDX_MODEL_CONFIG.filename);
const JOBS_ROOT = path.join(CACHE_ROOT, 'stem-jobs');
const MODEL_SOURCE_URL =
  'https://huggingface.co/aaatmy/uvr-mdx-net-onnx/resolve/main/Kim_Vocal_2.onnx';

const CKPT_MAGIC = Buffer.from('LCKP');
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

let modelDownloadPromise: Promise<string> | null = null;
let cachedNodeOrtSession: import('onnxruntime-node').InferenceSession | null = null;
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;

const jobsMap = new Map<string, ServerStemJobInternal>();
const pendingQueue: string[] = [];
let activeRunningJobId: string | null = null;
let initialized = false;

async function fileMatchesSha256(filePath: string, expectedSha: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size < 10_000_000) return false;
    return await new Promise<boolean>((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex') === expectedSha));
      stream.on('error', () => resolve(false));
    });
  } catch {
    return false;
  }
}

export async function getServerModelStatus() {
  const cached = await fileMatchesSha256(MODEL_FILE_PATH, MDX_MODEL_CONFIG.sha256);
  const stat = cached ? await fsp.stat(MODEL_FILE_PATH).catch(() => null) : null;
  return {
    modelId: MDX_MODEL_CONFIG.id,
    modelName: MDX_MODEL_CONFIG.name,
    cachedOnServer: cached,
    sizeBytes: stat?.size || 66759214,
    sha256: MDX_MODEL_CONFIG.sha256,
  };
}

export async function ensureServerModelCached(): Promise<string> {
  if (await fileMatchesSha256(MODEL_FILE_PATH, MDX_MODEL_CONFIG.sha256)) {
    return MODEL_FILE_PATH;
  }
  if (modelDownloadPromise) return modelDownloadPromise;

  modelDownloadPromise = (async () => {
    await fsp.mkdir(MODEL_CACHE_DIR, { recursive: true });
    const tmpPath = `${MODEL_FILE_PATH}.downloading`;

    const res = await fetch(MODEL_SOURCE_URL, {
      headers: { 'User-Agent': 'LUMINA-MUSIC/1.0' },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) {
      throw new Error(`无法下载 AI 分离模型 (${res.status})`);
    }

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmpPath);
    const readable = Readable.fromWeb(
      res.body as unknown as import('node:stream/web').ReadableStream
    );

    await new Promise<void>((resolve, reject) => {
      readable.on('data', (chunk: Buffer) => {
        hash.update(chunk);
      });
      readable.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      readable.on('error', reject);
    });

    const digest = hash.digest('hex');
    if (digest !== MDX_MODEL_CONFIG.sha256) {
      await fsp.rm(tmpPath, { force: true });
      throw new Error('下载的 AI 模型文件校验失败 (SHA-256 不匹配)');
    }

    await fsp.rename(tmpPath, MODEL_FILE_PATH);
    return MODEL_FILE_PATH;
  })().finally(() => {
    modelDownloadPromise = null;
  });

  return modelDownloadPromise;
}

function scheduleIdleSessionRelease(): void {
  if (idleReleaseTimer) {
    clearTimeout(idleReleaseTimer);
  }
  idleReleaseTimer = setTimeout(() => {
    const hasActiveJob =
      activeRunningJobId !== null ||
      pendingQueue.length > 0 ||
      Array.from(jobsMap.values()).some((j) =>
        ['queued', 'downloading-model', 'decoding', 'separating', 'encoding'].includes(
          j.status
        )
      );
    if (!hasActiveJob && cachedNodeOrtSession) {
      const s = cachedNodeOrtSession;
      cachedNodeOrtSession = null;
      void s.release().catch(() => {});
    }
  }, 2 * 60 * 1000);
}

async function getServerOrtSession(): Promise<import('onnxruntime-node').InferenceSession> {
  if (idleReleaseTimer) {
    clearTimeout(idleReleaseTimer);
    idleReleaseTimer = null;
  }
  if (cachedNodeOrtSession) return cachedNodeOrtSession;
  const modelPath = await ensureServerModelCached();
  const ortMod = await import('onnxruntime-node');
  const ort = (ortMod as unknown as { default?: typeof ortMod }).default?.InferenceSession
    ? (ortMod as unknown as { default: typeof ortMod }).default
    : ortMod;
  cachedNodeOrtSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    enableCpuMemArena: false,
  });
  return cachedNodeOrtSession;
}

async function decodeTo44kStereoFloat32(
  inputPath: string
): Promise<{ left: Float32Array; right: Float32Array }> {
  return await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v',
      'error',
      '-i',
      inputPath,
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-ar',
      String(MDX_MODEL_CONFIG.sampleRate),
      '-ac',
      '2',
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    let errText = '';
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', (d: Buffer) => {
      errText += d.toString();
    });
    ff.on('error', (err) => reject(err));
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`音频解码失败: ${errText || `ffmpeg exit ${code}`}`));
        return;
      }
      const full = Buffer.concat(chunks);
      const totalSamples = Math.floor(full.byteLength / 8);
      if (totalSamples <= 0) {
        reject(new Error('音频解码为空，请确认文件未损坏'));
        return;
      }
      const interleaved = new Float32Array(
        full.buffer,
        full.byteOffset,
        totalSamples * 2
      );
      const left = new Float32Array(totalSamples);
      const right = new Float32Array(totalSamples);
      for (let i = 0; i < totalSamples; i++) {
        left[i] = interleaved[i * 2];
        right[i] = interleaved[i * 2 + 1];
      }
      resolve({ left, right });
    });
  });
}

function toPublicJob(job: ServerStemJobInternal): ServerStemJobPublic {
  return {
    id: job.id,
    taskId: job.taskId,
    sourceTrackId: job.sourceTrackId,
    sourceTrackTitle: job.sourceTrackTitle,
    sourceTrackArtist: job.sourceTrackArtist,
    status: job.status,
    progress: job.progress,
    stageLabel: job.stageLabel,
    detailLabel: job.detailLabel,
    stepLabel: job.stepLabel,
    currentChunk: job.currentChunk,
    totalChunks: job.totalChunks,
    estimatedRemainingSec: job.estimatedRemainingSec,
    paused: job.paused,
    cancelled: job.cancelled,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    vocalReady: job.vocalReady,
    instrumentalReady: job.instrumentalReady,
    vocalSizeBytes: job.vocalSizeBytes,
    instrumentalSizeBytes: job.instrumentalSizeBytes,
  };
}

async function persistJobManifest(job: ServerStemJobInternal): Promise<void> {
  try {
    await fsp.mkdir(job.jobDir, { recursive: true });
    const manifestPath = path.join(job.jobDir, 'job.json');
    await fsp.writeFile(manifestPath, JSON.stringify(job, null, 2), 'utf8');
  } catch {
    // Non-fatal if job folder was already deleted
  }
}

async function saveCheckpoint(
  ckptPath: string,
  data: {
    nextChunkIdx: number;
    totalSamples: number;
    elapsedMsSum: number;
    completedChunks: number;
    accL: Float32Array;
    accR: Float32Array;
    weightAcc: Float32Array;
  }
): Promise<void> {
  const header = Buffer.alloc(24);
  CKPT_MAGIC.copy(header, 0);
  header.writeUInt32LE(data.nextChunkIdx, 4);
  header.writeUInt32LE(data.totalSamples, 8);
  header.writeDoubleLE(data.elapsedMsSum, 12);
  header.writeUInt32LE(data.completedChunks, 20);

  const accLBuf = Buffer.from(data.accL.buffer, data.accL.byteOffset, data.accL.byteLength);
  const accRBuf = Buffer.from(data.accR.buffer, data.accR.byteOffset, data.accR.byteLength);
  const wBuf = Buffer.from(
    data.weightAcc.buffer,
    data.weightAcc.byteOffset,
    data.weightAcc.byteLength
  );

  const tmpPath = `${ckptPath}.tmp`;
  await fsp.writeFile(tmpPath, Buffer.concat([header, accLBuf, accRBuf, wBuf]));
  await fsp.rename(tmpPath, ckptPath);
}

async function loadCheckpoint(
  ckptPath: string,
  expectedSamples: number
): Promise<{
  nextChunkIdx: number;
  elapsedMsSum: number;
  completedChunks: number;
  accL: Float32Array;
  accR: Float32Array;
  weightAcc: Float32Array;
} | null> {
  try {
    const buf = await fsp.readFile(ckptPath);
    if (buf.byteLength < 24) return null;
    if (!buf.subarray(0, 4).equals(CKPT_MAGIC)) return null;
    const nextChunkIdx = buf.readUInt32LE(4);
    const totalSamples = buf.readUInt32LE(8);
    if (totalSamples !== expectedSamples) return null;
    const elapsedMsSum = buf.readDoubleLE(12);
    const completedChunks = buf.readUInt32LE(20);

    const vecBytes = totalSamples * 4;
    if (buf.byteLength < 24 + vecBytes * 3) return null;

    const accL = new Float32Array(totalSamples);
    const accR = new Float32Array(totalSamples);
    const weightAcc = new Float32Array(totalSamples);
    Buffer.from(accL.buffer).set(buf.subarray(24, 24 + vecBytes));
    Buffer.from(accR.buffer).set(buf.subarray(24 + vecBytes, 24 + vecBytes * 2));
    Buffer.from(weightAcc.buffer).set(buf.subarray(24 + vecBytes * 2, 24 + vecBytes * 3));

    return { nextChunkIdx, elapsedMsSum, completedChunks, accL, accR, weightAcc };
  } catch {
    return null;
  }
}

export async function initStemJobQueue(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await fsp.mkdir(JOBS_ROOT, { recursive: true });
  const entries = await fsp.readdir(JOBS_ROOT, { withFileTypes: true }).catch(() => []);
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobDir = path.join(JOBS_ROOT, entry.name);
    const manifestPath = path.join(jobDir, 'job.json');
    try {
      const raw = await fsp.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as ServerStemJobInternal;
      if (!parsed?.id) continue;

      if (now - (parsed.createdAt || now) > JOB_TTL_MS) {
        await fsp.rm(jobDir, { recursive: true, force: true });
        continue;
      }

      const vocalPath = path.join(jobDir, parsed.vocalFileName || 'vocal.wav');
      const instPath = path.join(jobDir, parsed.instrumentalFileName || 'instrumental.wav');
      const inputPath = path.join(jobDir, parsed.inputFileName || 'input.bin');
      const ckptPath = path.join(jobDir, parsed.ckptFileName || 'ckpt.bin');

      if (parsed.status === 'completed') {
        const vExists = fs.existsSync(vocalPath);
        const iExists = fs.existsSync(instPath);
        if (!vExists || !iExists) {
          parsed.status = 'interrupted';
          parsed.stageLabel = '分离结果文件已丢失';
          parsed.error = '服务端分离输出文件缺失，请重试任务';
        }
      } else if (
        ['queued', 'downloading-model', 'decoding', 'separating', 'encoding'].includes(
          parsed.status
        )
      ) {
        if (fs.existsSync(inputPath) && fs.existsSync(ckptPath)) {
          parsed.status = 'paused';
          parsed.paused = true;
          parsed.stageLabel = `服务端重启前已保存进度 (${parsed.stepLabel || ''})，点击继续`;
          parsed.estimatedRemainingSec = null;
        } else if (fs.existsSync(inputPath)) {
          parsed.status = 'interrupted';
          parsed.stageLabel = '服务端重启导致处理中断（可重试继续）';
          parsed.error = '服务端进程重启导致任务中断，原始音频仍保留，点击重试可继续执行。';
          parsed.estimatedRemainingSec = null;
        } else {
          parsed.status = 'interrupted';
          parsed.stageLabel = '服务端重启导致任务中断';
          parsed.error = '服务端重启前任务尚未完成，请重新提交。';
          parsed.estimatedRemainingSec = null;
        }
        await persistJobManifest(parsed);
      }

      parsed.jobDir = jobDir;
      jobsMap.set(parsed.id, parsed);
    } catch {
      // Ignore corrupt job directories
    }
  }
}

async function runJobExecution(job: ServerStemJobInternal): Promise<void> {
  const inputPath = path.join(job.jobDir, job.inputFileName);
  const ckptPath = path.join(job.jobDir, job.ckptFileName);

  try {
    if (job.cancelled) {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      await persistJobManifest(job);
      return;
    }
    if (job.paused) {
      job.status = 'paused';
      await persistJobManifest(job);
      return;
    }

    job.startedAt = job.startedAt || Date.now();
    job.status = 'downloading-model';
    job.progress = Math.max(job.progress, 3);
    job.stageLabel = '正在准备服务端 AI 模型 (Kim_Vocal_2)';
    job.detailLabel = '加载 UVR MDX-Net 神经网络权重';
    await persistJobManifest(job);

    const session = await getServerOrtSession();
    if (job.cancelled) {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      await persistJobManifest(job);
      return;
    }
    if (job.paused) {
      job.status = 'paused';
      job.stageLabel = '任务已暂停';
      await persistJobManifest(job);
      return;
    }

    if (!fs.existsSync(inputPath)) {
      throw new Error('服务端原始音频缓存文件不存在，请重新提交任务');
    }

    job.status = 'decoding';
    job.progress = Math.max(job.progress, 8);
    job.stageLabel = '正在解码音频为 44.1kHz 立体声';
    job.detailLabel = job.sourceTrackTitle || job.inputFileName;
    await persistJobManifest(job);

    const { left: mixL, right: mixR } = await decodeTo44kStereoFloat32(inputPath);
    if (job.cancelled) {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      await persistJobManifest(job);
      return;
    }

    const totalSamples = mixL.length;
    const plan = buildChunkPlan(totalSamples);
    const totalChunks = plan.length;
    job.totalChunks = totalChunks;

    let accL: Float32Array<ArrayBufferLike> = new Float32Array(totalSamples);
    let accR: Float32Array<ArrayBufferLike> = new Float32Array(totalSamples);
    let weightAcc: Float32Array<ArrayBufferLike> = new Float32Array(totalSamples);
    let startIdx = 0;
    let elapsedMsSum = 0;
    let completedChunks = 0;

    const existingCkpt = await loadCheckpoint(ckptPath, totalSamples);
    if (existingCkpt && existingCkpt.nextChunkIdx <= totalChunks) {
      startIdx = existingCkpt.nextChunkIdx;
      elapsedMsSum = existingCkpt.elapsedMsSum;
      completedChunks = existingCkpt.completedChunks;
      accL = existingCkpt.accL;
      accR = existingCkpt.accR;
      weightAcc = existingCkpt.weightAcc;
    }

    const chunkLen = MDX_MODEL_CONFIG.chunkSamples;
    const chunkInL = new Float32Array(chunkLen);
    const chunkInR = new Float32Array(chunkLen);
    const chunkOutL = new Float32Array(chunkLen);
    const chunkOutR = new Float32Array(chunkLen);
    const tensorData = new Float32Array(
      1 * 4 * MDX_MODEL_CONFIG.dimF * MDX_MODEL_CONFIG.framesPerChunk
    );

    const ortMod = await import('onnxruntime-node');
    const ort = (ortMod as unknown as { default?: typeof ortMod }).default?.Tensor
      ? (ortMod as unknown as { default: typeof ortMod }).default
      : ortMod;

    job.status = 'separating';

    for (let idx = startIdx; idx < totalChunks; idx++) {
      if (job.cancelled) {
        job.status = 'cancelled';
        job.stageLabel = '任务已取消';
        job.estimatedRemainingSec = null;
        job.finishedAt = Date.now();
        await persistJobManifest(job);
        return;
      }

      if (job.paused) {
        await saveCheckpoint(ckptPath, {
          nextChunkIdx: idx,
          totalSamples,
          elapsedMsSum,
          completedChunks,
          accL,
          accR,
          weightAcc,
        });
        job.status = 'paused';
        job.currentChunk = idx;
        job.stepLabel = `${idx}/${totalChunks}`;
        job.stageLabel = `已暂停分离 (${idx}/${totalChunks})`;
        job.detailLabel = '已保存分段进度，点击「继续」可从断点恢复';
        job.estimatedRemainingSec = null;
        await persistJobManifest(job);
        return;
      }

      const item = plan[idx];
      job.currentChunk = idx + 1;
      job.stepLabel = `${idx + 1}/${totalChunks}`;
      job.stageLabel = `正在分离人声与伴奏 (${idx + 1}/${totalChunks})`;
      job.detailLabel = `UVR MDX-Net · Kim_Vocal_2 · 分段 ${idx + 1}/${totalChunks}`;
      if (idx === startIdx) {
        job.progress = Math.max(
          job.progress,
          Math.round(10 + ((idx + 0.15) / totalChunks) * 82)
        );
        await persistJobManifest(job);
      }

      const chunkT0 = performance.now();
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
      const outputs = await session.run({ input: inputTensor });

      if (job.cancelled) {
        job.status = 'cancelled';
        job.stageLabel = '任务已取消';
        job.estimatedRemainingSec = null;
        job.finishedAt = Date.now();
        await persistJobManifest(job);
        return;
      }

      const outTensor = outputs.output.data as Float32Array;
      tensorToIstftChunk(outTensor, chunkOutL, chunkOutR, MDX_MODEL_CONFIG.compensate);
      accumulateChunk(item, totalChunks, chunkOutL, chunkOutR, accL, accR, weightAcc);

      const chunkElapsedMs = Math.max(1, performance.now() - chunkT0);
      elapsedMsSum += chunkElapsedMs;
      completedChunks++;

      const remainingChunks = Math.max(0, totalChunks - (idx + 1));
      const avgChunkMs = elapsedMsSum / completedChunks;
      job.estimatedRemainingSec =
        remainingChunks > 0 ? Math.max(1, Math.round((remainingChunks * avgChunkMs) / 1000)) : 1;
      job.progress = Math.max(
        job.progress,
        Math.round(10 + ((idx + 1) / totalChunks) * 82)
      );

      if (job.paused) {
        await saveCheckpoint(ckptPath, {
          nextChunkIdx: idx + 1,
          totalSamples,
          elapsedMsSum,
          completedChunks,
          accL,
          accR,
          weightAcc,
        });
        job.status = 'paused';
        job.currentChunk = idx + 1;
        job.stepLabel = `${idx + 1}/${totalChunks}`;
        job.stageLabel = `已暂停分离 (${idx + 1}/${totalChunks})`;
        job.detailLabel = '已保存分段进度，点击「继续」可从断点恢复';
        job.estimatedRemainingSec = null;
        await persistJobManifest(job);
        return;
      }

      if ((idx + 1) % 3 === 0 || idx + 1 === totalChunks) {
        await persistJobManifest(job);
      }
    }

    job.status = 'encoding';
    job.progress = 94;
    job.stageLabel = '正在封装人声与伴奏独立音轨 (WAV)';
    job.detailLabel = '44.1kHz / 16-bit 立体声双轨输出';
    job.estimatedRemainingSec = 1;
    await persistJobManifest(job);

    const { vocalL, vocalR, instL, instR } = finalizeStems(
      mixL,
      mixR,
      accL,
      accR,
      weightAcc
    );

    const vocalWav = encodeStereoWav(vocalL, vocalR, MDX_MODEL_CONFIG.sampleRate);
    const instWav = encodeStereoWav(instL, instR, MDX_MODEL_CONFIG.sampleRate);

    const vocalPath = path.join(job.jobDir, job.vocalFileName);
    const instPath = path.join(job.jobDir, job.instrumentalFileName);
    await Promise.all([fsp.writeFile(vocalPath, vocalWav), fsp.writeFile(instPath, instWav)]);

    job.vocalReady = true;
    job.instrumentalReady = true;
    job.vocalSizeBytes = vocalWav.byteLength;
    job.instrumentalSizeBytes = instWav.byteLength;
    job.progress = 100;
    job.status = 'completed';
    job.stageLabel = '服务端 AI 音源分离完成';
    job.detailLabel = '已生成独立 Vocal 与 Instrumental 音轨';
    job.estimatedRemainingSec = 0;
    job.finishedAt = Date.now();
    await persistJobManifest(job);

    // Clean temporary input & checkpoint once WAV stems are safely written
    await Promise.all([
      fsp.rm(inputPath, { force: true }).catch(() => {}),
      fsp.rm(ckptPath, { force: true }).catch(() => {}),
    ]);
  } catch (err) {
    if (job.cancelled) {
      job.status = 'cancelled';
      job.stageLabel = '任务已取消';
    } else {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : '服务端 AI 分离失败';
      job.stageLabel = '服务端 AI 分离失败';
    }
    job.estimatedRemainingSec = null;
    job.finishedAt = Date.now();
    await persistJobManifest(job);
  }
}

function pumpQueue(): void {
  if (activeRunningJobId) return;

  while (pendingQueue.length > 0) {
    const nextId = pendingQueue.shift()!;
    const job = jobsMap.get(nextId);
    if (!job || job.cancelled || job.paused || job.status === 'completed') {
      continue;
    }

    activeRunningJobId = nextId;
    void runJobExecution(job).finally(() => {
      if (activeRunningJobId === nextId) {
        activeRunningJobId = null;
      }
      scheduleIdleSessionRelease();
      pumpQueue();
    });
    return;
  }

  scheduleIdleSessionRelease();
}

export async function enqueueServerStemJob(params: {
  audioBuffer: Buffer;
  ext: string;
  taskId?: string;
  sourceTrackId?: string;
  sourceTrackTitle?: string;
  sourceTrackArtist?: string;
}): Promise<ServerStemJobPublic> {
  await initStemJobQueue();

  const jobId = crypto.randomUUID();
  const jobDir = path.join(JOBS_ROOT, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  const safeExt = (params.ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  const inputFileName = `input.${safeExt}`;
  await fsp.writeFile(path.join(jobDir, inputFileName), params.audioBuffer);

  const job: ServerStemJobInternal = {
    id: jobId,
    taskId: params.taskId,
    sourceTrackId: params.sourceTrackId,
    sourceTrackTitle: params.sourceTrackTitle,
    sourceTrackArtist: params.sourceTrackArtist,
    status: 'queued',
    progress: 0,
    stageLabel: activeRunningJobId
      ? '等待后台队列调度（已有分离任务正在执行）'
      : '正在初始化服务端 AI 分离任务',
    detailLabel: params.sourceTrackTitle
      ? `曲目：${params.sourceTrackTitle}`
      : 'UVR MDX-Net 任务队列',
    estimatedRemainingSec: null,
    paused: false,
    cancelled: false,
    createdAt: Date.now(),
    vocalReady: false,
    instrumentalReady: false,
    jobDir,
    inputFileName,
    vocalFileName: 'vocal.wav',
    instrumentalFileName: 'instrumental.wav',
    ckptFileName: 'ckpt.bin',
  };

  jobsMap.set(jobId, job);
  await persistJobManifest(job);

  pendingQueue.push(jobId);
  pumpQueue();

  return toPublicJob(job);
}

export async function getServerStemJob(jobId: string): Promise<ServerStemJobPublic | null> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  return job ? toPublicJob(job) : null;
}

export async function listServerStemJobs(): Promise<ServerStemJobPublic[]> {
  await initStemJobQueue();
  return Array.from(jobsMap.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublicJob);
}

export async function pauseServerStemJob(jobId: string): Promise<ServerStemJobPublic | null> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  if (!job) return null;
  if (['completed', 'cancelled', 'error'].includes(job.status)) {
    return toPublicJob(job);
  }

  job.paused = true;
  if (job.status === 'queued') {
    job.status = 'paused';
    job.stageLabel = '已暂停分离（排队中）';
    job.detailLabel = '点击「继续」将重新加入后台队列';
    await persistJobManifest(job);
  } else {
    job.stageLabel = '正在当前分段结束后暂停…';
    await persistJobManifest(job);
  }
  return toPublicJob(job);
}

export async function resumeServerStemJob(jobId: string): Promise<ServerStemJobPublic | null> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'cancelled') {
    return toPublicJob(job);
  }

  const inputPath = path.join(job.jobDir, job.inputFileName);
  if (!fs.existsSync(inputPath)) {
    throw new Error('原始音频文件已不存在，无法继续，请重新发起分离任务');
  }

  job.paused = false;
  job.cancelled = false;
  job.error = undefined;
  job.status = 'queued';
  job.stageLabel = activeRunningJobId
    ? '已恢复，等待后台分离队列调度'
    : '已恢复，准备继续 AI 分离';
  await persistJobManifest(job);

  if (!pendingQueue.includes(jobId) && activeRunningJobId !== jobId) {
    pendingQueue.push(jobId);
  }
  pumpQueue();
  return toPublicJob(job);
}

export async function cancelServerStemJob(jobId: string): Promise<ServerStemJobPublic | null> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  if (!job) return null;

  job.cancelled = true;
  job.paused = false;
  if (job.status === 'queued' || job.status === 'paused' || job.status === 'interrupted') {
    job.status = 'cancelled';
    job.stageLabel = '任务已取消';
    job.estimatedRemainingSec = null;
    job.finishedAt = Date.now();
    await persistJobManifest(job);
    await Promise.all([
      fsp.rm(path.join(job.jobDir, job.inputFileName), { force: true }).catch(() => {}),
      fsp.rm(path.join(job.jobDir, job.ckptFileName), { force: true }).catch(() => {}),
    ]);
  } else if (job.status !== 'completed') {
    job.stageLabel = '正在取消任务…';
    await persistJobManifest(job);
  }
  return toPublicJob(job);
}

export async function deleteServerStemJob(jobId: string): Promise<boolean> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  jobsMap.delete(jobId);
  await fsp.rm(job.jobDir, { recursive: true, force: true }).catch(() => {});
  return true;
}

export async function getServerStemDownloadPath(
  jobId: string,
  stem: string
): Promise<string | null> {
  await initStemJobQueue();
  const job = jobsMap.get(jobId);
  if (!job || job.status !== 'completed') return null;
  const fileName =
    stem === 'vocal'
      ? job.vocalFileName
      : stem === 'instrumental'
      ? job.instrumentalFileName
      : null;
  if (!fileName) return null;
  const fullPath = path.join(job.jobDir, fileName);
  return fs.existsSync(fullPath) ? fullPath : null;
}
