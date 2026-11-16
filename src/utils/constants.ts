import {
  AudioDspSettings,
  EqPresetName,
  PersonalizationSettings,
  PlaybackPrefs,
  TrackColorPalette,
} from '../types/music';

export const EQ_BANDS: { freq: number; label: string }[] = [
  { freq: 60, label: '60Hz' },
  { freq: 150, label: '150Hz' },
  { freq: 400, label: '400Hz' },
  { freq: 1000, label: '1kHz' },
  { freq: 2400, label: '2.4kHz' },
  { freq: 6000, label: '6kHz' },
  { freq: 15000, label: '15kHz' },
];

export const EQ_PRESETS: Record<
  Exclude<EqPresetName, '自定义'>,
  [number, number, number, number, number, number, number]
> = {
  标准: [0, 0, 0, 0, 0, 0, 0],
  流行: [-1, 2, 4, 3, 1, 2, 3],
  摇滚: [5, 3, -1, 1, 3, 5, 4],
  古典: [4, 2, 0, 1, 2, 3, 5],
  爵士: [3, 2, 1, 2, 3, 2, 3],
  电子: [6, 4, 1, -1, 2, 4, 5],
  人声增强: [-3, -1, 2, 5, 6, 3, 1],
  低音增强: [7, 5, 2, 0, 0, 1, 1],
};

export const DEFAULT_AUDIO_SETTINGS: AudioDspSettings = {
  masterEnabled: true,
  qualityMode: 'auto',
  surroundEnabled: false,
  surroundWidth: 65,
  surroundIntensity: 55,
  headphoneOptimize: true,
  eqPreset: '标准',
  eqGains: [0, 0, 0, 0, 0, 0, 0],
  bassBoost: 0,
  trebleBoost: 0,
  vocalEnhance: 0,
  reverbMix: 0,
  stereoWidth: 50,
  loudnessNormalization: true,
  vocalAccompanimentBalance: 0,
  stemModeActive: false,
  vocalGain: 100,
  instrumentalGain: 100,
  vocalMuted: false,
  instrumentalMuted: false,
};

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  themePreset: 'adaptive',
  fontPreset: 'modern',
  followCoverColor: true,
  dynamicBackgroundGlow: true,
  glowIntensity: 75,
  animationIntensity: 'balanced',
  reducedMotion: false,
  showBilingualLyrics: true,
  showWordSync: true,
  showVinylParticles: false,
  showLiquidWave: true,
  aiTranslationEngine: 'default',
  aiTranslationModel: '',
  importMode: 'lean',
  mvBackgroundEnabled: true,
  mvStandaloneOnly: false,
  mvBlurPx: 0,
  mvOpacityPct: 100,
  mvUiFadeInSec: 1.0,
  mvUiFadeOutSec: 1.0,
};

export const DEFAULT_PLAYBACK_PREFS: PlaybackPrefs = {
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: 'all',
};

export const DEFAULT_PALETTE: TrackColorPalette = {
  primary: '#e8437f',
  secondary: '#8b3dff',
  deep: '#1b0610',
  rgbPrimary: [232, 67, 127],
  rgbSecondary: [139, 61, 255],
};

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatSampleRate(hz?: number): string {
  if (!hz) return '未知';
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

export function formatBitrate(bps?: number): string {
  if (!bps) return '未知';
  return `${Math.round(bps / 1000)} kbps`;
}
