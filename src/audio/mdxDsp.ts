/**
 * MDX-Net STFT / iSTFT & WAV encoding utilities for Kim_Vocal_2.onnx.
 * Shared cleanly by both the browser (onnxruntime-web) and Node.js server (onnxruntime-node).
 */

export const MDX_MODEL_CONFIG = {
  id: 'Kim_Vocal_2',
  name: 'UVR MDX-Net Kim Vocal 2',
  filename: 'Kim_Vocal_2.onnx',
  sha256: 'ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b',
  sampleRate: 44100,
  nFft: 7680,
  hopLength: 1024,
  dimF: 3072,
  framesPerChunk: 256,
  compensate: 1.009,
  chunkSamples: 1024 * (256 - 1), // 261,120 samples (~5.921s)
  trimSamples: 7680 / 2, // 3,840 samples
} as const;

const N_FFT = MDX_MODEL_CONFIG.nFft; // 7680 = 15 * 512
const N1 = 15;
const N2 = 512;
const LOG2_N2 = 9;
const HALF_BINS = N_FFT / 2 + 1; // 3841

// Precomputed tables initialized lazily once
let tablesReady = false;
let hannWindow: Float64Array;
let bitRev512: Uint16Array;
let tw512Cos: Float64Array;
let tw512Sin: Float64Array;
let twCrossCos: Float64Array; // [n1 * N2 + n2] = cos(-2pi * n1 * n2 / 7680)
let twCrossSin: Float64Array;
let dft15Cos: Float64Array; // [k1 * 15 + n1]
let dft15Sin: Float64Array;

function ensureTables(): void {
  if (tablesReady) return;

  // Periodic Hann window matching torch.hann_window(N_FFT, periodic=True)
  hannWindow = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT));
  }

  // Bit-reversal permutation for 512-point radix-2 FFT
  bitRev512 = new Uint16Array(N2);
  for (let i = 0; i < N2; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < LOG2_N2; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    bitRev512[i] = r;
  }

  // Twiddle factors for radix-2 stages of 512-point FFT
  tw512Cos = new Float64Array(N2 / 2);
  tw512Sin = new Float64Array(N2 / 2);
  for (let i = 0; i < N2 / 2; i++) {
    const angle = (-2 * Math.PI * i) / N2;
    tw512Cos[i] = Math.cos(angle);
    tw512Sin[i] = Math.sin(angle);
  }

  // Cross-twiddle table for 15 x 512 Cooley-Tukey decomposition
  twCrossCos = new Float64Array(N1 * N2);
  twCrossSin = new Float64Array(N1 * N2);
  for (let k1 = 0; k1 < N1; k1++) {
    for (let n2 = 0; n2 < N2; n2++) {
      const angle = (-2 * Math.PI * k1 * n2) / N_FFT;
      const idx = k1 * N2 + n2;
      twCrossCos[idx] = Math.cos(angle);
      twCrossSin[idx] = Math.sin(angle);
    }
  }

  // 15-point DFT table
  dft15Cos = new Float64Array(N1 * N1);
  dft15Sin = new Float64Array(N1 * N1);
  for (let k = 0; k < N1; k++) {
    for (let n = 0; n < N1; n++) {
      const angle = (-2 * Math.PI * k * n) / N1;
      const idx = k * N1 + n;
      dft15Cos[idx] = Math.cos(angle);
      dft15Sin[idx] = Math.sin(angle);
    }
  }

  tablesReady = true;
}

/**
 * Exact 7680-point Complex FFT via 15 x 512 Cooley-Tukey decomposition.
 * Note: output indexing follows Cooley-Tukey mapping:
 *   X[k1 + 15 * k2] -> index k = k1 + 15 * k2 (or standard k = k1 * 512 + k2).
 * Using n = n1 * 512 + n2, k = k1 + 15 * k2:
 *   Step 1: 512-point FFT along n2 for each n1 (15 rows)
 *   Step 2: Multiply by W_7680^(n1 * k2)
 *   Step 3: 15-point DFT along n1 for each k2 (512 columns) -> gives X[k1 * 512 + k2]
 */
