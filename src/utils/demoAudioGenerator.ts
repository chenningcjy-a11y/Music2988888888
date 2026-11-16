import { TrackMetadata } from '../types/music';
import {
  extractPaletteFromImage,
  generateProceduralCover,
} from './colorExtractor';

/**
 * Encodes a stereo Float32Array pair into a valid 44.1 kHz 16-bit PCM WAV Blob.
 * Produces real acoustic PCM audio playable via HTMLAudioElement and analyzable via Web Audio API.
 */
function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Blob {
  const numSamples = left.length;
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 2, true); // Stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // Byte rate
  view.setUint16(32, 4, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 4, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

interface SynthTrackConfig {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  chords: number[][];
  bpm: number;
  hue: number;
  lyrics: string;
}

const DEMO_CONFIGS: SynthTrackConfig[] = [
  {
    id: 'demo-crimson-reverie',
    title: '绯夜回响 (Crimson Reverie)',
    artist: 'Lumina Acoustic Ensemble',
    album: 'Nocturne in Burgundy · 44.1kHz PCM',
    durationSec: 42,
    bpm: 84,
    hue: 336,
    // Am9 -> Fmaj7 -> Dm9 -> E7sus4
    chords: [
      [110.0, 220.0, 261.63, 329.63, 493.88],
      [87.31, 174.61, 220.0, 261.63, 329.63],
      [73.42, 146.83, 220.0, 261.63, 329.63],
      [82.41, 164.81, 220.0, 246.94, 329.63],
    ],
    lyrics: `[ti:绯夜回响 (Crimson Reverie)]
[ar:Lumina Acoustic Ensemble]
[00:01.20]<00:01.20>深宵<00:02.60>的微光<00:04.10>漫过黑胶<00:05.80>纹理 // <00:01.20>Midnight glow drifts across the vinyl grooves
[00:07.00]<00:07.00>低音<00:08.50>在夜色里<00:10.10>缓慢呼吸 // <00:07.00>Sub-bass breathes gently in the velvet dark
[00:13.20]<00:13.20>玫瑰色<00:14.80>波浪随<00:16.40>频率起伏 // <00:13.20>Rose-crimson waves rise and fall with every frequency
[00:19.00]<00:19.00>高频<00:20.40>星尘<00:21.90>于声场间闪烁 // <00:19.00>High-frequency stardust shimmers across the soundstage
[00:25.20]<00:25.20>双耳<00:26.80>环绕出<00:28.50>立体的梦境 // <00:25.20>Binaural space unfolds a three-dimensional dream
[00:31.50]<00:31.50>让音乐<00:33.20>回归真实<00:35.10>且纯粹的律动 // <00:31.50>Let the music return to pure, authentic resonance
[00:37.50]请随时导入本地 MP3 / FLAC / WAV 曲目体验完整解析 // Import your local audio files anytime`,
  },
  {
    id: 'demo-velvet-horizon',
    title: '暮光星尘 (Velvet Horizon)',
    artist: 'Nocturne Synth Collective',
    album: 'Violet Frequency Sessions',
    durationSec: 36,
    bpm: 96,
    hue: 268,
    // Cmaj9 -> G6 -> Am7 -> Fmaj7
    chords: [
      [65.41, 130.81, 196.0, 246.94, 293.66],
      [98.0, 196.0, 246.94, 329.63, 392.0],
      [110.0, 220.0, 261.63, 329.63, 392.0],
      [87.31, 174.61, 220.0, 261.63, 349.23],
    ],
    lyrics: `[ti:暮光星尘 (Velvet Horizon)]
[ar:Nocturne Synth Collective]
[00:01.00]当紫色夜幕降临城市边缘 // As violet twilight settles over the horizon
[00:06.50]声波在玻璃幕墙间轻轻折射 // Soundwaves refract softly across glass panels
[00:12.00]在均衡器中微调属于你的听感 // Sculpt your signature tone inside the 7-band EQ
[00:18.00]每一个频段都由真实信号驱动 // Every band driven by genuine audio signal
[00:24.50]静谧时刻，只余纯粹和声回荡 // In quiet moments, only pure harmony remains
[00:30.00]LUMINA MUSIC · 高品质本地音频殿堂 // High-Fidelity Local Audio Sanctuary`,
  },
];

function synthesizeTrackSamples(cfg: SynthTrackConfig): {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
} {
  const sampleRate = 44100;
  const totalSamples = cfg.durationSec * sampleRate;
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const beatDuration = 60 / cfg.bpm;
  const chordDuration = beatDuration * 4;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.floor(t / chordDuration) % cfg.chords.length;
    const chord = cfg.chords[chordIdx];
    const chordLocalT = t % chordDuration;

    // Smooth pad envelope per chord
    const padEnv =
      Math.min(1, chordLocalT / 0.45) *
      Math.min(1, (chordDuration - chordLocalT) / 0.55);

    // Subtle bass pulse per beat
    const beatLocalT = t % beatDuration;
    const kickEnv = Math.exp(-beatLocalT * 6.5);
    const subFreq = chord[0] * (1 + 0.35 * Math.exp(-beatLocalT * 28));
    const bass = Math.sin(2 * Math.PI * subFreq * t) * 0.34 * (0.45 + 0.55 * kickEnv);

    // Warm stereo detuned pads
    let padL = 0;
    let padR = 0;
    for (let n = 1; n < chord.length; n++) {
      const freq = chord[n];
      const detune = n % 2 === 0 ? 1.0025 : 0.9975;
      const pan = n / chord.length;
      const toneL =
        Math.sin(2 * Math.PI * freq * t) * 0.65 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.14;
      const toneR =
        Math.sin(2 * Math.PI * freq * detune * t) * 0.65 +
        Math.sin(2 * Math.PI * freq * 2 * detune * t) * 0.14;
      padL += toneL * (1 - pan * 0.35);
      padR += toneR * (0.65 + pan * 0.35);
    }
    padL = (padL / 4) * 0.36 * padEnv;
    padR = (padR / 4) * 0.36 * padEnv;

    // Gentle arpeggio chime on 8th notes for crisp high-frequency shimmer
    const stepDuration = beatDuration / 2;
    const stepIdx = Math.floor(t / stepDuration);
    const stepLocalT = t % stepDuration;
    const arpNote = chord[1 + (stepIdx % (chord.length - 1))] * 2;
    const arpEnv = Math.exp(-stepLocalT * 7.5);
    const arpPan = 0.5 + 0.45 * Math.sin(stepIdx * 1.3);
    const arpWave =
      (Math.sin(2 * Math.PI * arpNote * t) +
        0.3 * Math.sin(2 * Math.PI * arpNote * 2 * t)) *
      0.16 *
      arpEnv;

    // Master fade in/out
    const masterEnv =
      Math.min(1, t / 1.0) * Math.min(1, (cfg.durationSec - t) / 1.5);

    left[i] = (bass + padL + arpWave * (1 - arpPan * 0.6)) * masterEnv;
    right[i] = (bass + padR + arpWave * (0.4 + arpPan * 0.6)) * masterEnv;
  }

  return { left, right, sampleRate };
}

