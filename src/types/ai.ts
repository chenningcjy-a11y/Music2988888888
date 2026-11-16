import { AudioDspSettings } from './music';

export type AiSubTab = 'assistant' | 'toolbox' | 'providers' | 'history';

export type AiProviderKind =
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'openai-compatible'
  | 'custom';

export type ProviderConnectionStatus = 'untested' | 'connected' | 'error';

export interface ModelCapabilities {
  textReasoning: boolean;
  lyricsProcessing: boolean;
  dspPlanning: boolean;
  audioInputAnalysis: boolean;
  stemSeparation: boolean;
  note?: string;
}

export interface DiscoveredModel {
  id: string;
  label: string;
  capabilities: ModelCapabilities;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  availableModels: string[];
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  timeoutMs: number;
  maxRequestsPerDay: number;
  requestsToday: number;
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  customHeadersJson?: string;
  createdAt: number;
  updatedAt: number;
}

export type StemServiceKind = 'builtin-mdx' | 'remote-demucs-http' | 'none';

export interface StemServiceConfig {
  id: string;
  name: string;
  kind: StemServiceKind;
  baseUrl: string;
  endpointPath: string;
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  isActive: boolean;
  timeoutMs: number;
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
}

export type AiTaskCategory =
  | 'stem_separation'
  | 'lyrics_assistant'
  | 'audio_analysis'
  | 'dsp_tuning'
  | 'audio_processing'
  | 'intent_routing'
  | 'custom';

export type AiTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'needs_resubmit'
  | 'error';

export interface AiTaskSourceFileInfo {
  format: string;
  fileSizeBytes: number;
  durationSec: number;
  sampleRate?: number;
  bitrate?: number;
  fileIdentifier?: string;
}

export interface AiTaskStageLog {
  timestamp: number;
  stage: string;
  detail?: string;
}

export interface AiTaskRecord {
  id: string;
  taskName: string;
  category: AiTaskCategory;
  providerName: string;
  modelName: string;

  // Immutable source track snapshot (never bound to player's currentTrack)
  sourceTrackId?: string;
  sourceTrackTitle?: string;
  sourceTrackArtist?: string;
  sourceTrackAlbum?: string;
  sourceTrackCoverUrl?: string;
  sourceFileInfo?: AiTaskSourceFileInfo;
  trackTitle?: string; // display alias kept synchronized with sourceTrackTitle

  // Execution metadata
  engineMode?: 'auto' | 'local' | 'server' | 'remote-demucs-http';
  engineLabel?: string;
  backendJobId?: string;
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
  status: AiTaskStatus;
  progress: number;
  stageLabel?: string;
  stepLabel?: string;
  currentChunk?: number;
  totalChunks?: number;
  estimatedRemainingSec?: number | null;
  stageLogs?: AiTaskStageLog[];

  // Result & error tracking
  resultSummary?: string;
  resultData?: unknown;
  stemMeta?: {
    trackId: string;
    modelId: string;
    modelName: string;
    engineUsed: 'local-webgpu' | 'local-wasm' | 'server-onnx';
    duration: number;
    createdAt: number;
    vocalSizeBytes: number;
    instrumentalSizeBytes: number;
  };
  errorMessage?: string;
  replayPayload?: {
    prompt?: string;
    category: AiTaskCategory;
    subAction?: string;
    targetTrackId?: string;
    engineMode?: 'auto' | 'local' | 'server';
    extra?: Record<string, unknown>;
  };
}

export interface DspPlanResponse {
  providerName: string;
  modelUsed: string;
  explanation: string;
  patch: Partial<AudioDspSettings>;
  suggestStemSeparation: boolean;
  warnings: string[];
}

export interface AudioAnalysisResult {
  genre: string;
  mood: string;
  instruments: string[];
  rhythmAndTempo: string;
  curatedSummary: string;
  tags: string[];
  analyzedFromAudio: boolean;
}
