import { TrackMetadata, TrackMvMeta } from '../../types/music';
import { parseLrc } from '../../utils/lrcParser';
import { getAudioBlob, getMvRecordById } from '../storage';

export interface MultiBandAcousticFrames {
  frameDurSec: number; // 0.1s per frame (10 Hz)
  durationSec: number;
  hasAudio: boolean;
  energy: Float32Array;
  bass: Float32Array;
  mid: Float32Array;
  onset: Float32Array;
  rmsNorm: Float32Array;
}

export interface LocalMidBreakDetection {
  id: string;
  label: string;
  audioTriggerSec: number;
  mvStartSec: number;
  mvEndSec: number;
  confidence: 'high' | 'medium' | 'low';
  preCorrelation: number;
  postCorrelation: number;
  reason: string;
  evidenceTimestamps: number[];
}

export interface LocalLagPlateau {
  index: number;
  songStartSec: number;
  songEndSec: number;
  mvStartSec: number;
  mvEndSec: number;
  lagSec: number;
  meanCorrelation: number;
}

export interface LocalFullTrackAnalysisResult {
  mvDurationSec: number;
  songDurationSec: number;
  mvHasAudio: boolean;
  songHasAudio: boolean;
  fullTrackCoveragePct: number;
  meanCorrelation: number;
  peakCorrelation: number;
  plateaus: LocalLagPlateau[];
  intro: {
    recommended: boolean;
    introEndSec: number;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    evidenceTimestamps: number[];
  };
  midBreaks: LocalMidBreakDetection[];
  outro: {
    recommended: boolean;
    outroStartSec: number;
    outroEndSec: number;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    evidenceTimestamps: number[];
  };
  recommendedFadeSec: number;
  summary: string;
  mvSilenceSegments: { startSec: number; endSec: number; avgLevel: number }[];
  mvEnergyTimeline: { tSec: number; level: number }[];
  songEnergyTimeline: { tSec: number; level: number }[];
}

export type LocalEnginePreset =
  | 'standard'
  | 'anti-dialogue'
  | 'silence-split'
  | 'fast-envelope';

export const BASE_LOCAL_PRESETS: LocalEnginePreset[] = [
  'standard',
  'anti-dialogue',
  'silence-split',
  'fast-envelope',
];

export interface LocalEnsembleCandidate {
  preset: LocalEnginePreset;
  name: string;
  modelCode: string;
  result: LocalFullTrackAnalysisResult;
  introAgreeCount: number;
  midAgreeCount: number;
  outroAgreeCount: number;
  exactAllMatchCount: number;
  totalAgreePoints: number;
  isWinner: boolean;
  inWinningGroup: boolean;
}

export interface LocalEnsembleAnalysisResult {
  winningResult: LocalFullTrackAnalysisResult;
  winningPreset: LocalEnginePreset;
  winningPresetName: string;
  candidates: LocalEnsembleCandidate[];
  introConsensusCount: number;
  midConsensusCount: number;
  outroConsensusCount: number;
  exactGroupCount: number;
  consensusSummary: string;
}

export interface LocalEnginePresetConfig {
  id: LocalEnginePreset;
  name: string;
  modelCode: string;
  badge: string;
  description: string;
  weights: { energy: number; bass: number; mid: number; onset: number };
  switchPenalty: number;
  minGapSec: number;
  quietBonusWeight: number;
  coarseStepBase: number;
}

export const LOCAL_ENGINE_PRESETS: Record<
  LocalEnginePreset,
  LocalEnginePresetConfig
> = {
  standard: {
    id: 'standard',
    name: '本地全曲标准声纹模型',
    modelCode: 'DSP-Hough-Standard',
    badge: '默认推荐 · 均衡精确',
    description:
      '全频段能量 + 低音鼓点 + 中频人声 + 瞬态对齐，适合绝大多数常规 MV。',
    weights: { energy: 0.4, bass: 0.35, mid: 0.15, onset: 0.1 },
    switchPenalty: 0.92,
    minGapSec: 2.0,
    quietBonusWeight: 0.4,
    coarseStepBase: 2,
  },
  'anti-dialogue': {
    id: 'anti-dialogue',
    name: '本地抗对白鼓点穿透模型',
    modelCode: 'DSP-SubBass-Lock',
    badge: '剧情 / 对白 / 音效多首选',
    description:
      '重度强化 20-180Hz 超低频底鼓权重（抑制对白与环境噪音），专注在剧情与旁白声中锁住节拍。',
    weights: { energy: 0.25, bass: 0.6, mid: 0.03, onset: 0.12 },
    switchPenalty: 0.8,
    minGapSec: 1.8,
    quietBonusWeight: 0.6,
    coarseStepBase: 2,
  },
  'silence-split': {
    id: 'silence-split',
    name: '本地静默临界高敏切分模型',
    modelCode: 'DSP-Silence-Edge',
    badge: '长黑场 / 安静停顿多首选',
    description:
      '提升中段静默停顿与片头/片尾能量拐点捕捉灵敏度，专抓轻声过场与字幕静音尾声。',
    weights: { energy: 0.45, bass: 0.28, mid: 0.12, onset: 0.15 },
    switchPenalty: 0.65,
    minGapSec: 1.5,
    quietBonusWeight: 0.78,
    coarseStepBase: 2,
  },
  'fast-envelope': {
    id: 'fast-envelope',
    name: '本地极速轻量包络模型',
    modelCode: 'DSP-Fast-Envelope',
    badge: '长视频 / 手机极速首选',
    description:
      '轻量级全局快速扫描与降耗对齐，适合 10 分钟以上大视频或快速初筛试听。',
    weights: { energy: 0.55, bass: 0.35, mid: 0.0, onset: 0.1 },
    switchPenalty: 0.95,
    minGapSec: 2.2,
    quietBonusWeight: 0.35,
    coarseStepBase: 4,
  },
};

const FRAME_DUR_SEC = 0.1;

