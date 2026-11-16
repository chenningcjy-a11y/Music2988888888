export type NavPage =
  | 'player'
  | 'library'
  | 'playlists'
  | 'lyrics'
  | 'mv'
  | 'audio'
  | 'ai'
  | 'tasks'
  | 'settings';

export type RepeatMode = 'off' | 'all' | 'one';

export type QualityMode = 'original' | 'high' | 'lossless' | 'auto';

export type EqPresetName =
  | '标准'
  | '流行'
  | '摇滚'
  | '古典'
  | '爵士'
  | '电子'
  | '人声增强'
  | '低音增强'
  | '自定义';

export type ThemePresetId = 'burgundy' | 'violet' | 'emerald' | 'adaptive';

export type AnimationIntensity = 'low' | 'balanced' | 'high';

export interface LyricWord {
  time: number; // seconds
  text: string;
}

export interface LyricLine {
  id: string;
  time: number; // seconds
  text: string;
  translation?: string;
  words?: LyricWord[]; // Populated ONLY when true word-level timestamps exist
}

export interface TrackColorPalette {
  primary: string; // hex e.g. #e8437f
  secondary: string; // hex e.g. #7c2ae8
  deep: string; // hex dark tint e.g. #210712
  rgbPrimary: [number, number, number];
  rgbSecondary: [number, number, number];
}

export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  format: string; // MP3, FLAC, WAV, AAC, M4A, OGG, OPUS
  mimeType: string;
  fileSize: number; // bytes
  bitrate?: number; // bps
  sampleRate?: number; // Hz
  bitsPerSample?: number; // e.g. 16, 24
  channels?: number;
  coverDataUrl?: string;
  palette: TrackColorPalette;
  favorite: boolean;
  lyricsRaw?: string;
  lyricsOffsetMs: number;
  addedAt: number;
  isDemo?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AudioDspSettings {
  masterEnabled: boolean;
  qualityMode: QualityMode;
  surroundEnabled: boolean;
  surroundWidth: number; // 0 to 100
  surroundIntensity: number; // 0 to 100
  headphoneOptimize: boolean;
  eqPreset: EqPresetName;
  eqGains: [number, number, number, number, number, number, number]; // dB for 60, 150, 400, 1k, 2.4k, 6k, 15k
  bassBoost: number; // 0 to 12 dB
  trebleBoost: number; // 0 to 12 dB
  vocalEnhance: number; // 0 to 10 dB
  reverbMix: number; // 0 to 100 %
  stereoWidth: number; // 0 to 100 %
  loudnessNormalization: boolean;
  vocalAccompanimentBalance: number; // -100 (vocal 0%, bg 100%) to 0 (both 100%) to +100 (vocal 100%, bg 0%)
  stemModeActive: boolean; // false = 原始音频, true = 分离音频 (AI 双轨混音)
  vocalGain: number; // 0 to 200 (%)
  instrumentalGain: number; // 0 to 200 (%)
  vocalMuted: boolean;
  instrumentalMuted: boolean;
}

export type SeparationEngineMode = 'auto' | 'local' | 'server';

export type SeparationStatus =
  | 'idle'
  | 'downloading-model'
  | 'decoding'
  | 'separating'
  | 'encoding'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface TrackStemsRecord {
  trackId: string;
  vocalBlob: Blob;
  instrumentalBlob: Blob;
  modelId: string;
  modelName: string;
  engineUsed: 'local-webgpu' | 'local-wasm' | 'server-onnx';
  duration: number;
  createdAt: number;
}

export interface TrackStemsMeta {
  trackId: string;
  modelId: string;
  modelName: string;
  engineUsed: 'local-webgpu' | 'local-wasm' | 'server-onnx';
  duration: number;
  createdAt: number;
  vocalSizeBytes: number;
  instrumentalSizeBytes: number;
}

export interface SeparationProgressState {
  status: SeparationStatus;
  trackId: string | null;
  progress: number; // 0..100
  stageLabel: string;
  detailLabel?: string;
  engineLabel?: string;
  error?: string;
}

export type FontPresetId = 'modern' | 'editorial' | 'rounded' | 'mono' | 'classic';

export interface PersonalizationSettings {
  themePreset: ThemePresetId;
  fontPreset: FontPresetId;
  followCoverColor: boolean;
  dynamicBackgroundGlow: boolean;
  glowIntensity: number; // 0 to 100
  animationIntensity: AnimationIntensity;
  reducedMotion?: boolean;
  showBilingualLyrics: boolean;
  showWordSync: boolean;
  showVinylParticles?: boolean;
  showLiquidWave: boolean;
  aiTranslationEngine?: string; // providerId or 'default'
  aiTranslationModel?: string;
  importMode?: 'lean' | 'full'; // 'lean' = 仅导入音源与封面 (精简导入)
  mvBackgroundEnabled?: boolean;
  mvStandaloneOnly?: boolean;
  mvBlurPx?: number;
  mvOpacityPct?: number;
  mvUiFadeInSec?: number; // Global UI fade-in duration/lead time (s) before music resumes
  mvUiFadeOutSec?: number; // Global UI fade-out duration/lead time (s) before mid-break or outro
}

export interface MvMidBreakRange {
  id: string;
  label?: string;
  audioTriggerSec: number; // Song audio timestamp (s) where music pauses for MV non-audio segment
  mvStartSec: number; // MV timestamp (s) where non-audio segment begins
  mvEndSec: number; // MV timestamp (s) where singing/music resumes
}

export interface TrackMvTimelineConfig {
  introEnabled: boolean;
  introEndSec: number; // MV time (s) where song audio 0:00 begins
  midBreaks: MvMidBreakRange[];
  outroEnabled: boolean;
  outroEndSec?: number; // Optional MV end timestamp; defaults to full video duration
  fadeTransitionSec: number; // Lead/fade time (s) for UI & background blur transition
  syncOffsetSec: number; // Fine manual sync offset (s)
  playbackRateAdjust: number; // Micro speed trim (0.98 ~ 1.02)
}

export type MvTheaterPhase = 'normal' | 'intro' | 'mid-break' | 'outro';

export interface TrackMvMeta {
  id: string;
  trackId: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSec: number;
  sourceType: 'local' | 'url';
  externalUrl?: string;
  addedAt: number;
  isActive: boolean;
  blurPx: number;
  opacityPct: number;
  timeline: TrackMvTimelineConfig;
}

export interface TrackMvRecord extends TrackMvMeta {
  videoBlob?: Blob;
}

export interface PlaybackPrefs {
  volume: number; // 0 to 1
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  lastTrackId?: string;
}

export interface AudioAnalysisFrame {
  bass: number; // 0..1
  mid: number; // 0..1
  high: number; // 0..1
  volume: number; // 0..1
  frequencies: Uint8Array;
  waveform: Uint8Array;
}
