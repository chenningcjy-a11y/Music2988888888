import { getAudioBlob, getMvRecordById } from '../services/storage';

export interface MvWaveformResult {
  peaks: number[];
  durationSec: number;
  hasAudio: boolean;
  error?: string;
}

const waveformCache = new Map<string, MvWaveformResult>();

async function decodeBufferToWaveform(
  arrayBuffer: ArrayBuffer,
  buckets: number,
  noAudioMessage: string,
  decodeErrorMessage: string
): Promise<MvWaveformResult> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: '当前浏览器不支持 Web Audio 解码',
    };
  }

  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const channelCount = audioBuffer.numberOfChannels;
    if (channelCount === 0 || audioBuffer.length === 0) {
      return {
        peaks: new Array(buckets).fill(0),
        durationSec: audioBuffer.duration || 0,
        hasAudio: false,
        error: noAudioMessage,
      };
    }

    const totalSamples = audioBuffer.length;
    const blockSize = Math.max(1, Math.floor(totalSamples / buckets));
    const sampleStep = Math.max(1, Math.floor(blockSize / 160));
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    const rawPeaks = new Array<number>(buckets).fill(0);
    let maxAmplitude = 0;

    for (let b = 0; b < buckets; b++) {
      const start = b * blockSize;
      const end =
        b === buckets - 1 ? totalSamples : Math.min(totalSamples, start + blockSize);
      let sumSq = 0;
      let peak = 0;
      let count = 0;

      for (let i = start; i < end; i += sampleStep) {
        let mono = 0;
        for (let c = 0; c < channelCount; c++) {
          mono += Math.abs(channels[c][i] || 0);
        }
        mono /= channelCount;
        if (mono > peak) peak = mono;
        sumSq += mono * mono;
        count++;
      }

      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const blended = rms * 0.65 + peak * 0.35;
      rawPeaks[b] = blended;
      if (blended > maxAmplitude) maxAmplitude = blended;
    }

    const norm = maxAmplitude > 0.0001 ? maxAmplitude : 1;
    const peaks = rawPeaks.map((v) =>
      Math.max(0, Math.min(1, Math.pow(v / norm, 0.78)))
    );

    return {
      peaks,
      durationSec: audioBuffer.duration || 0,
      hasAudio: maxAmplitude > 0.0005,
    };
  } catch {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: decodeErrorMessage,
    };
  } finally {
    audioCtx.close().catch(() => {});
  }
}

/**
 * Extracts a normalized amplitude envelope (0..1 per bucket) from a video Blob or fetchable URL
 * so users can visually see quiet intros, dialogue, and loud music drops on the MV calibrator.
 */
export async function extractMvAudioWaveform(options: {
  mvId: string;
  sourceType: 'local' | 'url';
  externalUrl?: string;
  buckets?: number;
}): Promise<MvWaveformResult> {
  const { mvId, sourceType, externalUrl, buckets = 260 } = options;
  const cacheKey = `${mvId}:${buckets}`;
  const cached = waveformCache.get(cacheKey);
  if (cached) return cached;

  let arrayBuffer: ArrayBuffer | null = null;

  try {
    if (sourceType === 'local') {
      const rec = await getMvRecordById(mvId);
      if (!rec?.videoBlob) {
        return {
          peaks: [],
          durationSec: 0,
          hasAudio: false,
          error: '未找到本地 MV 视频数据',
        };
      }
      arrayBuffer = await rec.videoBlob.arrayBuffer();
    } else if (externalUrl) {
      const resp = await fetch(externalUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      arrayBuffer = await resp.arrayBuffer();
    }
  } catch {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: '外部视频链接受浏览器跨域限制，暂无法提取音频图谱',
    };
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: '视频文件为空',
    };
  }

  const result = await decodeBufferToWaveform(
    arrayBuffer,
    buckets,
    '该 MV 视频不包含音轨',
    '该视频无音轨或编码格式不支持离线图谱解码'
  );
  arrayBuffer = null;
  if (!result.error || result.peaks.length > 0) {
    waveformCache.set(cacheKey, result);
  }
  return result;
}

/**
 * Extracts a normalized amplitude envelope (0..1 per bucket) from the current song's audio Blob
 * stored in IndexedDB so users can visually read the music score/waveform and align MV cues.
 */
export async function extractTrackAudioWaveform(options: {
  trackId: string;
  buckets?: number;
}): Promise<MvWaveformResult> {
  const { trackId, buckets = 260 } = options;
  const cacheKey = `track:${trackId}:${buckets}`;
  const cached = waveformCache.get(cacheKey);
  if (cached) return cached;

  let arrayBuffer: ArrayBuffer | null = null;
  try {
    const blob = await getAudioBlob(trackId);
    if (!blob) {
      return {
        peaks: [],
        durationSec: 0,
        hasAudio: false,
        error: '未找到本地歌曲音频数据',
      };
    }
    arrayBuffer = await blob.arrayBuffer();
  } catch {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: '读取歌曲音频文件失败',
    };
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return {
      peaks: [],
      durationSec: 0,
      hasAudio: false,
      error: '歌曲音频文件为空',
    };
  }

  const result = await decodeBufferToWaveform(
    arrayBuffer,
    buckets,
    '该歌曲文件无有效音轨',
    '当前音频格式暂不支持离线读谱解码'
  );
  arrayBuffer = null;
  if (!result.error || result.peaks.length > 0) {
    waveformCache.set(cacheKey, result);
  }
  return result;
}