function extractFramesFromAudioBuffer(
  audioBuffer: AudioBuffer,
  frameDurSec = FRAME_DUR_SEC
): MultiBandAcousticFrames {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate || 44100;
  const totalSamples = audioBuffer.length;
  const durationSec = audioBuffer.duration || totalSamples / sampleRate;

  if (channelCount === 0 || totalSamples === 0 || durationSec <= 0) {
    return {
      frameDurSec,
      durationSec: 0,
      hasAudio: false,
      energy: new Float32Array(0),
      bass: new Float32Array(0),
      mid: new Float32Array(0),
      onset: new Float32Array(0),
      rmsNorm: new Float32Array(0),
    };
  }

  const samplesPerFrame = Math.max(64, Math.round(sampleRate * frameDurSec));
  const numFrames = Math.max(1, Math.floor(totalSamples / samplesPerFrame));

  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  // Recursive 1-pole filter coefficients for multi-band separation
  const alpha180 = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const alpha300 = 1 - Math.exp((-2 * Math.PI * 300) / sampleRate);
  const alpha3400 = 1 - Math.exp((-2 * Math.PI * 3400) / sampleRate);

  let lp180a = 0;
  let lp180b = 0;
  let lp3400 = 0;
  let lp300 = 0;

  const energy = new Float32Array(numFrames);
  const bass = new Float32Array(numFrames);
  const mid = new Float32Array(numFrames);
  const rawRms = new Float32Array(numFrames);
  let maxRms = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * samplesPerFrame;
    const end = f === numFrames - 1 ? totalSamples : start + samplesPerFrame;
    let sumSqTotal = 0;
    let sumSqBass = 0;
    let sumSqMid = 0;
    const count = Math.max(1, end - start);

    for (let i = start; i < end; i++) {
      let mono = 0;
      for (let c = 0; c < channelCount; c++) {
        mono += channels[c][i] || 0;
      }
      if (channelCount > 1) mono /= channelCount;

      // 2-pole ~180Hz low-pass for kick & bassline envelope
      lp180a += alpha180 * (mono - lp180a);
      lp180b += alpha180 * (lp180a - lp180b);

      // 300Hz..3400Hz band-pass for vocals & harmonic core
      lp3400 += alpha3400 * (mono - lp3400);
      lp300 += alpha300 * (lp3400 - lp300);
      const midVal = lp3400 - lp300;

      sumSqTotal += mono * mono;
      sumSqBass += lp180b * lp180b;
      sumSqMid += midVal * midVal;
    }

    const rmsTotal = Math.sqrt(sumSqTotal / count);
    const rmsBass = Math.sqrt(sumSqBass / count);
    const rmsMid = Math.sqrt(sumSqMid / count);

    rawRms[f] = rmsTotal;
    if (rmsTotal > maxRms) maxRms = rmsTotal;

    energy[f] = Math.log1p(18 * rmsTotal);
    bass[f] = Math.log1p(26 * rmsBass);
    mid[f] = Math.log1p(22 * rmsMid);
  }

  const onset = new Float32Array(numFrames);
  const rmsNorm = new Float32Array(numFrames);
  const rmsDiv = maxRms > 1e-5 ? maxRms : 1;

  for (let f = 0; f < numFrames; f++) {
    rmsNorm[f] = Math.min(1, Math.pow(rawRms[f] / rmsDiv, 0.78));
    if (f > 0) {
      const dE = Math.max(0, energy[f] - energy[f - 1]);
      const dB = Math.max(0, bass[f] - bass[f - 1]);
      onset[f] = dE + 0.8 * dB;
    }
  }

  return {
    frameDurSec,
    durationSec,
    hasAudio: maxRms > 0.0005,
    energy,
    bass,
    mid,
    onset,
    rmsNorm,
  };
}

async function decodeBlobToMultiBandFrames(
  blobPromise: Promise<Blob | null | undefined>,
  externalUrl?: string
): Promise<MultiBandAcousticFrames> {
  const empty: MultiBandAcousticFrames = {
    frameDurSec: FRAME_DUR_SEC,
    durationSec: 0,
    hasAudio: false,
    energy: new Float32Array(0),
    bass: new Float32Array(0),
    mid: new Float32Array(0),
    onset: new Float32Array(0),
    rmsNorm: new Float32Array(0),
  };

  let arrayBuffer: ArrayBuffer | null = null;
  try {
    const blob = await blobPromise;
    if (blob && blob.size > 0) {
      arrayBuffer = await blob.arrayBuffer();
    } else if (externalUrl) {
      const resp = await fetch(externalUrl);
      if (resp.ok) {
        arrayBuffer = await resp.arrayBuffer();
      }
    }
  } catch {
    return empty;
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return empty;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return empty;

  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    arrayBuffer = null;
    return extractFramesFromAudioBuffer(audioBuffer, FRAME_DUR_SEC);
  } catch {
    return empty;
  } finally {
    arrayBuffer = null;
    audioCtx.close().catch(() => {});
  }
}

function zNormalize(arr: Float32Array): Float32Array {
  const n = arr.length;
  if (n === 0) return new Float32Array(0);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += arr[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / n);
  const out = new Float32Array(n);
  if (std < 1e-6) return out;
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(-3.5, Math.min(4.5, (arr[i] - mean) / std));
  }
  return out;
}

interface PrefixStats {
  pref1: Float64Array;
  pref2: Float64Array;
}

function buildPrefixStats(arr: Float32Array): PrefixStats {
  const n = arr.length;
  const pref1 = new Float64Array(n + 1);
  const pref2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    pref1[i + 1] = pref1[i] + v;
    pref2[i + 1] = pref2[i] + v * v;
  }
  return { pref1, pref2 };
}

function fastPearsonWindow(
  a: Float32Array,
  aStats: PrefixStats,
  aStart: number,
  b: Float32Array,
  bStats: PrefixStats,
  bStart: number,
  len: number
): number {
  if (
    len < 4 ||
    aStart < 0 ||
    bStart < 0 ||
    aStart + len > a.length ||
    bStart + len > b.length
  ) {
    return 0;
  }
  const sumA = aStats.pref1[aStart + len] - aStats.pref1[aStart];
  const sumB = bStats.pref1[bStart + len] - bStats.pref1[bStart];
  const sumSqA = aStats.pref2[aStart + len] - aStats.pref2[aStart];
  const sumSqB = bStats.pref2[bStart + len] - bStats.pref2[bStart];

  const varA = sumSqA - (sumA * sumA) / len;
  const varB = sumSqB - (sumB * sumB) / len;
  if (varA <= 1e-6 || varB <= 1e-6) return 0;

  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[aStart + i] * b[bStart + i];
  }
  const cov = dot - (sumA * sumB) / len;
  return cov / Math.sqrt(varA * varB);
}