function fft7680(
  inRe: Float64Array,
  inIm: Float64Array,
  outRe: Float64Array,
  outIm: Float64Array,
  scratchRe: Float64Array,
  scratchIm: Float64Array
): void {
  ensureTables();

  // Step 1: 15 independent 512-point FFTs where n = n1 + 15 * n2
  // Wait: let's map n = n1 * 512 + n2 -> k = k1 + 15 * k2:
  // X[k1 + 15*k2] = sum_{n2=0..511} W_512^(n2*k2) * W_7680^(n2*k1) * [sum_{n1=0..14} x[n1*512+n2] * W_15^(n1*k1)]
  // That means Step A = 15-point DFT along n1 (for each n2), Step B = multiply by W_7680^(n2*k1), Step C = 512-point FFT along n2 (for each k1)!
  // And output lands at k = k1 + 15 * k2!

  // Step A: 15-point DFT over n1 for each n2 = 0..511
  for (let n2 = 0; n2 < N2; n2++) {
    for (let k1 = 0; k1 < N1; k1++) {
      let sumRe = 0;
      let sumIm = 0;
      const rowOffset = k1 * N1;
      for (let n1 = 0; n1 < N1; n1++) {
        const srcIdx = n1 * N2 + n2;
        const xr = inRe[srcIdx];
        const xi = inIm[srcIdx];
        const c = dft15Cos[rowOffset + n1];
        const s = dft15Sin[rowOffset + n1];
        sumRe += xr * c - xi * s;
        sumIm += xr * s + xi * c;
      }
      // Step B: Multiply by twiddle W_7680^(k1 * n2)
      const twIdx = k1 * N2 + n2;
      const tc = twCrossCos[twIdx];
      const ts = twCrossSin[twIdx];
      scratchRe[twIdx] = sumRe * tc - sumIm * ts;
      scratchIm[twIdx] = sumRe * ts + sumIm * tc;
    }
  }

  // Step C: 512-point Radix-2 FFT along n2 for each k1 = 0..14
  for (let k1 = 0; k1 < N1; k1++) {
    const base = k1 * N2;
    // Bit-reversed copy into working slice of outRe/outIm? No, copy into scratch -> wait:
    // Use scratchRe/Im as in-place buffer after permuting into temp 512 or directly permute into temp?
    // Even simpler: copy bit-reversed row from scratch[base..] into outRe[base..] if stride=1, then scatter back to k1 + 15*k2!
    // Wait: using temporary 512-length subarray inside outRe[0..511] isn't safe if we overwrite, so let's copy into outRe[base..base+511] in bit-reversed order, run in-place FFT on [base..base+511], then scatter!
    for (let i = 0; i < N2; i++) {
      const src = base + bitRev512[i];
      outRe[base + i] = scratchRe[src];
      outIm[base + i] = scratchIm[src];
    }

    for (let size = 2; size <= N2; size <<= 1) {
      const half = size >> 1;
      const step = N2 / size;
      for (let i = 0; i < N2; i += size) {
        for (let j = 0; j < half; j++) {
          const twIdx = j * step;
          const c = tw512Cos[twIdx];
          const s = tw512Sin[twIdx];
          const evenIdx = base + i + j;
          const oddIdx = evenIdx + half;
          const or = outRe[oddIdx];
          const oi = outIm[oddIdx];
          const tr = or * c - oi * s;
          const ti = or * s + oi * c;
          const er = outRe[evenIdx];
          const ei = outIm[evenIdx];
          outRe[evenIdx] = er + tr;
          outIm[evenIdx] = ei + ti;
          outRe[oddIdx] = er - tr;
          outIm[oddIdx] = ei - ti;
        }
      }
    }
  }

  // Transpose outRe/outIm from [k1 * 512 + k2] to flat [k1 + 15 * k2] via scratch
  for (let i = 0; i < N_FFT; i++) {
    scratchRe[i] = outRe[i];
    scratchIm[i] = outIm[i];
  }
  for (let k1 = 0; k1 < N1; k1++) {
    const srcBase = k1 * N2;
    for (let k2 = 0; k2 < N2; k2++) {
      const dst = k1 + N1 * k2;
      outRe[dst] = scratchRe[srcBase + k2];
      outIm[dst] = scratchIm[srcBase + k2];
    }
  }
}

function ifft7680(
  inRe: Float64Array,
  inIm: Float64Array,
  outRe: Float64Array,
  outIm: Float64Array,
  scratchRe: Float64Array,
  scratchIm: Float64Array
): void {
  // Conjugate input in-place into scratch-safe copy? We mutate inIm temporarily then restore or copy
  for (let i = 0; i < N_FFT; i++) {
    inIm[i] = -inIm[i];
  }
  fft7680(inRe, inIm, outRe, outIm, scratchRe, scratchIm);
  const invN = 1 / N_FFT;
  for (let i = 0; i < N_FFT; i++) {
    inIm[i] = -inIm[i]; // restore caller buffer
    outRe[i] *= invN;
    outIm[i] = -outIm[i] * invN;
  }
}