export async function generateDemoTracks(): Promise<
  { track: TrackMetadata; blob: Blob }[]
> {
  const results: { track: TrackMetadata; blob: Blob }[] = [];

  for (let idx = 0; idx < DEMO_CONFIGS.length; idx++) {
    const cfg = DEMO_CONFIGS[idx];
    const { left, right, sampleRate } = synthesizeTrackSamples(cfg);
    const blob = encodeStereoWav(left, right, sampleRate);
    const coverDataUrl = generateProceduralCover(cfg.title, cfg.artist, cfg.hue);
    const palette = await extractPaletteFromImage(coverDataUrl);

    const track: TrackMetadata = {
      id: cfg.id,
      title: cfg.title,
      artist: cfg.artist,
      album: cfg.album,
      duration: cfg.durationSec,
      format: 'WAV',
      mimeType: 'audio/wav',
      fileSize: blob.size,
      bitrate: sampleRate * 16 * 2, // 1411.2 kbps uncompressed stereo PCM
      sampleRate,
      bitsPerSample: 16,
      channels: 2,
      coverDataUrl,
      palette,
      favorite: idx === 0,
      lyricsRaw: cfg.lyrics,
      lyricsOffsetMs: 0,
      addedAt: Date.now() + idx,
      isDemo: true,
    };

    results.push({ track, blob });
  }

  return results;
}