function pearsonWindow(
  a: Float32Array,
  aStart: number,
  b: Float32Array,
  bStart: number,
  len: number
): number {
  if (
    len < 4 ||
    aStart < 0 ||
    bStart < 0 ||
    aStart + len > a.length ||
    bStart + len > b.length
  ) {
    return 0;
  }
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < len; i++) {
    meanA += a[aStart + i];
    meanB += b[bStart + i];
  }
  meanA /= len;
  meanB /= len;

  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < len; i++) {
    const da = a[aStart + i] - meanA;
    const db = b[bStart + i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 1e-6 ? num / denom : 0;
}

function multiBandPearson(
  song: MultiBandAcousticFrames,
  sStart: number,
  mv: MultiBandAcousticFrames,
  mStart: number,
  len: number,
  weights: { energy: number; bass: number; mid: number; onset: number } = LOCAL_ENGINE_PRESETS.standard.weights
): number {
  const cEnergy = pearsonWindow(song.energy, sStart, mv.energy, mStart, len);
  const cBass = pearsonWindow(song.bass, sStart, mv.bass, mStart, len);
  const cMid = weights.mid > 0 ? pearsonWindow(song.mid, sStart, mv.mid, mStart, len) : 0;
  const cOnset = pearsonWindow(song.onset, sStart, mv.onset, mStart, len);
  return (
    weights.energy * cEnergy +
    weights.bass * cBass +
    weights.mid * cMid +
    weights.onset * cOnset
  );
}

function detectQuietSegments(
  rmsNorm: Float32Array,
  frameDurSec: number,
  threshold = 0.16,
  minLengthSec = 1.5
): { startSec: number; endSec: number; avgLevel: number }[] {
  const out: { startSec: number; endSec: number; avgLevel: number }[] = [];
  let runStart = -1;
  let sum = 0;
  let count = 0;

  for (let i = 0; i <= rmsNorm.length; i++) {
    const isQuiet = i < rmsNorm.length && rmsNorm[i] <= threshold;
    if (isQuiet) {
      if (runStart === -1) {
        runStart = i;
        sum = 0;
        count = 0;
      }
      sum += rmsNorm[i];
      count++;
    } else if (runStart !== -1) {
      const startSec = Number((runStart * frameDurSec).toFixed(1));
      const endSec = Number((i * frameDurSec).toFixed(1));
      if (endSec - startSec >= minLengthSec) {
        out.push({
          startSec,
          endSec,
          avgLevel: Math.round((sum / Math.max(1, count)) * 100),
        });
      }
      runStart = -1;
    }
  }
  return out.slice(0, 14);
}

function summarizeTimeline(
  rmsNorm: Float32Array,
  durationSec: number,
  maxPoints = 100
): { tSec: number; level: number }[] {
  if (rmsNorm.length === 0 || durationSec <= 0) return [];
  const step = Math.max(1, Math.ceil(rmsNorm.length / maxPoints));
  const out: { tSec: number; level: number }[] = [];
  for (let i = 0; i < rmsNorm.length; i += step) {
    let sum = 0;
    let cnt = 0;
    for (let k = i; k < Math.min(rmsNorm.length, i + step); k++) {
      sum += rmsNorm[k];
      cnt++;
    }
    const tSec = Number((((i + cnt / 2) / rmsNorm.length) * durationSec).toFixed(1));
    out.push({
      tSec,
      level: Math.round((sum / Math.max(1, cnt)) * 100),
    });
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function scoreToConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.52) return 'high';
  if (score >= 0.32) return 'medium';
  return 'low';
}

interface WindowMatchCandidate {
  mFrame: number;
  lagFrame: number;
  score: number;
}

interface DecodedAcousticContext {
  mvFrames: MultiBandAcousticFrames;
  songFrames: MultiBandAcousticFrames;
  actualMvDur: number;
  actualSongDur: number;
  mvSilenceSegments: { startSec: number; endSec: number; avgLevel: number }[];
  mvEnergyTimeline: { tSec: number; level: number }[];
  songEnergyTimeline: { tSec: number; level: number }[];
  firstLyricSec: number | null;
}

async function decodeSharedAcousticContext(params: {
  track: TrackMetadata;
  mv: TrackMvMeta;
  mvDurationSec: number;
  songDurationSec: number;
  label: string;
  onProgress?: (msg: string) => void;
}): Promise<DecodedAcousticContext> {
  const { track, mv, mvDurationSec, songDurationSec, label, onProgress } = params;

  onProgress?.(`1/3 [${label}] 正在多频段解码整首歌曲与整部 MV 音轨...`);

  const mvFrames = await decodeBlobToMultiBandFrames(
    mv.sourceType === 'local'
      ? getMvRecordById(mv.id).then((r) => r?.videoBlob ?? null)
      : Promise.resolve(null),
    mv.sourceType === 'url' ? mv.externalUrl : undefined
  );

  await new Promise((r) => setTimeout(r, 0));

  const songFrames = await decodeBlobToMultiBandFrames(getAudioBlob(track.id));

  const actualMvDur =
    mvFrames.durationSec > 0
      ? mvFrames.durationSec
      : Math.max(1, mvDurationSec || mv.durationSec || 1);
  const actualSongDur =
    songFrames.durationSec > 0
      ? songFrames.durationSec
      : Math.max(1, songDurationSec || track.duration || 1);

  const mvSilenceSegments = detectQuietSegments(
    mvFrames.rmsNorm,
    mvFrames.frameDurSec
  );
  const mvEnergyTimeline = summarizeTimeline(mvFrames.rmsNorm, actualMvDur, 100);
  const songEnergyTimeline = summarizeTimeline(
    songFrames.rmsNorm,
    actualSongDur,
    100
  );

  const parsedLrc = track.lyricsRaw ? parseLrc(track.lyricsRaw).lines : [];
  const firstLyricSec =
    parsedLrc.length > 0 ? Number(parsedLrc[0].time.toFixed(1)) : null;

  return {
    mvFrames,
    songFrames,
    actualMvDur,
    actualSongDur,
    mvSilenceSegments,
    mvEnergyTimeline,
    songEnergyTimeline,
    firstLyricSec,
  };
}

async function analyzeContextWithPreset(
  ctx: DecodedAcousticContext,
  preset: LocalEnginePreset,
  progressPrefix: string,
  onProgress?: (msg: string) => void
): Promise<LocalFullTrackAnalysisResult> {
  const {
    mvFrames,
    songFrames,
    actualMvDur,
    actualSongDur,
    mvSilenceSegments,
    mvEnergyTimeline,
    songEnergyTimeline,
    firstLyricSec,
  } = ctx;

  const cfg = LOCAL_ENGINE_PRESETS[preset] || LOCAL_ENGINE_PRESETS.standard;
  const wts = cfg.weights;

  const fallbackDifferenceResult = (): LocalFullTrackAnalysisResult => {
    const diff = Math.max(0, actualMvDur - actualSongDur);
    const introEnd = diff >= 2 ? Number((diff * 0.5).toFixed(1)) : 0;
    const outroStart = Number(
      Math.min(actualMvDur, introEnd + actualSongDur).toFixed(1)
    );
    const outroRec = actualMvDur - outroStart >= 1.5;
    return {
      mvDurationSec: Number(actualMvDur.toFixed(2)),
      songDurationSec: Number(actualSongDur.toFixed(2)),
      mvHasAudio: mvFrames.hasAudio,
      songHasAudio: songFrames.hasAudio,
      fullTrackCoveragePct: 0,
      meanCorrelation: 0,
      peakCorrelation: 0,
      plateaus: [],
      intro: {
        recommended: introEnd >= 0.8,
        introEndSec: introEnd,
        confidence: 'low',
        reason: mvFrames.hasAudio
          ? '音轨有效特征不足，已按视频与歌曲总时长差值进行保守估算。'
          : '未能读取到 MV 音轨（可能无音轨或外链受跨域限制），已按时长差保守估算前瞻段，请播放视频画面核对。',
        evidenceTimestamps:
          introEnd > 0
            ? [Number(Math.max(0.5, introEnd - 1.5).toFixed(1)), introEnd]
            : [],
      },
      midBreaks: [],
      outro: {
        recommended: outroRec,
        outroStartSec: outroRec ? outroStart : Number(actualMvDur.toFixed(2)),
        outroEndSec: Number(actualMvDur.toFixed(2)),
        confidence: 'low',
        reason: outroRec
          ? `歌曲总时长约 ${actualSongDur.toFixed(1)}s，MV 总时长约 ${actualMvDur.toFixed(1)}s，末尾预计留有 ${(actualMvDur - outroStart).toFixed(1)}s 尾声画面。`
          : 'MV 时长与歌曲接近，暂未发现明显片尾段落。',
        evidenceTimestamps: outroRec
          ? [outroStart, Number(Math.max(0, actualMvDur - 2).toFixed(1))]
          : [],
      },
      recommendedFadeSec: 1.0,
      summary: '已完成基础时长分析；由于缺少可用双轨声音波形，请手动预览视频核对关键切点。',
      mvSilenceSegments,
      mvEnergyTimeline,
      songEnergyTimeline,
    };
  };

  if (
    !mvFrames.hasAudio ||
    !songFrames.hasAudio ||
    mvFrames.energy.length < 30 ||
    songFrames.energy.length < 30
  ) {
    return fallbackDifferenceResult();
  }

  onProgress?.(`${progressPrefix} [${cfg.name}] 正在进行全曲声纹 Hough 全局对齐与稳定乐段识别...`);
  await new Promise((r) => setTimeout(r, 0));

  const nSong = songFrames.energy.length;
  const nMv = mvFrames.energy.length;

  // Composite normalized signature for ultra-fast full-timeline coarse scanning
  const sEz = zNormalize(songFrames.energy);
  const sBz = zNormalize(songFrames.bass);
  const sMz = zNormalize(songFrames.mid);
  const sOz = zNormalize(songFrames.onset);
  const songSig = new Float32Array(nSong);
  for (let i = 0; i < nSong; i++) {
    songSig[i] =
      wts.energy * sEz[i] +
      wts.bass * sBz[i] +
      wts.mid * sMz[i] +
      wts.onset * sOz[i];
  }

  const mEz = zNormalize(mvFrames.energy);
  const mBz = zNormalize(mvFrames.bass);
  const mMz = zNormalize(mvFrames.mid);
  const mOz = zNormalize(mvFrames.onset);
  const mvSig = new Float32Array(nMv);
  for (let i = 0; i < nMv; i++) {
    mvSig[i] =
      wts.energy * mEz[i] +
      wts.bass * mBz[i] +
      wts.mid * mMz[i] +
      wts.onset * mOz[i];
  }

  const songPrefix = buildPrefixStats(songSig);
  const mvPrefix = buildPrefixStats(mvSig);

  const minTotal = Math.min(nSong, nMv);
  // Use 12.0s windows (120 frames) for high SNR against repetitive 2-beat loops
  const winLen = Math.max(25, Math.min(120, Math.floor(minTotal * 0.35)));
  const strideS = Math.max(10, Math.min(20, Math.floor((nSong - winLen) / 8) || 15));

  const maxSStart = Math.max(0, nSong - winLen);
  const maxMStart = Math.max(0, nMv - winLen);

  const probeStarts: number[] = [];
  for (let s = 0; s <= maxSStart; s += strideS) {
    probeStarts.push(s);
  }
  if (probeStarts[probeStarts.length - 1] !== maxSStart) {
    probeStarts.push(maxSStart);
  }

  const coarseStep = Math.max(
    cfg.coarseStepBase,
    nSong * nMv > 8_000_000 ? cfg.coarseStepBase + 1 : cfg.coarseStepBase
  ); // 0.2s~0.5s coarse grid depending on preset
  const minPeakSepFrames = 15; // 1.5s min distance between local peaks

  // PASS 1: Global Lag Hough Histogram across ALL full-song windows
  // Prevents early repetitive bars or quiet song openings from locking onto bogus distant timestamps.
  const houghBinSize = 5; // 0.5s lag bins
  const houghBins = new Map<number, number>();
  const windowCoarseTops: { m: number; score: number }[][] = [];

  for (let k = 0; k < probeStarts.length; k++) {
    const sStart = probeStarts[k];
    const rowScores: { m: number; score: number }[] = [];

    for (let m = 0; m <= maxMStart; m += coarseStep) {
      const sc = fastPearsonWindow(
        songSig,
        songPrefix,
        sStart,
        mvSig,
        mvPrefix,
        m,
        winLen
      );
      rowScores.push({ m, score: sc });

      if (sc >= 0.20) {
        const lagFrames = m - sStart;
        const bin = Math.round(lagFrames / houghBinSize) * houghBinSize;
        const w = (sc - 0.16) * (sc - 0.16);
        houghBins.set(bin, (houghBins.get(bin) || 0) + w);
      }
    }

    rowScores.sort((a, b) => b.score - a.score);
    const localTops: { m: number; score: number }[] = [];
    for (const item of rowScores) {
      if (localTops.every((e) => Math.abs(e.m - item.m) >= minPeakSepFrames)) {
        localTops.push(item);
        if (localTops.length >= 6) break;
      }
    }
    windowCoarseTops.push(localTops);
  }

  // Extract top 8 separated global horizontal lag lines (plus lag=0 baseline)
  const sortedHough = Array.from(houghBins.entries())
    .sort((a, b) => b[1] - a[1]);
  const globalHoughLags: number[] = [];
  for (const [lagBin] of sortedHough) {
    if (globalHoughLags.every((existing) => Math.abs(existing - lagBin) >= 15)) {
      globalHoughLags.push(lagBin);
      if (globalHoughLags.length >= 8) break;
    }
  }
  if (globalHoughLags.every((existing) => Math.abs(existing) >= 8)) {
    globalHoughLags.push(0);
  }

  // Build refined 0.1s multi-band candidate list per window (ALWAYS injecting globalHoughLags!)
  const allCandidates: WindowMatchCandidate[][] = [];
  for (let k = 0; k < probeStarts.length; k++) {
    const sStart = probeStarts[k];
    const baseMs: number[] = windowCoarseTops[k].map((x) => x.m);

    for (const hLag of globalHoughLags) {
      const mPred = sStart + hLag;
      if (mPred >= 0 && mPred <= maxMStart) {
        if (baseMs.every((existing) => Math.abs(existing - mPred) >= 6)) {
          baseMs.push(mPred);
        }
      }
    }

    // Guarantee at least one fallback candidate in valid bounds even on silent tracks
    if (baseMs.length === 0) {
      baseMs.push(Math.max(0, Math.min(maxMStart, sStart)));
    }

    const refined: WindowMatchCandidate[] = [];
    for (const baseM of baseMs) {
      let bestM = baseM;
      let bestScore = -2;
      const lo = Math.max(0, baseM - 4);
      const hi = Math.min(maxMStart, baseM + 4);
      for (let rm = lo; rm <= hi; rm++) {
        const ms = multiBandPearson(songFrames, sStart, mvFrames, rm, winLen, wts);
        if (ms > bestScore) {
          bestScore = ms;
          bestM = rm;
        }
      }
      refined.push({
        mFrame: bestM,
        lagFrame: bestM - sStart,
        score: bestScore,
      });
    }

    refined.sort((a, b) => b.score - a.score);
    allCandidates.push(refined);
  }

  // PASS 2: Strictly Monotonic Viterbi Dynamic Programming (NO backward jump resurrection!)
  const numWin = probeStarts.length;
  const dp: number[][] = allCandidates.map((cands) => cands.map(() => -1e9));
  const backPtr: number[][] = allCandidates.map((cands) => cands.map(() => -1));

  // Initial physical prior at k=0: reward lags that leave enough room for the song inside the MV!
  const houghWeightMap = new Map<number, number>();
  for (const [bin, w] of sortedHough) houghWeightMap.set(bin, w);

  for (let i = 0; i < allCandidates[0].length; i++) {
    const c = allCandidates[0][i];
    const lagSec = c.lagFrame * FRAME_DUR_SEC;
    const bin = Math.round(c.lagFrame / houghBinSize) * houghBinSize;
    const globalSupport =
      (houghWeightMap.get(bin) || 0) +
      (houghWeightMap.get(bin - houghBinSize) || 0) * 0.5 +
      (houghWeightMap.get(bin + houghBinSize) || 0) * 0.5;

    let priorPenalty = 0;
    // Penalize opening lag that leaves less than 65% of the song fitting inside MV!
    const remainingMvSec = actualMvDur - lagSec;
    if (remainingMvSec < actualSongDur * 0.65) {
      priorPenalty += 1.8;
    }
    if (lagSec < -3.0) {
      priorPenalty += 0.5;
    }

    dp[0][i] = c.score + Math.min(0.6, globalSupport * 0.08) - priorPenalty;
  }

  for (let k = 1; k < numWin; k++) {
    const stepS = Math.max(1, probeStarts[k] - probeStarts[k - 1]);
    const cands = allCandidates[k];
    const prevCands = allCandidates[k - 1];

    for (let i = 0; i < cands.length; i++) {
      const cur = cands[i];
      let bestVal = -1e9;
      let bestPrev = -1;

      for (let p = 0; p < prevCands.length; p++) {
        if (dp[k - 1][p] < -1e8) continue;
        const prev = prevCands[p];
        const dm = cur.mFrame - prev.mFrame;

        // Strictly monotonic: MV timeline cannot move backwards!
        if (dm < Math.max(2, Math.round(stepS * 0.4))) continue;

        const dLag = cur.lagFrame - prev.lagFrame;
        let transPenalty = 0;
        if (Math.abs(dLag) <= 6) {
          // Stay on same continuous plateau (±0.6s tolerance)
          transPenalty = 0.008 * Math.abs(dLag);
        } else if (dLag >= Math.round(cfg.minGapSec * 10)) {
          // Forward Mid-Break jump (pause in song while MV plays break)
          transPenalty = cfg.switchPenalty;
        } else if (dLag > 6) {
          // Ambiguous micro-gap
          transPenalty = 0.65;
        } else {
          // MV cut a middle part of the song (very rare)
          transPenalty = 1.85;
        }

        const val = dp[k - 1][p] + cur.score - transPenalty;
        if (val > bestVal) {
          bestVal = val;
          bestPrev = p;
        }
      }

      dp[k][i] = bestVal;
      backPtr[k][i] = bestPrev;
    }
  }

  // Backtrack optimal reachable monotonic full-song path
  const pathIdx = new Array<number>(numWin).fill(0);
  let lastBest = -1e9;
  let foundReachable = false;
  for (let i = 0; i < allCandidates[numWin - 1].length; i++) {
    if (dp[numWin - 1][i] > lastBest) {
      lastBest = dp[numWin - 1][i];
      pathIdx[numWin - 1] = i;
      foundReachable = true;
    }
  }

  if (foundReachable && lastBest > -1e8) {
    for (let k = numWin - 1; k >= 1; k--) {
      const prev = backPtr[k][pathIdx[k]];
      pathIdx[k - 1] = prev >= 0 ? prev : 0;
    }
  } else {
    // Fallback to best dominant global Hough lag if strict DP couldn't span full length
    const domLag = globalHoughLags[0] ?? 0;
    for (let k = 0; k < numWin; k++) {
      let bestI = 0;
      let bestDist = Infinity;
      for (let i = 0; i < allCandidates[k].length; i++) {
        const d = Math.abs(allCandidates[k][i].lagFrame - domLag);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
        }
      }
      pathIdx[k] = bestI;
    }
  }

  const path = probeStarts.map((sFrame, k) => {
    const c = allCandidates[k][pathIdx[k]];
    return {
      sFrame,
      mFrame: c.mFrame,
      lagFrame: c.lagFrame,
      score: c.score,
    };
  });

  onProgress?.(`${progressPrefix} [${cfg.name}] 正在切分前瞻、中段间奏与后段尾声并微调 0.1 秒级临界点...`);
  await new Promise((r) => setTimeout(r, 0));

  // Cluster matched windows into contiguous lag plateaus
  interface RawPlateau {
    items: typeof path;
    medianLagFrame: number;
  }

  const matchedItems = path.filter((p) => p.score >= 0.22);
  const workingItems = matchedItems.length >= 3 ? matchedItems : path;

  const rawPlateaus: RawPlateau[] = [];
  for (const pt of workingItems) {
    const current = rawPlateaus[rawPlateaus.length - 1];
    if (!current) {
      rawPlateaus.push({ items: [pt], medianLagFrame: pt.lagFrame });
      continue;
    }
    if (Math.abs(pt.lagFrame - current.medianLagFrame) <= 12) {
      current.items.push(pt);
      current.medianLagFrame = median(current.items.map((x) => x.lagFrame));
    } else {
      rawPlateaus.push({ items: [pt], medianLagFrame: pt.lagFrame });
    }
  }

  // Require real sustained support for any plateau (>= 3 windows / >= 6s when track is long)
  const minPlateauWindows = numWin >= 12 ? 3 : Math.min(2, numWin);
  const stableRaw: RawPlateau[] = [];
  for (const rp of rawPlateaus) {
    const avgScore =
      rp.items.reduce((acc, x) => acc + x.score, 0) / rp.items.length;
    if (
      rp.items.length < minPlateauWindows &&
      rawPlateaus.length > 1 &&
      !(rp.items.length >= 2 && avgScore >= 0.6)
    ) {
      continue;
    }
    const prev = stableRaw[stableRaw.length - 1];
    if (prev && Math.abs(rp.medianLagFrame - prev.medianLagFrame) < 18) {
      prev.items.push(...rp.items);
      prev.medianLagFrame = median(prev.items.map((x) => x.lagFrame));
    } else {
      stableRaw.push({
        items: [...rp.items],
        medianLagFrame: rp.medianLagFrame,
      });
    }
  }

  if (stableRaw.length === 0) {
    stableRaw.push({
      items: workingItems,
      medianLagFrame: median(workingItems.map((x) => x.lagFrame)),
    });
  }

  // Fine-tune exact 0.1s lag for each plateau across ±2.5s using ALL frames inside that plateau
  let plateaus: LocalLagPlateau[] = stableRaw.map((rp, idx) => {
    const baseLag = Math.round(rp.medianLagFrame);
    const sFirst = rp.items[0].sFrame;
    const sLast = Math.min(nSong, rp.items[rp.items.length - 1].sFrame + winLen);

    let bestLag = baseLag;
    let bestCorr = -2;
    const segLen = Math.max(20, sLast - sFirst);

    for (let testLag = baseLag - 25; testLag <= baseLag + 25; testLag++) {
      const validSStart = Math.max(sFirst, -testLag);
      const validSEnd = Math.min(sFirst + segLen, nSong, nMv - testLag);
      const overlapLen = validSEnd - validSStart;
      if (overlapLen < 20) continue;

      const corr = multiBandPearson(
        songFrames,
        validSStart,
        mvFrames,
        validSStart + testLag,
        overlapLen,
        wts
      );
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = testLag;
      }
    }

    const lagSec = Number((bestLag * FRAME_DUR_SEC).toFixed(2));
    const songStartSec = Number((sFirst * FRAME_DUR_SEC).toFixed(1));
    const songEndSec = Number((sLast * FRAME_DUR_SEC).toFixed(1));
    const mvStartSec = Number(
      Math.max(0, Math.min(actualMvDur, songStartSec + lagSec)).toFixed(2)
    );
    const mvEndSec = Number(
      Math.max(0, Math.min(actualMvDur, songEndSec + lagSec)).toFixed(2)
    );

    const fallbackMean =
      rp.items.reduce((a, b) => a + b.score, 0) / rp.items.length;

    return {
      index: idx,
      songStartSec,
      songEndSec,
      mvStartSec,
      mvEndSec,
      lagSec,
      meanCorrelation: Number(
        (bestCorr > -1.5 ? bestCorr : fallbackMean).toFixed(3)
      ),
    };
  });

  // Physical Sanity Guard for Intro Plateau:
  // If P0 suggests an implausibly huge intro that leaves < 55% of the song fitting inside the MV
  // while a later valid plateau (or dominant Hough lag) leaves most of the song fitting, prune false P0!
  while (
    plateaus.length > 1 &&
    actualMvDur - plateaus[0].lagSec < actualSongDur * 0.55 &&
    actualMvDur - plateaus[1].lagSec >= actualSongDur * 0.55
  ) {
    plateaus = plateaus.slice(1).map((p, idx) => ({ ...p, index: idx }));
  }

  // Even for a single plateau: if introEndSec > mvDur - 0.5*songDur AND song actually fits earlier
  // via another strong Hough lag peak (>= 0.30 correlation across main song), re-anchor cleanly!
  if (
    plateaus.length === 1 &&
    actualMvDur - plateaus[0].lagSec < actualSongDur * 0.55
  ) {
    const feasibleLags = globalHoughLags.filter((lagF) => {
      const lSec = lagF * FRAME_DUR_SEC;
      return lSec >= -3 && actualMvDur - lSec >= actualSongDur * 0.65;
    });
    if (feasibleLags.length > 0) {
      let bestAltLagF = feasibleLags[0];
      let bestAltCorr = -2;
      for (const candLagF of feasibleLags) {
        const sStart = Math.max(0, -candLagF);
        const sEnd = Math.min(nSong, nMv - candLagF);
        if (sEnd - sStart < 40) continue;
        const c = multiBandPearson(
          songFrames,
          sStart,
          mvFrames,
          sStart + candLagF,
          sEnd - sStart,
          wts
        );
        if (c > bestAltCorr) {
          bestAltCorr = c;
          bestAltLagF = candLagF;
        }
      }
      if (bestAltCorr >= 0.22) {
        const lSec = Number((bestAltLagF * FRAME_DUR_SEC).toFixed(2));
        plateaus = [
          {
            index: 0,
            songStartSec: 0,
            songEndSec: Number(actualSongDur.toFixed(1)),
            mvStartSec: Number(Math.max(0, lSec).toFixed(2)),
            mvEndSec: Number(Math.min(actualMvDur, actualSongDur + lSec).toFixed(2)),
            lagSec: lSec,
            meanCorrelation: Number(bestAltCorr.toFixed(3)),
          },
        ];
      }
    }
  }

  // Coverage & aggregate correlation stats
  const totalMatchedWindows = path.filter((p) => p.score >= 0.28).length;
  const fullTrackCoveragePct = Math.round(
    (totalMatchedWindows / Math.max(1, path.length)) * 100
  );
  const meanCorrelation = Number(
    (
      path.reduce((acc, p) => acc + Math.max(0, p.score), 0) /
      Math.max(1, path.length)
    ).toFixed(3)
  );
  const peakCorrelation = Number(
    Math.max(0, ...path.map((p) => p.score)).toFixed(3)
  );

  // 1. INTRO boundary analysis
  const firstPlateau = plateaus[0];
  let introEndSec = Number(
    Math.max(0, Math.min(actualMvDur, firstPlateau.lagSec)).toFixed(2)
  );
  // Final physical sanity check: if intro STILL exceeds remaining room and MV ~= song, clamp conservatively
  if (
    introEndSec > Math.max(45, actualMvDur * 0.45) &&
    actualMvDur - introEndSec < actualSongDur * 0.55
  ) {
    introEndSec = Number(
      Math.max(0, actualMvDur - actualSongDur).toFixed(2)
    );
  }
  const introRecommended = introEndSec >= 0.7;

  // Fine onset refinement around introEndSec when song starts with quiet lead-in
  if (introRecommended) {
    let songActiveFrame = 0;
    while (
      songActiveFrame < Math.min(nSong, 50) &&
      songFrames.rmsNorm[songActiveFrame] < 0.08
    ) {
      songActiveFrame++;
    }
    const expectedActiveMvFrame = Math.round(
      introEndSec / FRAME_DUR_SEC + songActiveFrame
    );
    const mvPreRegionAvg =
      expectedActiveMvFrame > 12
        ? mvFrames.rmsNorm
            .slice(Math.max(0, expectedActiveMvFrame - 12), expectedActiveMvFrame - 2)
            .reduce((a, b) => a + b, 0) / 10
        : 1;
    if (mvPreRegionAvg < 0.14) {
      let bestOnsetFrame = expectedActiveMvFrame;
      let bestOnsetVal = -1;
      for (
        let f = Math.max(1, expectedActiveMvFrame - 5);
        f <= Math.min(nMv - 1, expectedActiveMvFrame + 5);
        f++
      ) {
        if (mvFrames.onset[f] > bestOnsetVal) {
          bestOnsetVal = mvFrames.onset[f];
          bestOnsetFrame = f;
        }
      }
      const refinedIntro = Number(
        Math.max(0, (bestOnsetFrame - songActiveFrame) * FRAME_DUR_SEC).toFixed(2)
      );
      if (Math.abs(refinedIntro - introEndSec) <= 0.5) {
        introEndSec = refinedIntro;
      }
    }
  } else {
    introEndSec = 0;
  }

  const introConf = scoreToConfidence(firstPlateau.meanCorrelation);
  const introReason = introRecommended
    ? `主乐段声纹对齐（${firstPlateau.songStartSec.toFixed(1)}s~${firstPlateau.songEndSec.toFixed(1)}s 相关性 ${(firstPlateau.meanCorrelation * 100).toFixed(0)}%）表明歌曲 0:00 始于 MV 第 ${introEndSec.toFixed(1)}s${
        firstLyricSec !== null
          ? `（首句歌词在歌曲 ${firstLyricSec.toFixed(1)}s）`
          : ''
      }，前 ${introEndSec.toFixed(1)}s 为前瞻剧情段。`
    : `歌曲 0:00 声纹直接对齐 MV 开场（偏差仅 ${firstPlateau.lagSec.toFixed(1)}s，相关性 ${(firstPlateau.meanCorrelation * 100).toFixed(0)}%），无需设置独立前瞻段。`;

  const introEvidence = introRecommended
    ? Array.from(
        new Set(
          [
            Math.min(1.5, Math.max(0.2, introEndSec * 0.25)),
            Math.max(0.5, introEndSec - 2.0),
            introEndSec,
            Math.min(actualMvDur - 0.5, introEndSec + 2.5),
          ].map((v) => Number(Math.max(0, Math.min(actualMvDur, v)).toFixed(1)))
        )
      )
    : [0.5, 2.5];

  // 2. MID-BREAKS detection across plateau forward lag jumps
  const midBreaks: LocalMidBreakDetection[] = [];
  for (let i = 0; i < plateaus.length - 1; i++) {
    const pLeft = plateaus[i];
    const pRight = plateaus[i + 1];
    const gapSec = pRight.lagSec - pLeft.lagSec;
    if (gapSec < cfg.minGapSec) continue;

    const lagLeftFrames = Math.round(pLeft.lagSec / FRAME_DUR_SEC);
    const lagRightFrames = Math.round(pRight.lagSec / FRAME_DUR_SEC);

    const rawSearchA = Math.round((pLeft.songEndSec - 10) / FRAME_DUR_SEC);
    const rawSearchB = Math.round((pRight.songStartSec + 10) / FRAME_DUR_SEC);
    const searchStartS = Math.max(
      40,
      Math.min(rawSearchA, rawSearchB)
    );
    const searchEndS = Math.min(
      nSong - 40,
      Math.max(rawSearchA, rawSearchB)
    );

    let bestSplitS = Math.round(
      ((pLeft.songEndSec + pRight.songStartSec) / 2) / FRAME_DUR_SEC
    );
    let bestSplitMetric = -1e9;
    const probeHalfWin = 35; // 3.5s on each side of split

    for (let s = searchStartS; s <= searchEndS; s++) {
      const mLeftStart = s - probeHalfWin + lagLeftFrames;
      const mRightStart = s + lagRightFrames;
      if (
        s - probeHalfWin < 0 ||
        s + probeHalfWin > nSong ||
        mLeftStart < 0 ||
        mRightStart + probeHalfWin > nMv
      ) {
        continue;
      }

      const preCorr = multiBandPearson(
        songFrames,
        s - probeHalfWin,
        mvFrames,
        mLeftStart,
        probeHalfWin,
        wts
      );
      const postCorr = multiBandPearson(
        songFrames,
        s,
        mvFrames,
        mRightStart,
        probeHalfWin,
        wts
      );

      const brkMvStart = Math.max(0, s + lagLeftFrames + 3);
      const brkMvEnd = Math.min(nMv, s + lagRightFrames - 3);
      let brkAvgRms = 0.5;
      if (brkMvEnd > brkMvStart) {
        let sum = 0;
        for (let f = brkMvStart; f < brkMvEnd; f++) sum += mvFrames.rmsNorm[f];
        brkAvgRms = sum / (brkMvEnd - brkMvStart);
      }
      const quietBonus = Math.max(0, 0.35 - brkAvgRms) * cfg.quietBonusWeight;

      const totalMetric = preCorr + postCorr + quietBonus;
      if (totalMetric > bestSplitMetric) {
        bestSplitMetric = totalMetric;
        bestSplitS = s;
      }
    }

    const audioTriggerSec = Number((bestSplitS * FRAME_DUR_SEC).toFixed(2));
    const mvStartSec = Number(
      Math.max(0, Math.min(actualMvDur, audioTriggerSec + pLeft.lagSec)).toFixed(2)
    );
    const mvEndSec = Number(
      Math.max(mvStartSec, Math.min(actualMvDur, audioTriggerSec + pRight.lagSec)).toFixed(2)
    );

    if (mvEndSec - mvStartSec < 1.8) continue;

    const minPlateauCorr = Math.min(pLeft.meanCorrelation, pRight.meanCorrelation);
    const conf = scoreToConfidence(minPlateauCorr);
    const idxNum = midBreaks.length + 1;

    midBreaks.push({
      id: `ai-mid-${idxNum}-${Math.round(audioTriggerSec * 10)}`,
      label: `中段剧情 ${idxNum}`,
      audioTriggerSec,
      mvStartSec,
      mvEndSec,
      confidence: conf,
      preCorrelation: pLeft.meanCorrelation,
      postCorrelation: pRight.meanCorrelation,
      reason: `全曲对齐轨迹在歌曲 ${audioTriggerSec.toFixed(1)}s 处检测到时间跃迁：前置乐段偏移 +${pLeft.lagSec.toFixed(1)}s，后续乐段跃增至 +${pRight.lagSec.toFixed(1)}s，MV 在 ${mvStartSec.toFixed(1)}s → ${mvEndSec.toFixed(1)}s 插入了约 ${(mvEndSec - mvStartSec).toFixed(1)}s 独立剧情/停顿。`,
      evidenceTimestamps: Array.from(
        new Set(
          [
            Math.max(0, mvStartSec - 2),
            mvStartSec,
            (mvStartSec + mvEndSec) / 2,
            mvEndSec,
            Math.min(actualMvDur, mvEndSec + 2),
          ].map((v) => Number(v.toFixed(1)))
        )
      ),
    });
  }

  // 3. OUTRO boundary analysis
  const lastPlateau = plateaus[plateaus.length - 1];
  const predictedOutroStart = Number(
    Math.max(0, Math.min(actualMvDur, actualSongDur + lastPlateau.lagSec)).toFixed(2)
  );
  const remainingOutroSec = actualMvDur - predictedOutroStart;
  const outroRecommended = remainingOutroSec >= 1.5;

  let suggestedOutroEnd = Number(actualMvDur.toFixed(2));
  if (outroRecommended) {
    let lastSoundFrame = nMv - 1;
    while (
      lastSoundFrame > Math.round(predictedOutroStart / FRAME_DUR_SEC) &&
      mvFrames.rmsNorm[lastSoundFrame] < 0.02
    ) {
      lastSoundFrame--;
    }
    const deadTailSec = (nMv - 1 - lastSoundFrame) * FRAME_DUR_SEC;
    if (deadTailSec > 3.5) {
      suggestedOutroEnd = Number(
        Math.min(actualMvDur, (lastSoundFrame + 10) * FRAME_DUR_SEC).toFixed(2)
      );
    }
  }

  const outroConf = scoreToConfidence(lastPlateau.meanCorrelation);
  const outroReason = outroRecommended
    ? `歌曲结尾（${actualSongDur.toFixed(1)}s）按末段稳定偏移 ${lastPlateau.lagSec >= 0 ? '+' : ''}${lastPlateau.lagSec.toFixed(1)}s 映射至 MV 第 ${predictedOutroStart.toFixed(1)}s，之后仍有 ${(suggestedOutroEnd - predictedOutroStart).toFixed(1)}s 剧情/字幕尾声。`
    : `末段音画对齐后 MV 剩余不足 1.5s（预测终点 ${predictedOutroStart.toFixed(1)}s / 视频全长 ${actualMvDur.toFixed(1)}s），无需独立后段。`;

  const outroEvidence = outroRecommended
    ? Array.from(
        new Set(
          [
            Math.max(0, predictedOutroStart - 2.0),
            predictedOutroStart,
            Math.min(actualMvDur, (predictedOutroStart + suggestedOutroEnd) / 2),
            Math.max(0, suggestedOutroEnd - 1.5),
          ].map((v) => Number(v.toFixed(1)))
        )
      )
    : [Number(Math.max(0, actualMvDur - 2.5).toFixed(1))];

  const recommendedFadeSec =
    introRecommended && introEndSec < 3.0 ? 0.6 : 1.0;

  const summaryParts: string[] = [];
  summaryParts.push(
    `本地全曲对比完成（覆盖率 ${fullTrackCoveragePct}% · 平均声纹相关性 ${(meanCorrelation * 100).toFixed(0)}%）`
  );
  summaryParts.push(
    introRecommended
      ? `前瞻 0:00→${introEndSec.toFixed(1)}s`
      : '无前瞻'
  );
  summaryParts.push(
    midBreaks.length > 0
      ? `发现 ${midBreaks.length} 处中段剧情`
      : '无中段插曲'
  );
  summaryParts.push(
    outroRecommended
      ? `后段 ${predictedOutroStart.toFixed(1)}s→${suggestedOutroEnd.toFixed(1)}s`
      : '无后段'
  );

  return {
    mvDurationSec: Number(actualMvDur.toFixed(2)),
    songDurationSec: Number(actualSongDur.toFixed(2)),
    mvHasAudio: mvFrames.hasAudio,
    songHasAudio: songFrames.hasAudio,
    fullTrackCoveragePct,
    meanCorrelation,
    peakCorrelation,
    plateaus,
    intro: {
      recommended: introRecommended,
      introEndSec,
      confidence: introConf,
      reason: introReason,
      evidenceTimestamps: introEvidence,
    },
    midBreaks,
    outro: {
      recommended: outroRecommended,
      outroStartSec: outroRecommended
        ? predictedOutroStart
        : Number(actualMvDur.toFixed(2)),
      outroEndSec: suggestedOutroEnd,
      confidence: outroConf,
      reason: outroReason,
      evidenceTimestamps: outroEvidence,
    },
    recommendedFadeSec,
    summary: summaryParts.join(' · '),
    mvSilenceSegments,
    mvEnergyTimeline,
    songEnergyTimeline,
  };
}