function reflectIndex(idx: number, len: number): number {
  if (len <= 1) return 0;
  let i = idx;
  while (i < 0 || i >= len) {
    if (i < 0) i = -i;
    if (i >= len) i = 2 * len - 2 - i;
  }
  return i;
}

/**
 * Converts a 2-channel stereo waveform chunk of length `chunkSamples` (261,120)
 * into a flat Float32Array tensor of shape [1, 4, 3072, 256] matching Kim_Vocal_2.onnx.
 */
export function stftChunkToTensor(
  left: Float32Array,
  right: Float32Array,
  tensorOut: Float32Array
): void {
  ensureTables();
  const { hopLength, dimF, framesPerChunk, chunkSamples, trimSamples } = MDX_MODEL_CONFIG;
  const paddedLen = chunkSamples + 2 * trimSamples; // 268,800

  const inRe = new Float64Array(N_FFT);
  const inIm = new Float64Array(N_FFT);
  const outRe = new Float64Array(N_FFT);
  const outIm = new Float64Array(N_FFT);
  const scratchRe = new Float64Array(N_FFT);
  const scratchIm = new Float64Array(N_FFT);

  const planeSize = dimF * framesPerChunk;

  const processChannel = (signal: Float32Array, realPlaneOffset: number, imagPlaneOffset: number) => {
    // Build center-reflect padded channel buffer
    const padded = new Float32Array(paddedLen);
    for (let i = 0; i < paddedLen; i++) {
      padded[i] = signal[reflectIndex(i - trimSamples, chunkSamples)];
    }

    for (let t = 0; t < framesPerChunk; t++) {
      const start = t * hopLength;
      for (let n = 0; n < N_FFT; n++) {
        inRe[n] = padded[start + n] * hannWindow[n];
        inIm[n] = 0;
      }
      fft7680(inRe, inIm, outRe, outIm, scratchRe, scratchIm);

      for (let f = 0; f < dimF; f++) {
        const idx = f * framesPerChunk + t;
        tensorOut[realPlaneOffset + idx] = outRe[f];
        tensorOut[imagPlaneOffset + idx] = outIm[f];
      }
    }
  };

  processChannel(left, 0, planeSize);
  processChannel(right, planeSize * 2, planeSize * 3);
}

/**
 * Converts a model output Float32Array tensor of shape [1, 4, 3072, 256]
 * back into 2-channel stereo waveform arrays of length `chunkSamples` (261,120).
 */
export function tensorToIstftChunk(
  tensor: Float32Array,
  outLeft: Float32Array,
  outRight: Float32Array,
  compensate = MDX_MODEL_CONFIG.compensate
): void {
  ensureTables();
  const { hopLength, dimF, framesPerChunk, chunkSamples, trimSamples } = MDX_MODEL_CONFIG;
  const paddedLen = chunkSamples + 2 * trimSamples;
  const planeSize = dimF * framesPerChunk;

  const specRe = new Float64Array(N_FFT);
  const specIm = new Float64Array(N_FFT);
  const timeRe = new Float64Array(N_FFT);
  const timeIm = new Float64Array(N_FFT);
  const scratchRe = new Float64Array(N_FFT);
  const scratchIm = new Float64Array(N_FFT);

  const overlapAcc = new Float64Array(paddedLen);
  const winSqAcc = new Float64Array(paddedLen);

  // Precompute window normalization sum once for all channels
  for (let t = 0; t < framesPerChunk; t++) {
    const start = t * hopLength;
    for (let n = 0; n < N_FFT; n++) {
      const w = hannWindow[n];
      winSqAcc[start + n] += w * w;
    }
  }

  const reconstructChannel = (
    realPlaneOffset: number,
    imagPlaneOffset: number,
    dest: Float32Array
  ) => {
    overlapAcc.fill(0);

    for (let t = 0; t < framesPerChunk; t++) {
      specRe.fill(0);
      specIm.fill(0);

      for (let f = 0; f < dimF; f++) {
        const idx = f * framesPerChunk + t;
        const re = tensor[realPlaneOffset + idx];
        const im = tensor[imagPlaneOffset + idx];
        specRe[f] = re;
        specIm[f] = im;
        if (f > 0 && f < N_FFT / 2) {
          // Hermitian conjugate symmetry for real signal
          specRe[N_FFT - f] = re;
          specIm[N_FFT - f] = -im;
        }
      }

      ifft7680(specRe, specIm, timeRe, timeIm, scratchRe, scratchIm);

      const start = t * hopLength;
      for (let n = 0; n < N_FFT; n++) {
        overlapAcc[start + n] += timeRe[n] * hannWindow[n];
      }
    }

    for (let i = 0; i < chunkSamples; i++) {
      const pIdx = i + trimSamples;
      const denom = winSqAcc[pIdx] > 1e-8 ? winSqAcc[pIdx] : 1e-8;
      dest[i] = (overlapAcc[pIdx] / denom) * compensate;
    }
  };

  reconstructChannel(0, planeSize, outLeft);
  reconstructChannel(planeSize * 2, planeSize * 3, outRight);
}