export async function runLocalFullTrackAnalysis(params: {
  track: TrackMetadata;
  mv: TrackMvMeta;
  mvDurationSec: number;
  songDurationSec: number;
  preset?: LocalEnginePreset;
  onProgress?: (msg: string) => void;
}): Promise<LocalFullTrackAnalysisResult> {
  const preset = params.preset || 'standard';
  const cfg = LOCAL_ENGINE_PRESETS[preset] || LOCAL_ENGINE_PRESETS.standard;
  const ctx = await decodeSharedAcousticContext({
    ...params,
    label: cfg.name,
  });
  return analyzeContextWithPreset(ctx, preset, '2/3', params.onProgress);
}

function isIntroMatched(
  a: LocalFullTrackAnalysisResult,
  b: LocalFullTrackAnalysisResult
): boolean {
  if (!a.intro.recommended && !b.intro.recommended) return true;
  if (a.intro.recommended !== b.intro.recommended) return false;
  return Math.abs(a.intro.introEndSec - b.intro.introEndSec) <= 1.2;
}

function isMidMatched(
  a: LocalFullTrackAnalysisResult,
  b: LocalFullTrackAnalysisResult
): boolean {
  if (a.midBreaks.length !== b.midBreaks.length) return false;
  for (let i = 0; i < a.midBreaks.length; i++) {
    const ba = a.midBreaks[i];
    const bb = b.midBreaks[i];
    if (
      Math.abs(ba.audioTriggerSec - bb.audioTriggerSec) > 2.0 ||
      Math.abs(ba.mvStartSec - bb.mvStartSec) > 2.0 ||
      Math.abs(ba.mvEndSec - bb.mvEndSec) > 2.0
    ) {
      return false;
    }
  }
  return true;
}