/**
 * Helper to compute overlap-add chunk intervals across an arbitrary length stereo audio track.
 * Uses an overlap of 32,768 samples (~0.74s) with smooth cosine crossfade to eliminate chunk seam artifacts.
 */
export const CHUNK_OVERLAP_SAMPLES = 32768;

export interface ChunkPlanItem {
  index: number;
  start: number;
  end: number;
  validLen: number;
}

export function buildChunkPlan(totalSamples: number): ChunkPlanItem[] {
  const chunkLen = MDX_MODEL_CONFIG.chunkSamples;
  const stride = chunkLen - CHUNK_OVERLAP_SAMPLES;
  const plan: ChunkPlanItem[] = [];
  if (totalSamples <= 0) return plan;

  let start = 0;
  let index = 0;
  while (start < totalSamples) {
    const end = Math.min(totalSamples, start + chunkLen);
    plan.push({
      index,
      start,
      end,
      validLen: end - start,
    });
    if (end >= totalSamples) break;
    start += stride;
    index++;
  }
  return plan;
}

/**
 * Accumulates a separated chunk into full-track vocal buffers with cosine-tapered overlap weighting.
 */
export function accumulateChunk(
  item: ChunkPlanItem,
  totalChunks: number,
  chunkL: Float32Array,
  chunkR: Float32Array,
  accL: Float32Array,
  accR: Float32Array,
  weightAcc: Float32Array
): void {
  const margin = MDX_MODEL_CONFIG.trimSamples; // ignore outer edge boundary where reflect padding tapers (except very start/end of track)
  const overlap = CHUNK_OVERLAP_SAMPLES;
  const len = item.validLen;

  for (let i = 0; i < len; i++) {
    let w = 1.0;

    if (item.index > 0) {
      if (i < margin) {
        w = 0.0;
      } else if (i < overlap) {
        const u = (i - margin) / Math.max(1, overlap - margin);
        w *= 0.5 * (1 - Math.cos(Math.PI * u));
      }
    }

    if (item.index < totalChunks - 1) {
      const distFromEnd = len - 1 - i;
      if (distFromEnd < margin) {
        w = 0.0;
      } else if (distFromEnd < overlap) {
        const u = (distFromEnd - margin) / Math.max(1, overlap - margin);
        w *= 0.5 * (1 - Math.cos(Math.PI * u));
      }
    }

    const pos = item.start + i;
    accL[pos] += chunkL[i] * w;
    accR[pos] += chunkR[i] * w;
    weightAcc[pos] += w;
  }
}

/**
 * Finalizes separated Vocal and derives Instrumental = Mix - Vocal cleanly.
 */
export function finalizeStems(
  mixL: Float32Array,
  mixR: Float32Array,
  vocalAccL: Float32Array,
  vocalAccR: Float32Array,
  weightAcc: Float32Array
): {
  vocalL: Float32Array;
  vocalR: Float32Array;
  instL: Float32Array;
  instR: Float32Array;
} {
  const len = mixL.length;
  const vocalL = new Float32Array(len);
  const vocalR = new Float32Array(len);
  const instL = new Float32Array(len);
  const instR = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const w = weightAcc[i] > 1e-6 ? weightAcc[i] : 1;
    const vl = Math.max(-1, Math.min(1, vocalAccL[i] / w));
    const vr = Math.max(-1, Math.min(1, vocalAccR[i] / w));
    vocalL[i] = vl;
    vocalR[i] = vr;
    instL[i] = Math.max(-1, Math.min(1, mixL[i] - vl));
    instR[i] = Math.max(-1, Math.min(1, mixR[i] - vr));
  }

  return { vocalL, vocalR, instL, instR };
}

/**
 * Encodes stereo Float32Array PCM channels into a standard 16-bit PCM WAV Uint8Array.
 */
export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number = MDX_MODEL_CONFIG.sampleRate
): Uint8Array {
  const numFrames = left.length;
  const dataBytes = numFrames * 4; // 2 channels * 2 bytes (16-bit)
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // byte rate
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return new Uint8Array(buf);
}