function isOutroMatched(
  a: LocalFullTrackAnalysisResult,
  b: LocalFullTrackAnalysisResult
): boolean {
  if (!a.outro.recommended && !b.outro.recommended) return true;
  if (a.outro.recommended !== b.outro.recommended) return false;
  return (
    Math.abs(a.outro.outroStartSec - b.outro.outroStartSec) <= 1.5 &&
    Math.abs(a.outro.outroEndSec - b.outro.outroEndSec) <= 2.0
  );
}

export async function runLocalAllPresetsConsensus(params: {
  track: TrackMetadata;
  mv: TrackMvMeta;
  mvDurationSec: number;
  songDurationSec: number;
  onProgress?: (msg: string) => void;
}): Promise<LocalEnsembleAnalysisResult> {
  const { onProgress } = params;
  const ctx = await decodeSharedAcousticContext({
    ...params,
    label: '4 模型全量联合投票',
  });

  const rawRuns: {
    preset: LocalEnginePreset;
    name: string;
    modelCode: string;
    result: LocalFullTrackAnalysisResult;
  }[] = [];

  for (let i = 0; i < BASE_LOCAL_PRESETS.length; i++) {
    const p = BASE_LOCAL_PRESETS[i];
    const cfg = LOCAL_ENGINE_PRESETS[p];
    const res = await analyzeContextWithPreset(
      ctx,
      p,
      `模型 ${i + 1}/4`,
      onProgress
    );
    rawRuns.push({
      preset: p,
      name: cfg.name,
      modelCode: cfg.modelCode,
      result: res,
    });
  }

  onProgress?.('正在统计 4 款模型在前瞻、中期、后期的共识一致数量并选出最佳组...');

  const scored = rawRuns.map((cur) => {
    let introAgreeCount = 0;
    let midAgreeCount = 0;
    let outroAgreeCount = 0;
    let exactAllMatchCount = 0;

    for (const other of rawRuns) {
      const iOk = isIntroMatched(cur.result, other.result);
      const mOk = isMidMatched(cur.result, other.result);
      const oOk = isOutroMatched(cur.result, other.result);
      if (iOk) introAgreeCount++;
      if (mOk) midAgreeCount++;
      if (oOk) outroAgreeCount++;
      if (iOk && mOk && oOk) exactAllMatchCount++;
    }

    return {
      ...cur,
      introAgreeCount,
      midAgreeCount,
      outroAgreeCount,
      exactAllMatchCount,
      totalAgreePoints: introAgreeCount + midAgreeCount + outroAgreeCount,
    };
  });

  // Rank candidates by:
  // 1) Most models matching simultaneously across ALL 3 (前瞻 + 中期 + 后期)
  // 2) Highest total agreeing section votes (前瞻认同数 + 中期认同数 + 后期认同数)
  // 3) Highest full-track mean acoustic correlation
  const ranked = [...scored].sort((a, b) => {
    if (b.exactAllMatchCount !== a.exactAllMatchCount) {
      return b.exactAllMatchCount - a.exactAllMatchCount;
    }
    if (b.totalAgreePoints !== a.totalAgreePoints) {
      return b.totalAgreePoints - a.totalAgreePoints;
    }
    return b.result.meanCorrelation - a.result.meanCorrelation;
  });

  const winner = ranked[0];
  const winningGroupPeers = scored.filter(
    (c) =>
      isIntroMatched(c.result, winner.result) &&
      isMidMatched(c.result, winner.result) &&
      isOutroMatched(c.result, winner.result)
  );

  // Refine winning numbers to the median across all peers in the winning identical group
  const refinedResult: LocalFullTrackAnalysisResult = {
    ...winner.result,
    intro: {
      ...winner.result.intro,
      introEndSec: winner.result.intro.recommended
        ? Number(
            median(
              winningGroupPeers.map((p) => p.result.intro.introEndSec)
            ).toFixed(2)
          )
        : 0,
    },
    outro: {
      ...winner.result.outro,
      outroStartSec: Number(
        median(
          winningGroupPeers.map((p) => p.result.outro.outroStartSec)
        ).toFixed(2)
      ),
      outroEndSec: Number(
        median(
          winningGroupPeers.map((p) => p.result.outro.outroEndSec)
        ).toFixed(2)
      ),
    },
    midBreaks: winner.result.midBreaks.map((brk, idx) => ({
      ...brk,
      audioTriggerSec: Number(
        median(
          winningGroupPeers.map(
            (p) => p.result.midBreaks[idx]?.audioTriggerSec ?? brk.audioTriggerSec
          )
        ).toFixed(2)
      ),
      mvStartSec: Number(
        median(
          winningGroupPeers.map(
            (p) => p.result.midBreaks[idx]?.mvStartSec ?? brk.mvStartSec
          )
        ).toFixed(2)
      ),
      mvEndSec: Number(
        median(
          winningGroupPeers.map(
            (p) => p.result.midBreaks[idx]?.mvEndSec ?? brk.mvEndSec
          )
        ).toFixed(2)
      ),
    })),
  };

  const peerNames = winningGroupPeers.map((p) => p.name.replace(/^本地/, ''));
  const consensusSummary = `4 模型联合投票完毕：以「${winner.name}」为核心的 ${winningGroupPeers.length}/4 个模型（${peerNames.join('、')}）在前瞻、中期、后期完全一致（各段分别获 ${winner.introAgreeCount}/4、${winner.midAgreeCount}/4、${winner.outroAgreeCount}/4 票相同认可），已按组内中位数输出最稳妥参数。`;

  refinedResult.summary = `${consensusSummary} ${
    refinedResult.intro.recommended
      ? `前瞻 0:00→${refinedResult.intro.introEndSec.toFixed(1)}s`
      : '无前瞻'
  } · ${
    refinedResult.midBreaks.length > 0
      ? `${refinedResult.midBreaks.length} 处中段插曲`
      : '无中段插曲'
  } · ${
    refinedResult.outro.recommended
      ? `后段 ${refinedResult.outro.outroStartSec.toFixed(1)}s→${refinedResult.outro.outroEndSec.toFixed(1)}s`
      : '无后段'
  }`;

  const candidates: LocalEnsembleCandidate[] = scored.map((c) => {
    const inGroup =
      isIntroMatched(c.result, winner.result) &&
      isMidMatched(c.result, winner.result) &&
      isOutroMatched(c.result, winner.result);
    return {
      ...c,
      isWinner: c.preset === winner.preset,
      inWinningGroup: inGroup,
    };
  });

  return {
    winningResult: refinedResult,
    winningPreset: winner.preset,
    winningPresetName: winner.name,
    candidates,
    introConsensusCount: winner.introAgreeCount,
    midConsensusCount: winner.midAgreeCount,
    outroConsensusCount: winner.outroAgreeCount,
    exactGroupCount: winningGroupPeers.length,
    consensusSummary,
  };
}

