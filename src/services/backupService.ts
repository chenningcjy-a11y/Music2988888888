import {
  fetchProviders,
  fetchStemServices,
  saveProvider,
  saveStemService,
  setActiveStemServiceId,
  setDefaultProviderById,
} from './ai/providerManager';
import {
  clearAiTasks,
  clearAllMvs,
  clearPendingMvTimelines,
  clearPlaylistsStore,
  clearStemsStore,
  clearTracksStore,
  getAllAiTasks,
  getAllMvMetas,
  getAllPlaylists,
  getAllStemMetas,
  getAllTracks,
  getAudioBlob,
  getMvBlobById,
  getTrackStems,
  loadAudioSettings,
  loadPendingMvTimelines,
  loadPersonalization,
  loadPlaybackPrefs,
  requestPersistentStorage,
  saveAiTasksBatch,
  saveAudioSettings,
  savePersonalization,
  savePlaybackPrefs,
  savePlaylist,
  saveTrackMv,
  saveTrackStems,
  saveTrackWithBlob,
  updateMvRecordMeta,
  upsertPendingMvTimelinesBatch,
} from './storage';
import {
  AiProviderConfig,
  AiTaskRecord,
  AiTaskStatus,
  StemServiceConfig,
} from '../types/ai';
import {
  AudioDspSettings,
  BackupSelectionOptions,
  PendingMvTimelineRecord,
  PersonalizationSettings,
  PlaybackPrefs,
  Playlist,
  TrackMetadata,
  TrackMvMeta,
  TrackMvRecord,
  TrackStemsRecord,
} from '../types/music';

// Binary store container magic bytes (v4 footer-indexed so both disk-streaming & Blob sharding share 1 format)
const BINARY_MAGIC_HEAD = 'LMBAK004';
const BINARY_MAGIC_TAIL = 'LMEOF004';
const LEGACY_BINARY_MAGIC_HEAD = 'LMBAK003';

// 350 MiB safe volume ceiling for browser Blob downloads (prevents Android/Chrome >1GB blob IPC crashes)
export const SAFE_BROWSER_VOLUME_BYTES = 350 * 1024 * 1024;
// Under 20 MiB of binary data, export lightweight JSON directly; >= 20 MiB, use zero-copy .lumina binary archive
const BINARY_CONTAINER_THRESHOLD_BYTES = 20 * 1024 * 1024;
// Disk streaming chunk size for FileSystemWritableFileStream (8 MiB per write keeps RAM tiny)
const DISK_STREAM_WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

// JSON fallback constants for legacy .json / small backups
const BASE64_ENCODE_SLICE_BYTES = 3 * 1024 * 1024;
const LARGE_JSON_STREAM_THRESHOLD_BYTES = 64 * 1024 * 1024;
const STREAM_READ_CHUNK_BYTES = 2 * 1024 * 1024;

export type ExportVolumeMode = 'auto' | 'sharded' | 'single-stream' | 'single-blob';

export const DEFAULT_BACKUP_EXPORT_OPTIONS: BackupSelectionOptions = {
  includeTracksMeta: true,
  includeTrackAudio: true,
  includePlaylists: true,
  includeMvTimelines: true,
  includeMvVideos: true,
  includeStems: true,
  includeAudioSettings: true,
  includePersonalization: true,
  includeAiData: true,
};

export const LIGHTWEIGHT_BACKUP_OPTIONS: BackupSelectionOptions = {
  includeTracksMeta: true,
  includeTrackAudio: false,
  includePlaylists: true,
  includeMvTimelines: true,
  includeMvVideos: false,
  includeStems: false,
  includeAudioSettings: true,
  includePersonalization: true,
  includeAiData: true,
};

export const MV_TIMELINE_ONLY_BACKUP_OPTIONS: BackupSelectionOptions = {
  includeTracksMeta: false,
  includeTrackAudio: false,
  includePlaylists: false,
  includeMvTimelines: true,
  includeMvVideos: false,
  includeStems: false,
  includeAudioSettings: false,
  includePersonalization: false,
  includeAiData: false,
};

export interface BinarySliceDescriptor {
  offset: number; // byte offset relative to byte 8 (start of payload section) in THIS file
  size: number; // byte length in THIS file
  totalSize: number; // original complete blob size
  mimeType: string;
  chunkIndex: number;
  totalChunks: number;
}

interface BinaryTrackEntry {
  track: TrackMetadata;
  includeMeta?: boolean;
  audioBlobRef?: BinarySliceDescriptor;
}

interface BinaryStemEntry {
  trackId: string;
  trackTitle?: string;
  trackArtist?: string;
  modelId: string;
  modelName: string;
  engineUsed: TrackStemsRecord['engineUsed'];
  duration: number;
  createdAt: number;
  vocalBlobRef?: BinarySliceDescriptor;
  instrumentalBlobRef?: BinarySliceDescriptor;
}

interface BinaryMvEntry {
  meta: TrackMvMeta;
  trackTitle?: string;
  trackArtist?: string;
  videoBlobRef?: BinarySliceDescriptor;
}

interface BinaryVolumeManifest {
  format: 'lumina-music-backup';
  version: 4;
  container: 'binary-store-v4';
  exportedAt: number;
  archiveGroupId: string;
  volumeIndex: number;
  volumeCount: number;
  selection: BackupSelectionOptions;
  manifest: BackupManifestSummary;
  tracks: BinaryTrackEntry[];
  playlists: Playlist[];
  stems: BinaryStemEntry[];
  mvs: BinaryMvEntry[];
  pendingMvTimelines: PendingMvTimelineRecord[];
  aiTasks: AiTaskRecord[];
  settings?: LuminaBackupBundle['settings'];
  aiConfigMetadata?: LuminaBackupBundle['aiConfigMetadata'];
}

interface SerializedTrackEntry {
  track: TrackMetadata;
  audioBase64?: string;
  audioMimeType?: string;
}

interface SerializedStemEntry {
  trackId: string;
  trackTitle?: string;
  trackArtist?: string;
  modelId: string;
  modelName: string;
  engineUsed: TrackStemsRecord['engineUsed'];
  duration: number;
  createdAt: number;
  vocalBase64: string;
  instrumentalBase64: string;
}

interface SerializedMvEntry {
  meta: TrackMvMeta;
  trackTitle?: string;
  trackArtist?: string;
  videoBase64?: string;
}

export interface BackupManifestSummary {
  tracksMetaCount: number;
  tracksAudioCount: number;
  playlistsCount: number;
  mvTimelinesCount: number;
  mvVideosCount: number;
  pendingMvTimelinesCount: number;
  stemsCount: number;
  hasAudioSettings: boolean;
  hasPersonalization: boolean;
  aiTasksCount: number;
  aiProvidersCount: number;
  stemServicesCount: number;
}

export interface LuminaBackupBundle {
  format: 'lumina-music-backup';
  version: 2 | 3;
  exportedAt: number;
  selection?: Partial<BackupSelectionOptions>;
  manifest?: BackupManifestSummary;
  tracks?: SerializedTrackEntry[];
  playlists?: Playlist[];
  stems?: SerializedStemEntry[];
  mvs?: SerializedMvEntry[];
  pendingMvTimelines?: PendingMvTimelineRecord[];
  aiTasks?: AiTaskRecord[];
  settings?: {
    audioSettings?: AudioDspSettings;
    personalization?: PersonalizationSettings;
    playbackPrefs?: PlaybackPrefs;
  };
  aiConfigMetadata?: {
    defaultProviderId: string | null;
    providers: Array<Omit<AiProviderConfig, 'hasKey'>>;
    activeStemServiceId: string | null;
    stemServices: Array<Omit<StemServiceConfig, 'hasKey'>>;
  };
}

export interface BackupLocalInventory {
  tracksMetaCount: number;
  tracksAudioCount: number;
  tracksAudioBytes: number;
  playlistsCount: number;
  mvTimelinesCount: number;
  activeMvRecordsCount: number;
  pendingMvTimelinesCount: number;
  mvVideosCount: number;
  mvVideosBytes: number;
  stemsCount: number;
  stemsBytes: number;
  aiTasksCount: number;
  aiProvidersCount: number;
  stemServicesCount: number;
}

export interface ExportedBackupVolume {
  index: number;
  total: number;
  filename: string;
  sizeBytes: number;
  blob?: Blob;
  writtenToDisk?: boolean;
  summary: string;
}

export interface ExportBackupResult {
  volumes: ExportedBackupVolume[];
  manifest: BackupManifestSummary;
  totalBytes: number;
  formatUsed: 'json' | 'lumina-binary';
  usedFileSystemStream: boolean;
}

export interface InspectedBackupFile {
  file: File;
  fileName: string;
  fileSizeBytes: number;
  container: 'json' | 'lumina-binary';
  version: number;
  exportedAt: number | null;
  volumeIndex?: number;
  volumeCount?: number;
  archiveGroupId?: string;
  manifest: BackupManifestSummary;
  availableOptions: BackupSelectionOptions;
}

export interface InspectedBackupBatch {
  items: InspectedBackupFile[];
  totalSizeBytes: number;
  exportedAt: number | null;
  manifest: BackupManifestSummary;
  availableOptions: BackupSelectionOptions;
  missingSplitChunksWarning: string | null;
}

export interface BackupImportSummary {
  tracksRestored: number;
  trackAudioRestored: number;
  playlistsRestored: number;
  stemsRestored: number;
  mvsRestored: number;
  mvVideosRestored: number;
  mvTimelinesMatchedExisting: number;
  pendingMvsStored: number;
  audioSettingsRestored: boolean;
  personalizationRestored: boolean;
  tasksRestored: number;
  tasksNormalizedToResubmit: number;
  aiProvidersSynced: number;
}

interface ParsedTrackItem {
  track: TrackMetadata;
  audioBlob?: Blob;
}

interface ParsedStemItem {
  trackId: string;
  trackTitle?: string;
  trackArtist?: string;
  modelId: string;
  modelName: string;
  engineUsed: TrackStemsRecord['engineUsed'];
  duration: number;
  createdAt: number;
  vocalBlob?: Blob;
  instrumentalBlob?: Blob;
}

interface ParsedMvItem {
  meta: TrackMvMeta;
  trackTitle?: string;
  trackArtist?: string;
  videoBlob?: Blob;
}

interface ExportContextData {
  tracks: TrackMetadata[];
  trackById: Map<string, TrackMetadata>;
  playlists: Playlist[];
  stemMetas: Array<{
    trackId: string;
    modelId: string;
    modelName: string;
    engineUsed: TrackStemsRecord['engineUsed'];
    duration: number;
    createdAt: number;
    vocalSizeBytes: number;
    instrumentalSizeBytes: number;
  }>;
  mvMetas: TrackMvMeta[];
  pendingMvTimelines: PendingMvTimelineRecord[];
  aiTasks: AiTaskRecord[];
  audioSettings?: AudioDspSettings;
  personalization?: PersonalizationSettings;
  playbackPrefs?: PlaybackPrefs;
  aiConfigMetadata: NonNullable<LuminaBackupBundle['aiConfigMetadata']>;
  manifest: BackupManifestSummary;
  estimatedBinaryBytes: number;
}

export interface FileSystemWritableFileStreamLike {
  write: (data: Blob | Uint8Array | ArrayBuffer | string) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

export interface FileSystemFileHandleLike {
  name?: string;
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decodeUtf8(buf: ArrayBuffer | Uint8Array): string {
  return new TextDecoder('utf-8').decode(buf);
}

function makeArchiveGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 12);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStr(s?: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripExt(name?: string): string {
  return normalizeStr(name).replace(/\.[^/.]+$/, '');
}

function shouldNormalizeImportedTask(status: AiTaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'queued' ||
    status === 'paused' ||
    status === 'awaiting_confirmation'
  );
}

function uint8ToBinaryString(bytes: Uint8Array): string {
  const subSize = 24576;
  let out = '';
  for (let i = 0; i < bytes.length; i += subSize) {
    const end = Math.min(i + subSize, bytes.length);
    const slice = bytes.subarray(i, end);
    out += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return out;
}

async function appendBlobAsJsonBase64Parts(
  blob: Blob,
  parts: BlobPart[]
): Promise<void> {
  parts.push('"');
  const total = blob.size;
  for (let offset = 0; offset < total; offset += BASE64_ENCODE_SLICE_BYTES) {
    const end = Math.min(offset + BASE64_ENCODE_SLICE_BYTES, total);
    const buf = await blob.slice(offset, end).arrayBuffer();
    const bytes = new Uint8Array(buf);
    parts.push(btoa(uint8ToBinaryString(bytes)));
  }
  parts.push('"');
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  if (!base64) return new Blob([], { type: mimeType });
  const parts: BlobPart[] = [];
  const step = 4 * 65536;
  for (let offset = 0; offset < base64.length; offset += step) {
    const slice = base64.slice(offset, Math.min(offset + step, base64.length));
    const binary = atob(slice);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    parts.push(bytes);
  }
  return new Blob(parts, { type: mimeType });
}

class StreamingBase64BlobBuilder {
  private pending = '';
  private parts: BlobPart[] = [];
  private mimeType: string;

  constructor(mimeType = 'application/octet-stream') {
    this.mimeType = mimeType;
  }

  append(chunk: string) {
    if (!chunk) return;
    this.pending += chunk;
    const usableLen = this.pending.length - (this.pending.length % 4);
    if (usableLen >= 65536) {
      const slice = this.pending.slice(0, usableLen);
      this.pending = this.pending.slice(usableLen);
      this.decodeSlice(slice);
    }
  }

  private decodeSlice(slice: string) {
    if (!slice) return;
    const binary = atob(slice);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    this.parts.push(bytes);
  }

  build(): Blob {
    if (this.pending.length > 0) {
      this.decodeSlice(this.pending);
      this.pending = '';
    }
    const blob = new Blob(this.parts, { type: this.mimeType });
    this.parts = [];
    return blob;
  }
}

export async function getBackupLocalInventory(): Promise<BackupLocalInventory> {
  const [
    tracks,
    playlists,
    mvMetas,
    pendingMvs,
    stemMetas,
    aiTasks,
    providerResp,
    stemServiceResp,
  ] = await Promise.all([
    getAllTracks(),
    getAllPlaylists(),
    getAllMvMetas(),
    loadPendingMvTimelines(),
    getAllStemMetas(),
    getAllAiTasks(),
    fetchProviders().catch(() => ({
      defaultProviderId: null,
      providers: [] as AiProviderConfig[],
    })),
    fetchStemServices().catch(() => ({
      activeStemServiceId: null,
      services: [] as StemServiceConfig[],
    })),
  ]);

  let tracksAudioBytes = 0;
  let tracksAudioCount = 0;
  for (const t of tracks) {
    if (t.fileSize && t.fileSize > 0) {
      tracksAudioBytes += t.fileSize;
      tracksAudioCount++;
    }
  }

  let mvVideosBytes = 0;
  let mvVideosCount = 0;
  for (const mv of mvMetas) {
    if (mv.sourceType === 'local' && mv.fileSizeBytes > 0) {
      mvVideosBytes += mv.fileSizeBytes;
      mvVideosCount++;
    }
  }

  let stemsBytes = 0;
  for (const st of stemMetas) {
    stemsBytes += (st.vocalSizeBytes || 0) + (st.instrumentalSizeBytes || 0);
  }

  return {
    tracksMetaCount: tracks.length,
    tracksAudioCount,
    tracksAudioBytes,
    playlistsCount: playlists.length,
    mvTimelinesCount: mvMetas.length + pendingMvs.length,
    activeMvRecordsCount: mvMetas.length,
    pendingMvTimelinesCount: pendingMvs.length,
    mvVideosCount,
    mvVideosBytes,
    stemsCount: stemMetas.length,
    stemsBytes,
    aiTasksCount: aiTasks.length,
    aiProvidersCount: providerResp.providers?.length || 0,
    stemServicesCount: stemServiceResp.services?.length || 0,
  };
}

async function gatherExportContext(
  options: BackupSelectionOptions
): Promise<ExportContextData> {
  const needTracks = options.includeTracksMeta || options.includeTrackAudio;
  const [
    tracks,
    playlists,
    stemMetas,
    mvMetas,
    pendingMvTimelines,
    aiTasks,
    audioSettings,
    personalization,
    playbackPrefs,
    providerResp,
    stemServiceResp,
  ] = await Promise.all([
    needTracks || options.includeMvTimelines || options.includeStems
      ? getAllTracks()
      : Promise.resolve([] as TrackMetadata[]),
    options.includePlaylists ? getAllPlaylists() : Promise.resolve([] as Playlist[]),
    options.includeStems ? getAllStemMetas() : Promise.resolve([]),
    options.includeMvTimelines || options.includeMvVideos
      ? getAllMvMetas()
      : Promise.resolve([] as TrackMvMeta[]),
    options.includeMvTimelines
      ? loadPendingMvTimelines()
      : Promise.resolve([] as PendingMvTimelineRecord[]),
    options.includeAiData ? getAllAiTasks() : Promise.resolve([] as AiTaskRecord[]),
    options.includeAudioSettings ? loadAudioSettings() : Promise.resolve(undefined),
    options.includePersonalization ? loadPersonalization() : Promise.resolve(undefined),
    options.includePersonalization ? loadPlaybackPrefs() : Promise.resolve(undefined),
    options.includeAiData
      ? fetchProviders().catch(() => ({
          defaultProviderId: null,
          providers: [] as AiProviderConfig[],
        }))
      : Promise.resolve({
          defaultProviderId: null,
          providers: [] as AiProviderConfig[],
        }),
    options.includeAiData
      ? fetchStemServices().catch(() => ({
          activeStemServiceId: null,
          services: [] as StemServiceConfig[],
        }))
      : Promise.resolve({
          activeStemServiceId: null,
          services: [] as StemServiceConfig[],
        }),
  ]);

  const trackById = new Map<string, TrackMetadata>();
  for (const t of tracks) {
    trackById.set(t.id, t);
  }

  const safeProviders = (providerResp.providers || []).map(
    ({ hasKey: _ignored, ...rest }) => rest
  );
  const safeStemServices = (stemServiceResp.services || []).map(
    ({ hasKey: _ignored, ...rest }) => rest
  );

  const tracksToExport = needTracks ? tracks : [];
  const mvsToExport =
    options.includeMvTimelines || options.includeMvVideos ? mvMetas : [];
  const pendingToExport = options.includeMvTimelines ? pendingMvTimelines : [];

  let estimatedBinaryBytes = 0;
  if (options.includeTrackAudio) {
    for (const t of tracksToExport) estimatedBinaryBytes += t.fileSize || 0;
  }
  if (options.includeMvVideos) {
    for (const m of mvsToExport) {
      if (m.sourceType === 'local') estimatedBinaryBytes += m.fileSizeBytes || 0;
    }
  }
  if (options.includeStems) {
    for (const s of stemMetas) {
      estimatedBinaryBytes += (s.vocalSizeBytes || 0) + (s.instrumentalSizeBytes || 0);
    }
  }

  const manifest: BackupManifestSummary = {
    tracksMetaCount: options.includeTracksMeta ? tracksToExport.length : 0,
    tracksAudioCount: options.includeTrackAudio
      ? tracksToExport.filter((t) => t.fileSize > 0).length
      : 0,
    playlistsCount: playlists.length,
    mvTimelinesCount: options.includeMvTimelines
      ? mvsToExport.length + pendingToExport.length
      : 0,
    mvVideosCount: options.includeMvVideos
      ? mvsToExport.filter((m) => m.sourceType === 'local' && m.fileSizeBytes > 0).length
      : 0,
    pendingMvTimelinesCount: pendingToExport.length,
    stemsCount: stemMetas.length,
    hasAudioSettings: Boolean(audioSettings),
    hasPersonalization: Boolean(personalization || playbackPrefs),
    aiTasksCount: aiTasks.length,
    aiProvidersCount: safeProviders.length,
    stemServicesCount: safeStemServices.length,
  };

  return {
    tracks: tracksToExport,
    trackById,
    playlists,
    stemMetas,
    mvMetas: mvsToExport,
    pendingMvTimelines: pendingToExport,
    aiTasks,
    audioSettings,
    personalization,
    playbackPrefs,
    aiConfigMetadata: {
      defaultProviderId: providerResp.defaultProviderId,
      providers: safeProviders,
      activeStemServiceId: stemServiceResp.activeStemServiceId,
      stemServices: safeStemServices,
    },
    manifest,
    estimatedBinaryBytes,
  };
}

function finalizeVolumeBlob(
  volumeManifest: BinaryVolumeManifest,
  payloadParts: BlobPart[]
): Blob {
  const headBytes = encodeUtf8(BINARY_MAGIC_HEAD);
  const manifestBytes = encodeUtf8(JSON.stringify(volumeManifest));
  const lenBuf = new ArrayBuffer(4);
  new DataView(lenBuf).setUint32(0, manifestBytes.byteLength, true);
  const tailMagic = encodeUtf8(BINARY_MAGIC_TAIL);
  return new Blob(
    [
      headBytes.buffer as ArrayBuffer,
      ...payloadParts,
      manifestBytes.buffer as ArrayBuffer,
      lenBuf,
      tailMagic.buffer as ArrayBuffer,
    ],
    { type: 'application/octet-stream' }
  );
}

async function streamBlobToWritable(
  writable: FileSystemWritableFileStreamLike,
  blob: Blob
): Promise<void> {
  const total = blob.size;
  for (let offset = 0; offset < total; offset += DISK_STREAM_WRITE_CHUNK_BYTES) {
    const end = Math.min(offset + DISK_STREAM_WRITE_CHUNK_BYTES, total);
    await writable.write(blob.slice(offset, end));
  }
}

/**
 * Direct disk streaming export via FileSystemFileHandle (0 Blob RAM overhead, supports >2GB-10GB single file).
 */
async function exportToDiskStreamLumina(
  fileHandle: FileSystemFileHandleLike,
  ctx: ExportContextData,
  options: BackupSelectionOptions,
  filename: string,
  onProgress?: (label: string) => void
): Promise<ExportBackupResult> {
  const writable = await fileHandle.createWritable();
  let totalPayloadWritten = 0;
  const archiveGroupId = makeArchiveGroupId();
  const exportedAt = Date.now();

  try {
    await writable.write(encodeUtf8(BINARY_MAGIC_HEAD));

    const manifestTracks: BinaryTrackEntry[] = [];
    for (let i = 0; i < ctx.tracks.length; i++) {
      const track = ctx.tracks[i];
      const audioBlob = options.includeTrackAudio
        ? await getAudioBlob(track.id)
        : undefined;
      let audioBlobRef: BinarySliceDescriptor | undefined;
      if (audioBlob && audioBlob.size > 0) {
        onProgress?.(
          `正在直写磁盘 · 曲目音频 (${i + 1}/${ctx.tracks.length}): ${track.title}`
        );
        const offset = totalPayloadWritten;
        await streamBlobToWritable(writable, audioBlob);
        totalPayloadWritten += audioBlob.size;
        audioBlobRef = {
          offset,
          size: audioBlob.size,
          totalSize: audioBlob.size,
          mimeType: audioBlob.type || track.mimeType || 'audio/wav',
          chunkIndex: 0,
          totalChunks: 1,
        };
      }
      if (options.includeTracksMeta || audioBlobRef) {
        manifestTracks.push({
          track,
          includeMeta: options.includeTracksMeta,
          audioBlobRef,
        });
      }
      await yieldToUi();
    }

    const manifestStems: BinaryStemEntry[] = [];
    if (options.includeStems) {
      for (let i = 0; i < ctx.stemMetas.length; i++) {
        const meta = ctx.stemMetas[i];
        const stemRec = await getTrackStems(meta.trackId);
        if (!stemRec) continue;
        const parent = ctx.trackById.get(meta.trackId);
        onProgress?.(
          `正在直写磁盘 · 分离音轨 (${i + 1}/${ctx.stemMetas.length}): ${
            parent?.title || meta.trackId
          }`
        );

        const vocalOffset = totalPayloadWritten;
        await streamBlobToWritable(writable, stemRec.vocalBlob);
        totalPayloadWritten += stemRec.vocalBlob.size;

        const instOffset = totalPayloadWritten;
        await streamBlobToWritable(writable, stemRec.instrumentalBlob);
        totalPayloadWritten += stemRec.instrumentalBlob.size;

        manifestStems.push({
          trackId: stemRec.trackId,
          trackTitle: parent?.title,
          trackArtist: parent?.artist,
          modelId: stemRec.modelId,
          modelName: stemRec.modelName,
          engineUsed: stemRec.engineUsed,
          duration: stemRec.duration,
          createdAt: stemRec.createdAt,
          vocalBlobRef: {
            offset: vocalOffset,
            size: stemRec.vocalBlob.size,
            totalSize: stemRec.vocalBlob.size,
            mimeType: stemRec.vocalBlob.type || 'audio/wav',
            chunkIndex: 0,
            totalChunks: 1,
          },
          instrumentalBlobRef: {
            offset: instOffset,
            size: stemRec.instrumentalBlob.size,
            totalSize: stemRec.instrumentalBlob.size,
            mimeType: stemRec.instrumentalBlob.type || 'audio/wav',
            chunkIndex: 0,
            totalChunks: 1,
          },
        });
        await yieldToUi();
      }
    }

    const manifestMvs: BinaryMvEntry[] = [];
    for (let i = 0; i < ctx.mvMetas.length; i++) {
      const mvMeta = ctx.mvMetas[i];
      const parent = ctx.trackById.get(mvMeta.trackId);
      const videoBlob =
        options.includeMvVideos && mvMeta.sourceType === 'local'
          ? await getMvBlobById(mvMeta.id)
          : undefined;
      let videoBlobRef: BinarySliceDescriptor | undefined;
      if (videoBlob && videoBlob.size > 0) {
        onProgress?.(
          `正在直写磁盘 · MV 视频 (${i + 1}/${ctx.mvMetas.length}): ${mvMeta.title}`
        );
        const offset = totalPayloadWritten;
        await streamBlobToWritable(writable, videoBlob);
        totalPayloadWritten += videoBlob.size;
        videoBlobRef = {
          offset,
          size: videoBlob.size,
          totalSize: videoBlob.size,
          mimeType: videoBlob.type || mvMeta.mimeType || 'video/mp4',
          chunkIndex: 0,
          totalChunks: 1,
        };
      }
      if (options.includeMvTimelines || videoBlobRef) {
        manifestMvs.push({
          meta: mvMeta,
          trackTitle: parent?.title,
          trackArtist: parent?.artist,
          videoBlobRef,
        });
      }
      await yieldToUi();
    }

    onProgress?.('正在写入档案索引校验尾...');
    const volumeManifest: BinaryVolumeManifest = {
      format: 'lumina-music-backup',
      version: 4,
      container: 'binary-store-v4',
      exportedAt,
      archiveGroupId,
      volumeIndex: 1,
      volumeCount: 1,
      selection: options,
      manifest: ctx.manifest,
      tracks: manifestTracks,
      playlists: ctx.playlists,
      stems: manifestStems,
      mvs: manifestMvs,
      pendingMvTimelines: ctx.pendingMvTimelines,
      aiTasks: ctx.aiTasks,
      settings: {
        ...(ctx.audioSettings ? { audioSettings: ctx.audioSettings } : {}),
        ...(ctx.personalization ? { personalization: ctx.personalization } : {}),
        ...(ctx.playbackPrefs ? { playbackPrefs: ctx.playbackPrefs } : {}),
      },
      aiConfigMetadata: ctx.aiConfigMetadata,
    };

    const manifestBytes = encodeUtf8(JSON.stringify(volumeManifest));
    const lenBuf = new ArrayBuffer(4);
    new DataView(lenBuf).setUint32(0, manifestBytes.byteLength, true);
    const tailBytes = encodeUtf8(BINARY_MAGIC_TAIL);

    await writable.write(manifestBytes);
    await writable.write(new Uint8Array(lenBuf));
    await writable.write(tailBytes);
    await writable.close();

    const finalBytes =
      8 + totalPayloadWritten + manifestBytes.byteLength + 4 + 8;

    return {
      volumes: [
        {
          index: 1,
          total: 1,
          filename: fileHandle.name || filename,
          sizeBytes: finalBytes,
          writtenToDisk: true,
          summary: '已通过流式通道完整直写到本地磁盘文件',
        },
      ],
      manifest: ctx.manifest,
      totalBytes: finalBytes,
      formatUsed: 'lumina-binary',
      usedFileSystemStream: true,
    };
  } catch (err) {
    try {
      await writable.abort?.();
    } catch {
      // ignore abort error
    }
    throw err;
  }
}

/**
 * Zero-copy `.lumina` Blob builder with automatic volume sharding (default 350MiB max per volume).
 * IndexedDB Blobs are referenced via Blob.slice without entering JS heap.
 */
async function exportZeroCopyBinaryVolumes(
  ctx: ExportContextData,
  options: BackupSelectionOptions,
  stamp: string,
  maxBytesPerVolume: number,
  onProgress?: (label: string) => void
): Promise<ExportBackupResult> {
  const archiveGroupId = makeArchiveGroupId();
  const exportedAt = Date.now();

  interface SealedDraft {
    payloadParts: BlobPart[];
    manifest: BinaryVolumeManifest;
    sizeEstimate: number;
  }

  const drafts: SealedDraft[] = [];

  const createEmptyDraft = (isFirst: boolean): SealedDraft => ({
    payloadParts: [],
    sizeEstimate: 0,
    manifest: {
      format: 'lumina-music-backup',
      version: 4,
      container: 'binary-store-v4',
      exportedAt,
      archiveGroupId,
      volumeIndex: drafts.length + 1,
      volumeCount: 1,
      selection: options,
      manifest: ctx.manifest,
      tracks: [],
      playlists: isFirst ? ctx.playlists : [],
      stems: [],
      mvs: [],
      pendingMvTimelines: isFirst ? ctx.pendingMvTimelines : [],
      aiTasks: isFirst ? ctx.aiTasks : [],
      settings: isFirst
        ? {
            ...(ctx.audioSettings ? { audioSettings: ctx.audioSettings } : {}),
            ...(ctx.personalization ? { personalization: ctx.personalization } : {}),
            ...(ctx.playbackPrefs ? { playbackPrefs: ctx.playbackPrefs } : {}),
          }
        : undefined,
      aiConfigMetadata: isFirst ? ctx.aiConfigMetadata : undefined,
    },
  });

  let current = createEmptyDraft(true);

  const rotateVolume = () => {
    if (
      current.sizeEstimate > 0 ||
      current.manifest.tracks.length > 0 ||
      current.manifest.mvs.length > 0 ||
      current.manifest.stems.length > 0 ||
      drafts.length === 0
    ) {
      drafts.push(current);
    }
    current = createEmptyDraft(false);
  };

  // Helper to write a Blob either whole or cleanly sliced across volumes
  const appendBlobAcrossVolumes = (
    blob: Blob,
    mimeType: string,
    onSlicePlaced: (targetManifest: BinaryVolumeManifest, desc: BinarySliceDescriptor) => void
  ) => {
    const totalSize = blob.size;
    if (totalSize === 0) return;

    // If blob fits in a clean volume (< maxVolume) and wouldn't fit remaining space, start a new volume cleanly
    if (
      totalSize <= maxBytesPerVolume &&
      current.sizeEstimate > 0 &&
      current.sizeEstimate + totalSize > maxBytesPerVolume
    ) {
      rotateVolume();
    }

    if (totalSize <= maxBytesPerVolume - current.sizeEstimate || maxBytesPerVolume === Infinity) {
      const offset = current.sizeEstimate;
      current.payloadParts.push(blob);
      current.sizeEstimate += totalSize;
      onSlicePlaced(current.manifest, {
        offset,
        size: totalSize,
        totalSize,
        mimeType,
        chunkIndex: 0,
        totalChunks: 1,
      });
      return;
    }

    // Large single blob (> maxBytesPerVolume): compute exact chunk boundaries first
    const slicePlan: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    // Start a fresh volume if less than 24 MiB left in current volume
    if (current.sizeEstimate > 0 && maxBytesPerVolume - current.sizeEstimate < 24 * 1024 * 1024) {
      rotateVolume();
    }
    let firstAvail = maxBytesPerVolume - current.sizeEstimate;
    if (firstAvail <= 0) firstAvail = maxBytesPerVolume;

    const firstTake = Math.min(totalSize, firstAvail);
    slicePlan.push({ start: 0, end: firstTake });
    cursor = firstTake;
    while (cursor < totalSize) {
      const nextEnd = Math.min(totalSize, cursor + maxBytesPerVolume);
      slicePlan.push({ start: cursor, end: nextEnd });
      cursor = nextEnd;
    }

    const totalChunks = slicePlan.length;
    for (let c = 0; c < totalChunks; c++) {
      const { start, end } = slicePlan[c];
      const sliceLen = end - start;
      if (current.sizeEstimate > 0 && current.sizeEstimate + sliceLen > maxBytesPerVolume) {
        rotateVolume();
      }
      const offset = current.sizeEstimate;
      current.payloadParts.push(blob.slice(start, end, mimeType));
      current.sizeEstimate += sliceLen;
      onSlicePlaced(current.manifest, {
        offset,
        size: sliceLen,
        totalSize,
        mimeType,
        chunkIndex: c,
        totalChunks,
      });
      if (c < totalChunks - 1) {
        rotateVolume();
      }
    }
  };

  // 1. Pack tracks (metadata + sequential audio blob lookup)
  for (let i = 0; i < ctx.tracks.length; i++) {
    const track = ctx.tracks[i];
    const audioBlob = options.includeTrackAudio
      ? await getAudioBlob(track.id)
      : undefined;

    if (audioBlob && audioBlob.size > 0) {
      onProgress?.(`正在零拷贝打包曲目 (${i + 1}/${ctx.tracks.length}): ${track.title}`);
      const mime = audioBlob.type || track.mimeType || 'audio/wav';
      appendBlobAcrossVolumes(audioBlob, mime, (targetManifest, desc) => {
        targetManifest.tracks.push({
          track,
          includeMeta: options.includeTracksMeta && desc.chunkIndex === 0,
          audioBlobRef: desc,
        });
      });
    } else if (options.includeTracksMeta) {
      current.manifest.tracks.push({ track, includeMeta: true });
    }
    if (i % 6 === 0) await yieldToUi();
  }

  // 2. Pack AI stems sequentially (never load all stems at once)
  if (options.includeStems) {
    for (let i = 0; i < ctx.stemMetas.length; i++) {
      const meta = ctx.stemMetas[i];
      const stemRec = await getTrackStems(meta.trackId);
      if (!stemRec) continue;
      const parent = ctx.trackById.get(meta.trackId);
      onProgress?.(
        `正在打包分离音轨 (${i + 1}/${ctx.stemMetas.length}): ${
          parent?.title || meta.trackId
        }`
      );

      if (stemRec.vocalBlob && stemRec.vocalBlob.size > 0) {
        appendBlobAcrossVolumes(
          stemRec.vocalBlob,
          stemRec.vocalBlob.type || 'audio/wav',
          (targetManifest, desc) => {
            targetManifest.stems.push({
              trackId: stemRec.trackId,
              trackTitle: parent?.title,
              trackArtist: parent?.artist,
              modelId: stemRec.modelId,
              modelName: stemRec.modelName,
              engineUsed: stemRec.engineUsed,
              duration: stemRec.duration,
              createdAt: stemRec.createdAt,
              vocalBlobRef: desc,
            });
          }
        );
      }

      if (stemRec.instrumentalBlob && stemRec.instrumentalBlob.size > 0) {
        appendBlobAcrossVolumes(
          stemRec.instrumentalBlob,
          stemRec.instrumentalBlob.type || 'audio/wav',
          (targetManifest, desc) => {
            targetManifest.stems.push({
              trackId: stemRec.trackId,
              trackTitle: parent?.title,
              trackArtist: parent?.artist,
              modelId: stemRec.modelId,
              modelName: stemRec.modelName,
              engineUsed: stemRec.engineUsed,
              duration: stemRec.duration,
              createdAt: stemRec.createdAt,
              instrumentalBlobRef: desc,
            });
          }
        );
      }
      await yieldToUi();
    }
  }

  // 3. Pack MVs sequentially via single-blob lookup (never call getAllMvRecords!)
  for (let i = 0; i < ctx.mvMetas.length; i++) {
    const mvMeta = ctx.mvMetas[i];
    const parent = ctx.trackById.get(mvMeta.trackId);
    const videoBlob =
      options.includeMvVideos && mvMeta.sourceType === 'local'
        ? await getMvBlobById(mvMeta.id)
        : undefined;

    if (videoBlob && videoBlob.size > 0) {
      onProgress?.(`正在零拷贝打包 MV (${i + 1}/${ctx.mvMetas.length}): ${mvMeta.title}`);
      const mime = videoBlob.type || mvMeta.mimeType || 'video/mp4';
      appendBlobAcrossVolumes(videoBlob, mime, (targetManifest, desc) => {
        targetManifest.mvs.push({
          meta: mvMeta,
          trackTitle: parent?.title,
          trackArtist: parent?.artist,
          videoBlobRef: desc,
        });
      });
    } else if (options.includeMvTimelines) {
      current.manifest.mvs.push({
        meta: mvMeta,
        trackTitle: parent?.title,
        trackArtist: parent?.artist,
      });
    }
    await yieldToUi();
  }

  // Flush final draft
  drafts.push(current);

  const totalVolumes = drafts.length;
  const volumes: ExportedBackupVolume[] = [];
  let totalBytes = 0;

  for (let i = 0; i < totalVolumes; i++) {
    const draft = drafts[i];
    draft.manifest.volumeIndex = i + 1;
    draft.manifest.volumeCount = totalVolumes;
    onProgress?.(`正在封装档案 (${i + 1}/${totalVolumes})...`);
    const blob = finalizeVolumeBlob(draft.manifest, draft.payloadParts);
    draft.payloadParts = []; // release slice array immediately
    totalBytes += blob.size;

    const summaryParts: string[] = [];
    if (i === 0 && draft.manifest.playlists.length > 0) summaryParts.push('歌单/设置');
    const uniqueTracks = new Set(draft.manifest.tracks.map((t) => t.track.id)).size;
    if (uniqueTracks > 0) summaryParts.push(`${uniqueTracks} 首曲目`);
    const uniqueMvs = new Set(draft.manifest.mvs.map((m) => m.meta.id)).size;
    if (uniqueMvs > 0) summaryParts.push(`${uniqueMvs} 部 MV`);
    if (draft.manifest.stems.length > 0) summaryParts.push('分离音轨');

    const filename =
      totalVolumes === 1
        ? `lumina-music-backup-${stamp}.lumina`
        : `lumina-music-backup-${stamp}.part${i + 1}-of-${totalVolumes}.lumina`;

    volumes.push({
      index: i + 1,
      total: totalVolumes,
      filename,
      sizeBytes: blob.size,
      blob,
      summary: summaryParts.join(' · ') || '配置与预设数据',
    });
    await yieldToUi();
  }

  return {
    volumes,
    manifest: ctx.manifest,
    totalBytes,
    formatUsed: 'lumina-binary',
    usedFileSystemStream: false,
  };
}

/**
 * Lightweight JSON exporter for config-only or small (<20MiB) backups.
 */
async function exportLightweightJson(
  ctx: ExportContextData,
  options: BackupSelectionOptions,
  stamp: string,
  onProgress?: (label: string) => void
): Promise<ExportBackupResult> {
  const parts: BlobPart[] = [];
  parts.push('{');
  parts.push(`"format":"lumina-music-backup",`);
  parts.push(`"version":3,`);
  parts.push(`"exportedAt":${Date.now()},`);
  parts.push(`"selection":${JSON.stringify(options)},`);
  parts.push(`"manifest":${JSON.stringify(ctx.manifest)},`);
  parts.push(`"playlists":${JSON.stringify(ctx.playlists)},`);
  parts.push(`"pendingMvTimelines":${JSON.stringify(ctx.pendingMvTimelines)},`);
  parts.push(`"aiTasks":${JSON.stringify(ctx.aiTasks)},`);
  parts.push(
    `"settings":${JSON.stringify({
      ...(ctx.audioSettings ? { audioSettings: ctx.audioSettings } : {}),
      ...(ctx.personalization ? { personalization: ctx.personalization } : {}),
      ...(ctx.playbackPrefs ? { playbackPrefs: ctx.playbackPrefs } : {}),
    })},`
  );
  parts.push(`"aiConfigMetadata":${JSON.stringify(ctx.aiConfigMetadata)},`);

  parts.push(`"tracks":[`);
  let writtenTracks = 0;
  for (let i = 0; i < ctx.tracks.length; i++) {
    const track = ctx.tracks[i];
    if (!options.includeTracksMeta && !options.includeTrackAudio) continue;
    const blob = options.includeTrackAudio ? await getAudioBlob(track.id) : undefined;
    if (writtenTracks > 0) parts.push(',');
    writtenTracks++;

    if (blob && blob.size > 0) {
      onProgress?.(`正在打包曲目音频 (${i + 1}/${ctx.tracks.length}): ${track.title}`);
      parts.push(`{"track":${JSON.stringify(track)},`);
      parts.push(`"audioMimeType":${JSON.stringify(blob.type || track.mimeType || 'audio/wav')},`);
      parts.push(`"audioBase64":`);
      await appendBlobAsJsonBase64Parts(blob, parts);
      parts.push('}');
    } else {
      parts.push(`{"track":${JSON.stringify(track)}}`);
    }
  }
  parts.push('],');

  parts.push(`"stems":[`);
  if (options.includeStems) {
    for (let i = 0; i < ctx.stemMetas.length; i++) {
      const meta = ctx.stemMetas[i];
      const stem = await getTrackStems(meta.trackId);
      if (!stem) continue;
      if (i > 0) parts.push(',');
      const parentTrack = ctx.trackById.get(stem.trackId);
      parts.push('{');
      parts.push(`"trackId":${JSON.stringify(stem.trackId)},`);
      if (parentTrack) {
        parts.push(`"trackTitle":${JSON.stringify(parentTrack.title)},`);
        parts.push(`"trackArtist":${JSON.stringify(parentTrack.artist)},`);
      }
      parts.push(`"modelId":${JSON.stringify(stem.modelId)},`);
      parts.push(`"modelName":${JSON.stringify(stem.modelName)},`);
      parts.push(`"engineUsed":${JSON.stringify(stem.engineUsed)},`);
      parts.push(`"duration":${JSON.stringify(stem.duration)},`);
      parts.push(`"createdAt":${JSON.stringify(stem.createdAt)},`);
      parts.push(`"vocalBase64":`);
      await appendBlobAsJsonBase64Parts(stem.vocalBlob, parts);
      parts.push(`,"instrumentalBase64":`);
      await appendBlobAsJsonBase64Parts(stem.instrumentalBlob, parts);
      parts.push('}');
    }
  }
  parts.push('],');

  parts.push(`"mvs":[`);
  for (let i = 0; i < ctx.mvMetas.length; i++) {
    const meta = ctx.mvMetas[i];
    if (i > 0) parts.push(',');
    const parentTrack = ctx.trackById.get(meta.trackId);
    const videoBlob =
      options.includeMvVideos && meta.sourceType === 'local'
        ? await getMvBlobById(meta.id)
        : undefined;
    parts.push('{');
    parts.push(`"meta":${JSON.stringify(meta)},`);
    if (parentTrack) {
      parts.push(`"trackTitle":${JSON.stringify(parentTrack.title)},`);
      parts.push(`"trackArtist":${JSON.stringify(parentTrack.artist)},`);
    }
    if (videoBlob && videoBlob.size > 0) {
      parts.push(`"videoBase64":`);
      await appendBlobAsJsonBase64Parts(videoBlob, parts);
    } else {
      parts.push(`"videoBase64":null`);
    }
    parts.push('}');
  }
  parts.push(']');
  parts.push('}');

  const blob = new Blob(parts, { type: 'application/json' });
  const suffix =
    !options.includeTrackAudio && !options.includeMvVideos && !options.includeStems
      ? 'config'
      : 'light';
  const filename = `lumina-music-${suffix}-backup-${stamp}.json`;

  return {
    volumes: [
      {
        index: 1,
        total: 1,
        filename,
        sizeBytes: blob.size,
        blob,
        summary: '轻量 JSON 数据包（含设定与调整）',
      },
    ],
    manifest: ctx.manifest,
    totalBytes: blob.size,
    formatUsed: 'json',
    usedFileSystemStream: false,
  };
}

export async function exportLuminaBackup(
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  volumeOptions?: {
    mode?: ExportVolumeMode;
    maxVolumeBytes?: number;
    diskFileHandle?: FileSystemFileHandleLike | null;
  },
  onProgress?: (label: string) => void
): Promise<ExportBackupResult> {
  onProgress?.('正在统计本地曲库与调整清单...');
  const ctx = await gatherExportContext(options);
  const stamp = new Date().toISOString().slice(0, 10);
  const mode = volumeOptions?.mode || 'auto';

  const hasMediaBlobs =
    (options.includeTrackAudio && ctx.manifest.tracksAudioCount > 0) ||
    (options.includeMvVideos && ctx.manifest.mvVideosCount > 0) ||
    (options.includeStems && ctx.manifest.stemsCount > 0);

  // Small metadata / config-only exports remain lightweight readable JSON
  if (!hasMediaBlobs || ctx.estimatedBinaryBytes < BINARY_CONTAINER_THRESHOLD_BYTES) {
    if (mode !== 'single-stream') {
      return exportLightweightJson(ctx, options, stamp, onProgress);
    }
  }

  const suggestedBinaryName = `lumina-music-backup-${stamp}.lumina`;

  // Direct FileSystemWritableFileStream path for desktop (>2GB single-file zero-RAM export)
  if (volumeOptions?.diskFileHandle) {
    return exportToDiskStreamLumina(
      volumeOptions.diskFileHandle,
      ctx,
      options,
      suggestedBinaryName,
      onProgress
    );
  }

  const maxBytes =
    mode === 'single-blob'
      ? Number.POSITIVE_INFINITY
      : volumeOptions?.maxVolumeBytes || SAFE_BROWSER_VOLUME_BYTES;

  return exportZeroCopyBinaryVolumes(ctx, options, stamp, maxBytes, onProgress);
}

/**
 * Legacy helper kept compatible for small exports if called directly.
 */
export async function exportLuminaBackupBlob(
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  onProgress?: (label: string) => void
): Promise<{
  blob: Blob;
  filename: string;
  manifest: BackupManifestSummary;
}> {
  const res = await exportLuminaBackup(
    options,
    { mode: 'single-blob' },
    onProgress
  );
  const first = res.volumes[0];
  if (!first?.blob) {
    throw new Error('未能生成备份数据包');
  }
  return {
    blob: first.blob,
    filename: first.filename,
    manifest: res.manifest,
  };
}

// ==================== Reading Binary (.lumina v3/v4) & JSON (.json v2/v3) ====================

async function readBinaryContainerManifest(
  file: File
): Promise<{ manifest: BinaryVolumeManifest; payloadStartOffset: number }> {
  if (file.size < 16) {
    throw new Error('备份文件损坏或体积过小');
  }
  const headText = decodeUtf8(await file.slice(0, 8).arrayBuffer());

  if (headText === BINARY_MAGIC_HEAD) {
    // LMBAK004 footer format
    const footerBuf = await file.slice(file.size - 12, file.size).arrayBuffer();
    const tailText = decodeUtf8(footerBuf.slice(4, 12));
    if (tailText !== BINARY_MAGIC_TAIL) {
      throw new Error('该 .lumina 备份文件不完整或已损坏（缺少尾部校验标记）');
    }
    const manifestLen = new DataView(footerBuf).getUint32(0, true);
    const manifestStart = file.size - 12 - manifestLen;
    if (manifestStart < 8 || manifestLen === 0) {
      throw new Error('该 .lumina 备份文件索引长度异常');
    }
    const manifestBuf = await file.slice(manifestStart, file.size - 12).arrayBuffer();
    const manifest = JSON.parse(decodeUtf8(manifestBuf)) as BinaryVolumeManifest;
    return { manifest, payloadStartOffset: 8 };
  }

  if (headText === LEGACY_BINARY_MAGIC_HEAD) {
    // LMBAK003 header format fallback
    const lenBuf = await file.slice(8, 12).arrayBuffer();
    const manifestLen = new DataView(lenBuf).getUint32(0, true);
    const manifestBuf = await file.slice(12, 12 + manifestLen).arrayBuffer();
    const manifest = JSON.parse(decodeUtf8(manifestBuf)) as BinaryVolumeManifest;
    return { manifest, payloadStartOffset: 12 + manifestLen };
  }

  throw new Error('未知的二进制备份容器标识');
}

async function streamScanLuminaBackupFile(
  file: File,
  callbacks: {
    stopAfterHeader?: boolean;
    onHeaderField?: (key: string, value: unknown) => void;
    onTrack?: (item: ParsedTrackItem) => Promise<void> | void;
    onStem?: (item: ParsedStemItem) => Promise<void> | void;
    onMv?: (item: ParsedMvItem) => Promise<void> | void;
  }
): Promise<{ format?: string; version?: number; exportedAt?: number; manifest?: BackupManifestSummary }> {
  const decoder = new TextDecoder('utf-8');
  let offset = 0;
  let chunk = '';
  let pos = 0;
  let eof = false;

  const ensure = async (minChars = 1): Promise<boolean> => {
    while (chunk.length - pos < minChars && !eof) {
      const nextEnd = Math.min(file.size, offset + STREAM_READ_CHUNK_BYTES);
      if (nextEnd <= offset) {
        eof = true;
        chunk = chunk.slice(pos) + decoder.decode();
        pos = 0;
        break;
      }
      const buf = await file.slice(offset, nextEnd).arrayBuffer();
      offset = nextEnd;
      const decoded = decoder.decode(new Uint8Array(buf), { stream: offset < file.size });
      chunk = chunk.slice(pos) + decoded;
      pos = 0;
      if (offset >= file.size) {
        eof = true;
        chunk += decoder.decode();
      }
    }
    return pos < chunk.length;
  };

  const peekChar = async (): Promise<string | null> => {
    while (true) {
      if (pos >= chunk.length) {
        const ok = await ensure(1);
        if (!ok) return null;
      }
      const ch = chunk[pos];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        pos++;
      } else {
        return ch;
      }
    }
  };

  const readJsonString = async (): Promise<string> => {
    const startCh = await peekChar();
    if (startCh !== '"') {
      throw new Error('备份文件 JSON 字符串格式错误');
    }
    pos++;
    let out = '';
    while (true) {
      if (pos >= chunk.length) {
        const ok = await ensure(1);
        if (!ok) throw new Error('备份文件意外截断');
      }
      const quoteIdx = chunk.indexOf('"', pos);
      const slashIdx = chunk.indexOf('\\', pos);
      if (quoteIdx === -1 && slashIdx === -1) {
        out += chunk.slice(pos);
        pos = chunk.length;
        continue;
      }
      if (slashIdx !== -1 && (quoteIdx === -1 || slashIdx < quoteIdx)) {
        out += chunk.slice(pos, slashIdx);
        pos = slashIdx + 1;
        await ensure(1);
        const esc = chunk[pos];
        pos++;
        if (esc === '"' || esc === '\\' || esc === '/') out += esc;
        else if (esc === 'b') out += '\b';
        else if (esc === 'f') out += '\f';
        else if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          await ensure(4);
          const hex = chunk.slice(pos, pos + 4);
          pos += 4;
          out += String.fromCharCode(parseInt(hex, 16));
        } else {
          out += esc;
        }
        continue;
      }
      if (quoteIdx !== -1) {
        out += chunk.slice(pos, quoteIdx);
        pos = quoteIdx + 1;
        return out;
      }
    }
  };

  const streamBase64StringToBlob = async (mimeType: string): Promise<Blob | undefined> => {
    const first = await peekChar();
    if (first === 'n') {
      await ensure(4);
      pos += 4;
      return undefined;
    }
    if (first !== '"') {
      throw new Error('备份文件 Base64 字段格式异常');
    }
    pos++;
    const builder = new StreamingBase64BlobBuilder(mimeType);
    while (true) {
      if (pos >= chunk.length) {
        const ok = await ensure(1);
        if (!ok) throw new Error('备份文件 Base64 数据截断');
      }
      const quoteIdx = chunk.indexOf('"', pos);
      if (quoteIdx === -1) {
        builder.append(chunk.slice(pos));
        pos = chunk.length;
      } else {
        builder.append(chunk.slice(pos, quoteIdx));
        pos = quoteIdx + 1;
        return builder.build();
      }
    }
  };

  const readSmallJsonValue = async (): Promise<unknown> => {
    const first = await peekChar();
    if (first === null) return undefined;
    if (first === '"') {
      return readJsonString();
    }
    if (first !== '{' && first !== '[') {
      let raw = '';
      while (true) {
        if (pos >= chunk.length) {
          const ok = await ensure(1);
          if (!ok) break;
        }
        const ch = chunk[pos];
        if (ch === ',' || ch === '}' || ch === ']' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
          break;
        }
        raw += ch;
        pos++;
      }
      return JSON.parse(raw);
    }

    let raw = '';
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (true) {
      if (pos >= chunk.length) {
        const ok = await ensure(1);
        if (!ok) throw new Error('备份文件 JSON 结构未闭合');
      }
      const ch = chunk[pos];
      pos++;
      raw += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) return JSON.parse(raw);
        }
      }
    }
  };

  const skipJsonValue = async (): Promise<void> => {
    const first = await peekChar();
    if (first === '"') {
      pos++;
      while (true) {
        if (pos >= chunk.length) {
          if (!(await ensure(1))) return;
        }
        const q = chunk.indexOf('"', pos);
        const s = chunk.indexOf('\\', pos);
        if (q === -1 && s === -1) {
          pos = chunk.length;
          continue;
        }
        if (s !== -1 && (q === -1 || s < q)) {
          pos = s + 2;
          continue;
        }
        pos = q + 1;
        return;
      }
    }
    if (first !== '{' && first !== '[') {
      while (true) {
        if (pos >= chunk.length) {
          if (!(await ensure(1))) return;
        }
        const ch = chunk[pos];
        if (ch === ',' || ch === '}' || ch === ']') return;
        pos++;
      }
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (true) {
      if (pos >= chunk.length) {
        if (!(await ensure(1))) return;
      }
      const ch = chunk[pos];
      pos++;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) return;
        }
      }
    }
  };

  const readStreamingMediaItem = async (
    kind: 'tracks' | 'stems' | 'mvs'
  ): Promise<Record<string, unknown>> => {
    const start = await peekChar();
    if (start !== '{') throw new Error('媒体条目格式错误');
    pos++;
    const record: Record<string, unknown> = {};
    while (true) {
      const ch = await peekChar();
      if (ch === '}') {
        pos++;
        return record;
      }
      if (ch === ',') {
        pos++;
        continue;
      }
      const key = await readJsonString();
      const colon = await peekChar();
      if (colon !== ':') throw new Error('JSON 缺少冒号');
      pos++;

      if (
        (kind === 'tracks' && key === 'audioBase64') ||
        (kind === 'stems' && (key === 'vocalBase64' || key === 'instrumentalBase64')) ||
        (kind === 'mvs' && key === 'videoBase64')
      ) {
        if (callbacks.stopAfterHeader) {
          await skipJsonValue();
        } else {
          const mime =
            kind === 'mvs'
              ? ((record.meta as TrackMvMeta | undefined)?.mimeType || 'video/mp4')
              : kind === 'tracks'
              ? (typeof record.audioMimeType === 'string' ? record.audioMimeType : 'audio/wav')
              : 'audio/wav';
          record[`__blob_${key}`] = await streamBase64StringToBlob(mime);
        }
      } else {
        record[key] = await readSmallJsonValue();
      }
    }
  };

  const summary: {
    format?: string;
    version?: number;
    exportedAt?: number;
    manifest?: BackupManifestSummary;
  } = {};

  const rootOpen = await peekChar();
  if (rootOpen !== '{') {
    throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 .lumina 或 .json 备份文件');
  }
  pos++;

  while (true) {
    const ch = await peekChar();
    if (ch === null || ch === '}') break;
    if (ch === ',') {
      pos++;
      continue;
    }

    const key = await readJsonString();
    const colon = await peekChar();
    if (colon !== ':') throw new Error('备份文件 JSON 结构异常');
    pos++;

    if (key === 'tracks' || key === 'stems' || key === 'mvs') {
      if (callbacks.stopAfterHeader && summary.manifest && summary.format === 'lumina-music-backup') {
        return summary;
      }
      const arrOpen = await peekChar();
      if (arrOpen !== '[') {
        await skipJsonValue();
        continue;
      }
      pos++;
      while (true) {
        const next = await peekChar();
        if (next === null || next === ']') {
          if (next === ']') pos++;
          break;
        }
        if (next === ',') {
          pos++;
          continue;
        }
        const item = await readStreamingMediaItem(key);
        if (key === 'tracks' && callbacks.onTrack && item.track) {
          const track = item.track as TrackMetadata;
          const rawBlob = item[`__blob_audioBase64`] as Blob | undefined;
          const audioMime =
            typeof item.audioMimeType === 'string'
              ? item.audioMimeType
              : track.mimeType || 'audio/wav';
          const fixedBlob =
            rawBlob && rawBlob.size > 0
              ? new Blob([rawBlob], { type: audioMime })
              : undefined;
          await callbacks.onTrack({ track, audioBlob: fixedBlob });
        } else if (key === 'stems' && callbacks.onStem && item.trackId) {
          await callbacks.onStem({
            trackId: String(item.trackId),
            trackTitle: typeof item.trackTitle === 'string' ? item.trackTitle : undefined,
            trackArtist: typeof item.trackArtist === 'string' ? item.trackArtist : undefined,
            modelId: String(item.modelId || ''),
            modelName: String(item.modelName || ''),
            engineUsed: (item.engineUsed as TrackStemsRecord['engineUsed']) || 'local-wasm',
            duration: Number(item.duration || 0),
            createdAt: Number(item.createdAt || Date.now()),
            vocalBlob: item[`__blob_vocalBase64`] as Blob | undefined,
            instrumentalBlob: item[`__blob_instrumentalBase64`] as Blob | undefined,
          });
        } else if (key === 'mvs' && callbacks.onMv && item.meta) {
          const meta = item.meta as TrackMvMeta;
          await callbacks.onMv({
            meta,
            trackTitle: typeof item.trackTitle === 'string' ? item.trackTitle : undefined,
            trackArtist: typeof item.trackArtist === 'string' ? item.trackArtist : undefined,
            videoBlob: item[`__blob_videoBase64`] as Blob | undefined,
          });
        }
      }
    } else {
      const val = await readSmallJsonValue();
      if (key === 'format') summary.format = typeof val === 'string' ? val : undefined;
      if (key === 'version') summary.version = typeof val === 'number' ? val : undefined;
      if (key === 'exportedAt') summary.exportedAt = typeof val === 'number' ? val : undefined;
      if (key === 'manifest') summary.manifest = val as BackupManifestSummary;
      callbacks.onHeaderField?.(key, val);
    }
  }

  return summary;
}

function buildManifestFromBundle(parsed: Partial<LuminaBackupBundle>): BackupManifestSummary {
  if (parsed.manifest) return parsed.manifest;
  const tracks = parsed.tracks || [];
  const mvs = parsed.mvs || [];
  const pending = parsed.pendingMvTimelines || [];
  return {
    tracksMetaCount: tracks.length,
    tracksAudioCount: tracks.filter((t) => Boolean(t?.audioBase64)).length,
    playlistsCount: (parsed.playlists || []).length,
    mvTimelinesCount: mvs.length + pending.length,
    mvVideosCount: mvs.filter((m) => Boolean(m?.videoBase64)).length,
    pendingMvTimelinesCount: pending.length,
    stemsCount: (parsed.stems || []).length,
    hasAudioSettings: Boolean(parsed.settings?.audioSettings),
    hasPersonalization: Boolean(
      parsed.settings?.personalization || parsed.settings?.playbackPrefs
    ),
    aiTasksCount: (parsed.aiTasks || []).length,
    aiProvidersCount: parsed.aiConfigMetadata?.providers?.length || 0,
    stemServicesCount: parsed.aiConfigMetadata?.stemServices?.length || 0,
  };
}

function deriveAvailableImportOptions(
  manifest: BackupManifestSummary
): BackupSelectionOptions {
  return {
    includeTracksMeta: manifest.tracksMetaCount > 0,
    includeTrackAudio: manifest.tracksAudioCount > 0,
    includePlaylists: manifest.playlistsCount > 0,
    includeMvTimelines: manifest.mvTimelinesCount > 0,
    includeMvVideos: manifest.mvVideosCount > 0,
    includeStems: manifest.stemsCount > 0,
    includeAudioSettings: manifest.hasAudioSettings,
    includePersonalization: manifest.hasPersonalization,
    includeAiData:
      manifest.aiTasksCount > 0 ||
      manifest.aiProvidersCount > 0 ||
      manifest.stemServicesCount > 0,
  };
}

export async function inspectLuminaBackupFile(
  file: File
): Promise<InspectedBackupFile> {
  if (file.size >= 16) {
    const headMagic = decodeUtf8(await file.slice(0, 8).arrayBuffer());
    if (headMagic === BINARY_MAGIC_HEAD || headMagic === LEGACY_BINARY_MAGIC_HEAD) {
      const { manifest: vol } = await readBinaryContainerManifest(file);
      if (vol.format !== 'lumina-music-backup') {
        throw new Error('无效的 .lumina 备份文件');
      }
      const volManifest: BackupManifestSummary = {
        tracksMetaCount: new Set(vol.tracks.filter((t) => t.includeMeta !== false).map((t) => t.track.id)).size,
        tracksAudioCount: new Set(vol.tracks.filter((t) => Boolean(t.audioBlobRef)).map((t) => t.track.id)).size,
        playlistsCount: vol.playlists.length,
        mvTimelinesCount:
          new Set(vol.mvs.map((m) => m.meta.id)).size + vol.pendingMvTimelines.length,
        mvVideosCount: new Set(vol.mvs.filter((m) => Boolean(m.videoBlobRef)).map((m) => m.meta.id)).size,
        pendingMvTimelinesCount: vol.pendingMvTimelines.length,
        stemsCount: new Set(vol.stems.map((s) => s.trackId)).size,
        hasAudioSettings: Boolean(vol.settings?.audioSettings),
        hasPersonalization: Boolean(vol.settings?.personalization || vol.settings?.playbackPrefs),
        aiTasksCount: vol.aiTasks.length,
        aiProvidersCount: vol.aiConfigMetadata?.providers?.length || 0,
        stemServicesCount: vol.aiConfigMetadata?.stemServices?.length || 0,
      };
      return {
        file,
        fileName: file.name,
        fileSizeBytes: file.size,
        container: 'lumina-binary',
        version: vol.version || 4,
        exportedAt: vol.exportedAt || null,
        volumeIndex: vol.volumeIndex,
        volumeCount: vol.volumeCount,
        archiveGroupId: vol.archiveGroupId,
        manifest: volManifest,
        availableOptions: deriveAvailableImportOptions(volManifest),
      };
    }
  }

  if (file.size <= LARGE_JSON_STREAM_THRESHOLD_BYTES) {
    const raw = await file.text();
    let parsed: Partial<LuminaBackupBundle>;
    try {
      parsed = JSON.parse(raw) as Partial<LuminaBackupBundle>;
    } catch {
      throw new Error('无效的备份文件格式，请选择 .lumina 或 .json 备份文件');
    }
    if (!parsed || parsed.format !== 'lumina-music-backup') {
      throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的备份文件');
    }
    const manifest = buildManifestFromBundle(parsed);
    return {
      file,
      fileName: file.name,
      fileSizeBytes: file.size,
      container: 'json',
      version: parsed.version || 2,
      exportedAt: parsed.exportedAt || null,
      manifest,
      availableOptions: deriveAvailableImportOptions(manifest),
    };
  }

  const collected: Partial<LuminaBackupBundle> = {};
  let trackCount = 0;
  let audioCount = 0;
  let stemCount = 0;
  let mvCount = 0;
  let mvVideoCount = 0;

  const header = await streamScanLuminaBackupFile(file, {
    stopAfterHeader: true,
    onHeaderField: (key, val) => {
      (collected as Record<string, unknown>)[key] = val;
    },
    onTrack: (item) => {
      trackCount++;
      if (item.track.fileSize > 0) audioCount++;
    },
    onStem: () => {
      stemCount++;
    },
    onMv: (item) => {
      mvCount++;
      if (item.meta.sourceType === 'local' && item.meta.fileSizeBytes > 0) mvVideoCount++;
    },
  });

  if (header.format !== 'lumina-music-backup') {
    throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的备份文件');
  }

  const manifest: BackupManifestSummary = header.manifest || {
    tracksMetaCount: trackCount,
    tracksAudioCount: audioCount,
    playlistsCount: (collected.playlists || []).length,
    mvTimelinesCount: mvCount + (collected.pendingMvTimelines || []).length,
    mvVideosCount: mvVideoCount,
    pendingMvTimelinesCount: (collected.pendingMvTimelines || []).length,
    stemsCount: stemCount,
    hasAudioSettings: Boolean(collected.settings?.audioSettings),
    hasPersonalization: Boolean(
      collected.settings?.personalization || collected.settings?.playbackPrefs
    ),
    aiTasksCount: (collected.aiTasks || []).length,
    aiProvidersCount: collected.aiConfigMetadata?.providers?.length || 0,
    stemServicesCount: collected.aiConfigMetadata?.stemServices?.length || 0,
  };

  return {
    file,
    fileName: file.name,
    fileSizeBytes: file.size,
    container: 'json',
    version: header.version || 3,
    exportedAt: header.exportedAt || null,
    manifest,
    availableOptions: deriveAvailableImportOptions(manifest),
  };
}

export async function inspectLuminaBackupFiles(
  files: File[]
): Promise<InspectedBackupBatch> {
  if (!files || files.length === 0) {
    throw new Error('未选择任何备份文件');
  }
  const items: InspectedBackupFile[] = [];
  for (const f of files) {
    items.push(await inspectLuminaBackupFile(f));
  }
  // Sort multi-volume files in ascending volumeIndex order
  items.sort((a, b) => (a.volumeIndex || 1) - (b.volumeIndex || 1));

  const combined: BackupManifestSummary = {
    tracksMetaCount: 0,
    tracksAudioCount: 0,
    playlistsCount: 0,
    mvTimelinesCount: 0,
    mvVideosCount: 0,
    pendingMvTimelinesCount: 0,
    stemsCount: 0,
    hasAudioSettings: false,
    hasPersonalization: false,
    aiTasksCount: 0,
    aiProvidersCount: 0,
    stemServicesCount: 0,
  };

  let totalSizeBytes = 0;
  for (const it of items) {
    totalSizeBytes += it.fileSizeBytes;
    combined.tracksMetaCount += it.manifest.tracksMetaCount;
    combined.tracksAudioCount += it.manifest.tracksAudioCount;
    combined.playlistsCount += it.manifest.playlistsCount;
    combined.mvTimelinesCount += it.manifest.mvTimelinesCount;
    combined.mvVideosCount += it.manifest.mvVideosCount;
    combined.pendingMvTimelinesCount += it.manifest.pendingMvTimelinesCount;
    combined.stemsCount += it.manifest.stemsCount;
    if (it.manifest.hasAudioSettings) combined.hasAudioSettings = true;
    if (it.manifest.hasPersonalization) combined.hasPersonalization = true;
    combined.aiTasksCount += it.manifest.aiTasksCount;
    combined.aiProvidersCount = Math.max(
      combined.aiProvidersCount,
      it.manifest.aiProvidersCount
    );
    combined.stemServicesCount = Math.max(
      combined.stemServicesCount,
      it.manifest.stemServicesCount
    );
  }

  let missingSplitChunksWarning: string | null = null;
  const binaryItems = items.filter((it) => it.container === 'lumina-binary');
  if (binaryItems.length > 0) {
    const groups = new Map<string, { expectedTotal: number; seen: Set<number> }>();
    for (const b of binaryItems) {
      if (b.volumeCount && b.volumeCount > 1 && b.archiveGroupId) {
        const g = groups.get(b.archiveGroupId) || {
          expectedTotal: b.volumeCount,
          seen: new Set<number>(),
        };
        if (b.volumeIndex) g.seen.add(b.volumeIndex);
        groups.set(b.archiveGroupId, g);
      }
    }
    for (const [, g] of groups) {
      if (g.seen.size < g.expectedTotal) {
        missingSplitChunksWarning = `检测到多卷备份（共 ${g.expectedTotal} 卷），当前已选 ${g.seen.size} 卷。若某个大体积 MV 跨越了未选中的分卷，请一次性全选全部 .part 文件以防缺失。`;
        break;
      }
    }
  }

  return {
    items,
    totalSizeBytes,
    exportedAt: items[0]?.exportedAt || null,
    manifest: combined,
    availableOptions: deriveAvailableImportOptions(combined),
    missingSplitChunksWarning,
  };
}

function findTrackMatch(
  existingTracks: TrackMetadata[],
  trackId?: string,
  title?: string,
  artist?: string,
  duration?: number,
  fileSize?: number
): TrackMetadata | undefined {
  if (trackId) {
    const byId = existingTracks.find((t) => t.id === trackId);
    if (byId) return byId;
  }
  const nTitle = normalizeStr(title);
  const nArtist = normalizeStr(artist);
  if (nTitle) {
    const exactTitleArtist = existingTracks.find(
      (t) =>
        normalizeStr(t.title) === nTitle &&
        (!nArtist || !t.artist || normalizeStr(t.artist) === nArtist)
    );
    if (exactTitleArtist) return exactTitleArtist;
  }
  if (duration && fileSize && fileSize > 0) {
    const bySig = existingTracks.find(
      (t) => Math.abs((t.duration || 0) - duration) < 1.0 && t.fileSize === fileSize
    );
    if (bySig) return bySig;
  }
  return undefined;
}

function findMatchingExistingMvMeta(
  existingMvMetas: TrackMvMeta[],
  meta: TrackMvMeta,
  resolvedTrackId?: string
): TrackMvMeta | undefined {
  const byId = existingMvMetas.find((m) => m.id === meta.id);
  if (byId && (byId.sourceType === 'url' || byId.fileSizeBytes > 0)) {
    return byId;
  }

  const nFile = normalizeStr(meta.fileName);
  const nTitle = normalizeStr(meta.title);

  if (resolvedTrackId) {
    const sameTrackMvs = existingMvMetas.filter(
      (m) =>
        m.trackId === resolvedTrackId &&
        (m.sourceType === 'url' || m.fileSizeBytes > 0)
    );
    if (sameTrackMvs.length > 0) {
      const exactFile = sameTrackMvs.find((m) => nFile && normalizeStr(m.fileName) === nFile);
      if (exactFile) return exactFile;
      const exactSize = sameTrackMvs.find(
        (m) => meta.fileSizeBytes > 0 && m.fileSizeBytes === meta.fileSizeBytes
      );
      if (exactSize) return exactSize;
      const exactTitle = sameTrackMvs.find((m) => nTitle && normalizeStr(m.title) === nTitle);
      if (exactTitle) return exactTitle;
      if (sameTrackMvs.length === 1) return sameTrackMvs[0];
    }
  }

  if (nFile && meta.fileSizeBytes > 0) {
    return existingMvMetas.find(
      (m) =>
        m.fileSizeBytes > 0 &&
        normalizeStr(m.fileName) === nFile &&
        m.fileSizeBytes === meta.fileSizeBytes
    );
  }
  return undefined;
}

async function syncAiConfigMetadataToServer(
  meta: LuminaBackupBundle['aiConfigMetadata']
): Promise<number> {
  if (!meta) return 0;
  let synced = 0;

  try {
    const existingResp = await fetchProviders();
    const existingProviders = existingResp.providers || [];
    const mappedProviderIds: Record<string, string> = {};

    for (const p of meta.providers || []) {
      const match = existingProviders.find(
        (ex) =>
          ex.id === p.id ||
          (ex.kind === p.kind && normalizeStr(ex.baseUrl) === normalizeStr(p.baseUrl))
      );
      const saved = await saveProvider({
        id: match ? match.id : p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        model: p.model,
        availableModels: p.availableModels,
        enabled: p.enabled,
        timeoutMs: p.timeoutMs,
        maxRequestsPerDay: p.maxRequestsPerDay,
        customHeadersJson: p.customHeadersJson,
        setAsDefault: meta.defaultProviderId === p.id,
      });
      mappedProviderIds[p.id] = saved.provider.id;
      synced++;
    }

    if (meta.defaultProviderId && mappedProviderIds[meta.defaultProviderId]) {
      await setDefaultProviderById(mappedProviderIds[meta.defaultProviderId]).catch(
        () => {}
      );
    }

    const existingStemResp = await fetchStemServices();
    const existingStems = existingStemResp.services || [];
    const mappedStemIds: Record<string, string> = {};

    for (const s of meta.stemServices || []) {
      const match = existingStems.find(
        (ex) =>
          ex.id === s.id ||
          (ex.kind === s.kind && normalizeStr(ex.baseUrl) === normalizeStr(s.baseUrl))
      );
      const saved = await saveStemService({
        id: match ? match.id : s.id,
        name: s.name,
        kind: s.kind,
        baseUrl: s.baseUrl,
        endpointPath: s.endpointPath,
        enabled: s.enabled,
        timeoutMs: s.timeoutMs,
        setActive: meta.activeStemServiceId === s.id,
      });
      mappedStemIds[s.id] = saved.service.id;
    }

    if (meta.activeStemServiceId && mappedStemIds[meta.activeStemServiceId]) {
      await setActiveStemServiceId(mappedStemIds[meta.activeStemServiceId]).catch(
        () => {}
      );
    }
  } catch {
    // Pure static deployments without /api backend ignore server vault sync silently
  }

  return synced;
}

export async function importLuminaBackupFiles(
  input: File[] | InspectedBackupBatch,
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  importMode: 'merge' | 'replace' = 'merge',
  onProgress?: (label: string) => void
): Promise<BackupImportSummary> {
  await requestPersistentStorage();

  const batch = Array.isArray(input)
    ? await inspectLuminaBackupFiles(input)
    : input;

  if (importMode === 'replace') {
    onProgress?.('正在清理所选类别的旧数据...');
    if (options.includeTracksMeta || options.includeTrackAudio) {
      await clearTracksStore();
    }
    if (options.includePlaylists) {
      await clearPlaylistsStore();
    }
    if (options.includeStems) {
      await clearStemsStore();
    }
    if (options.includeMvTimelines || options.includeMvVideos) {
      await clearAllMvs();
      await clearPendingMvTimelines();
    }
    if (options.includeAiData) {
      await clearAiTasks();
    }
  }

  const existingTracks = await getAllTracks();
  const existingPlaylists = await getAllPlaylists();
  const existingMvMetas = await getAllMvMetas();

  const idMap: Record<string, string> = {};
  const backupTrackById = new Map<string, TrackMetadata>();

  let tracksRestored = 0;
  let trackAudioRestored = 0;
  let playlistsRestored = 0;
  let stemsRestored = 0;
  let mvsRestored = 0;
  let mvVideosRestored = 0;
  let mvTimelinesMatchedExisting = 0;
  let pendingMvsStored = 0;
  let audioSettingsRestored = false;
  let personalizationRestored = false;
  let tasksNormalizedToResubmit = 0;
  let tasksRestored = 0;
  let aiProvidersSynced = 0;

  const pendingToUpsert: PendingMvTimelineRecord[] = [];
  const allPlaylistsData: Playlist[] = [];
  const allPendingData: PendingMvTimelineRecord[] = [];
  const allAiTasksData: AiTaskRecord[] = [];
  let settingsData: LuminaBackupBundle['settings'] | undefined;
  let aiConfigData: LuminaBackupBundle['aiConfigMetadata'] | undefined;

  // Cross-volume chunk reassembly buffers (holding zero-copy File.slice Blobs ONLY while incomplete)
  const pendingTrackChunks = new Map<
    string,
    { track: TrackMetadata; includeMeta: boolean; mimeType: string; totalChunks: number; parts: Array<Blob | undefined> }
  >();
  const pendingMvChunks = new Map<
    string,
    {
      meta: TrackMvMeta;
      trackTitle?: string;
      trackArtist?: string;
      mimeType: string;
      totalChunks: number;
      parts: Array<Blob | undefined>;
    }
  >();
  const pendingStemChunks = new Map<
    string,
    {
      entry: BinaryStemEntry;
      vocalParts: Array<Blob | undefined>;
      vocalTotal: number;
      instParts: Array<Blob | undefined>;
      instTotal: number;
    }
  >();

  const handleTrackItem = async (item: ParsedTrackItem) => {
    if (!item.track?.id) return;
    backupTrackById.set(item.track.id, item.track);
    if (!options.includeTracksMeta && !options.includeTrackAudio) return;

    const existing =
      importMode === 'merge'
        ? findTrackMatch(
            existingTracks,
            item.track.id,
            item.track.title,
            item.track.artist,
            item.track.duration,
            item.track.fileSize
          )
        : undefined;

    const targetId = existing ? existing.id : item.track.id;
    idMap[item.track.id] = targetId;

    if (options.includeTracksMeta) {
      const mergedTrack: TrackMetadata = existing
        ? {
            ...existing,
            ...item.track,
            id: targetId,
            lyricsRaw: item.track.lyricsRaw ?? existing.lyricsRaw,
            lyricsOffsetMs:
              typeof item.track.lyricsOffsetMs === 'number'
                ? item.track.lyricsOffsetMs
                : existing.lyricsOffsetMs,
            coverDataUrl: item.track.coverDataUrl || existing.coverDataUrl,
            favorite: item.track.favorite ?? existing.favorite,
          }
        : { ...item.track, id: targetId };

      const blobToSave =
        options.includeTrackAudio && item.audioBlob && item.audioBlob.size > 0
          ? item.audioBlob
          : undefined;

      await saveTrackWithBlob(mergedTrack, blobToSave);
      if (blobToSave) trackAudioRestored++;
      tracksRestored++;

      if (!existing) {
        existingTracks.push(mergedTrack);
      } else {
        const idx = existingTracks.findIndex((t) => t.id === existing.id);
        if (idx >= 0) existingTracks[idx] = mergedTrack;
      }
    } else if (options.includeTrackAudio && item.audioBlob && item.audioBlob.size > 0) {
      const trackToWrite = existing || item.track;
      await saveTrackWithBlob(trackToWrite, item.audioBlob);
      trackAudioRestored++;
      tracksRestored++;
      if (!existing) existingTracks.push(trackToWrite);
    }
  };

  const handleStemItem = async (item: ParsedStemItem) => {
    if (!options.includeStems) return;
    if (!item.vocalBlob || !item.instrumentalBlob) return;
    if (item.vocalBlob.size === 0 || item.instrumentalBlob.size === 0) return;

    const matchedTrack = findTrackMatch(
      existingTracks,
      idMap[item.trackId] || item.trackId,
      item.trackTitle,
      item.trackArtist
    );
    const resolvedTrackId = matchedTrack?.id || idMap[item.trackId] || item.trackId;

    await saveTrackStems({
      trackId: resolvedTrackId,
      modelId: item.modelId,
      modelName: item.modelName,
      engineUsed: item.engineUsed,
      duration: item.duration,
      createdAt: item.createdAt,
      vocalBlob: item.vocalBlob,
      instrumentalBlob: item.instrumentalBlob,
    });
    stemsRestored++;
  };

  const handleMvItem = async (item: ParsedMvItem) => {
    if (!options.includeMvTimelines && !options.includeMvVideos) return;
    const { meta, videoBlob } = item;
    if (!meta?.id) return;

    const backupTrack = backupTrackById.get(meta.trackId);
    const trackTitle = item.trackTitle || backupTrack?.title;
    const trackArtist = item.trackArtist || backupTrack?.artist;

    const matchedTrack = findTrackMatch(
      existingTracks,
      idMap[meta.trackId] || meta.trackId,
      trackTitle,
      trackArtist
    );
    const resolvedTrackId = matchedTrack?.id || idMap[meta.trackId] || meta.trackId;
    const hasVideoPayload = Boolean(
      options.includeMvVideos && videoBlob && videoBlob.size > 0
    );

    const existingMvMeta = findMatchingExistingMvMeta(
      existingMvMetas,
      meta,
      resolvedTrackId
    );

    if (hasVideoPayload && videoBlob) {
      const record: TrackMvRecord = {
        ...meta,
        trackId: resolvedTrackId,
        blurPx: options.includeMvTimelines
          ? meta.blurPx
          : existingMvMeta?.blurPx ?? meta.blurPx,
        opacityPct: options.includeMvTimelines
          ? meta.opacityPct
          : existingMvMeta?.opacityPct ?? meta.opacityPct,
        timeline: options.includeMvTimelines
          ? meta.timeline
          : existingMvMeta?.timeline ?? meta.timeline,
        videoBlob,
      };
      await saveTrackMv(record);
      const { videoBlob: _ignored, ...cleanMeta } = record;
      existingMvMetas.push(cleanMeta);
      mvsRestored++;
      mvVideosRestored++;
      return;
    }

    if (!options.includeMvTimelines) return;

    if (meta.sourceType === 'url' && meta.externalUrl && matchedTrack) {
      const urlRec: TrackMvRecord = {
        ...meta,
        trackId: matchedTrack.id,
      };
      await saveTrackMv(urlRec);
      existingMvMetas.push(urlRec);
      mvsRestored++;
      return;
    }

    if (existingMvMeta) {
      await updateMvRecordMeta(existingMvMeta.id, {
        blurPx: meta.blurPx,
        opacityPct: meta.opacityPct,
        timeline: meta.timeline,
      });
      mvTimelinesMatchedExisting++;
      mvsRestored++;
      return;
    }

    pendingToUpsert.push({
      id: meta.id,
      trackId: resolvedTrackId,
      trackTitle,
      trackArtist,
      mvTitle: meta.title || stripExt(meta.fileName) || trackTitle || 'MV 视频',
      fileName: meta.fileName || '',
      mimeType: meta.mimeType,
      fileSizeBytes: meta.fileSizeBytes,
      durationSec: meta.durationSec,
      blurPx: meta.blurPx ?? 14,
      opacityPct: meta.opacityPct ?? 48,
      timeline: meta.timeline,
      savedAt: Date.now(),
    });
  };

  for (let vIdx = 0; vIdx < batch.items.length; vIdx++) {
    const inspected = batch.items[vIdx];
    const file = inspected.file;

    if (inspected.container === 'lumina-binary') {
      const { manifest: vol, payloadStartOffset } =
        await readBinaryContainerManifest(file);

      if (vol.playlists?.length) allPlaylistsData.push(...vol.playlists);
      if (vol.pendingMvTimelines?.length)
        allPendingData.push(...vol.pendingMvTimelines);
      if (vol.aiTasks?.length) allAiTasksData.push(...vol.aiTasks);
      if (vol.settings && (!settingsData || Object.keys(vol.settings).length > 0)) {
        settingsData = { ...settingsData, ...vol.settings };
      }
      if (vol.aiConfigMetadata && !aiConfigData) {
        aiConfigData = vol.aiConfigMetadata;
      }

      // 1. Tracks
      for (let i = 0; i < vol.tracks.length; i++) {
        const entry = vol.tracks[i];
        backupTrackById.set(entry.track.id, entry.track);
        const ref = entry.audioBlobRef;
        if (!ref || !options.includeTrackAudio) {
          if (entry.includeMeta !== false) {
            await handleTrackItem({ track: entry.track });
          }
          continue;
        }
        onProgress?.(
          `[${vIdx + 1}/${batch.items.length}] 正在导入曲目 (${i + 1}/${vol.tracks.length}): ${entry.track.title}`
        );
        const sliceBlob = file.slice(
          payloadStartOffset + ref.offset,
          payloadStartOffset + ref.offset + ref.size,
          ref.mimeType
        );
        if (ref.totalChunks <= 1) {
          await handleTrackItem({ track: entry.track, audioBlob: sliceBlob });
        } else {
          const buf = pendingTrackChunks.get(entry.track.id) || {
            track: entry.track,
            includeMeta: entry.includeMeta !== false,
            mimeType: ref.mimeType,
            totalChunks: ref.totalChunks,
            parts: new Array<Blob | undefined>(ref.totalChunks).fill(undefined),
          };
          buf.parts[ref.chunkIndex] = sliceBlob;
          pendingTrackChunks.set(entry.track.id, buf);
          if (buf.parts.every(Boolean)) {
            const fullBlob = new Blob(buf.parts as Blob[], { type: buf.mimeType });
            pendingTrackChunks.delete(entry.track.id);
            await handleTrackItem({ track: buf.track, audioBlob: fullBlob });
          }
        }
        await yieldToUi();
      }

      // 2. Stems
      for (let i = 0; i < vol.stems.length; i++) {
        const st = vol.stems[i];
        if (!options.includeStems) continue;
        const buf = pendingStemChunks.get(st.trackId) || {
          entry: st,
          vocalParts: new Array<Blob | undefined>(
            st.vocalBlobRef?.totalChunks || 1
          ).fill(undefined),
          vocalTotal: st.vocalBlobRef?.totalChunks || 1,
          instParts: new Array<Blob | undefined>(
            st.instrumentalBlobRef?.totalChunks || 1
          ).fill(undefined),
          instTotal: st.instrumentalBlobRef?.totalChunks || 1,
        };
        if (st.vocalBlobRef) {
          const r = st.vocalBlobRef;
          if (buf.vocalParts.length !== r.totalChunks) {
            buf.vocalParts = new Array<Blob | undefined>(r.totalChunks).fill(undefined);
            buf.vocalTotal = r.totalChunks;
          }
          buf.vocalParts[r.chunkIndex] = file.slice(
            payloadStartOffset + r.offset,
            payloadStartOffset + r.offset + r.size,
            r.mimeType
          );
        }
        if (st.instrumentalBlobRef) {
          const r = st.instrumentalBlobRef;
          if (buf.instParts.length !== r.totalChunks) {
            buf.instParts = new Array<Blob | undefined>(r.totalChunks).fill(undefined);
            buf.instTotal = r.totalChunks;
          }
          buf.instParts[r.chunkIndex] = file.slice(
            payloadStartOffset + r.offset,
            payloadStartOffset + r.offset + r.size,
            r.mimeType
          );
        }
        pendingStemChunks.set(st.trackId, buf);
        if (
          buf.vocalParts.every(Boolean) &&
          buf.instParts.every(Boolean)
        ) {
          pendingStemChunks.delete(st.trackId);
          onProgress?.(
            `[${vIdx + 1}/${batch.items.length}] 正在导入分离音轨 (${buf.entry.trackTitle || st.trackId})`
          );
          await handleStemItem({
            trackId: buf.entry.trackId,
            trackTitle: buf.entry.trackTitle,
            trackArtist: buf.entry.trackArtist,
            modelId: buf.entry.modelId,
            modelName: buf.entry.modelName,
            engineUsed: buf.entry.engineUsed,
            duration: buf.entry.duration,
            createdAt: buf.entry.createdAt,
            vocalBlob: new Blob(buf.vocalParts as Blob[], { type: 'audio/wav' }),
            instrumentalBlob: new Blob(buf.instParts as Blob[], {
              type: 'audio/wav',
            }),
          });
          await yieldToUi();
        }
      }

      // 3. MVs
      for (let i = 0; i < vol.mvs.length; i++) {
        const mv = vol.mvs[i];
        const ref = mv.videoBlobRef;
        if (!ref || !options.includeMvVideos) {
          await handleMvItem({
            meta: mv.meta,
            trackTitle: mv.trackTitle,
            trackArtist: mv.trackArtist,
          });
          continue;
        }
        onProgress?.(
          `[${vIdx + 1}/${batch.items.length}] 正在导入 MV (${i + 1}/${vol.mvs.length}): ${mv.meta.title}`
        );
        const sliceBlob = file.slice(
          payloadStartOffset + ref.offset,
          payloadStartOffset + ref.offset + ref.size,
          ref.mimeType
        );
        if (ref.totalChunks <= 1) {
          await handleMvItem({
            meta: mv.meta,
            trackTitle: mv.trackTitle,
            trackArtist: mv.trackArtist,
            videoBlob: sliceBlob,
          });
        } else {
          const buf = pendingMvChunks.get(mv.meta.id) || {
            meta: mv.meta,
            trackTitle: mv.trackTitle,
            trackArtist: mv.trackArtist,
            mimeType: ref.mimeType,
            totalChunks: ref.totalChunks,
            parts: new Array<Blob | undefined>(ref.totalChunks).fill(undefined),
          };
          buf.parts[ref.chunkIndex] = sliceBlob;
          pendingMvChunks.set(mv.meta.id, buf);
          if (buf.parts.every(Boolean)) {
            const fullVideo = new Blob(buf.parts as Blob[], {
              type: buf.mimeType,
            });
            pendingMvChunks.delete(mv.meta.id);
            await handleMvItem({
              meta: buf.meta,
              trackTitle: buf.trackTitle,
              trackArtist: buf.trackArtist,
              videoBlob: fullVideo,
            });
          }
        }
        await yieldToUi();
      }
      continue;
    }

    // Legacy or lightweight JSON path
    if (file.size <= LARGE_JSON_STREAM_THRESHOLD_BYTES) {
      onProgress?.(`正在读取备份文件：${file.name}`);
      const rawJson = await file.text();
      const parsed = JSON.parse(rawJson) as Partial<LuminaBackupBundle>;
      if (!parsed || parsed.format !== 'lumina-music-backup') {
        throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的备份文件');
      }
      for (let i = 0; i < (parsed.tracks || []).length; i++) {
        const entry = parsed.tracks![i];
        if (!entry?.track?.id) continue;
        const blob =
          options.includeTrackAudio && entry.audioBase64
            ? base64ToBlob(
                entry.audioBase64,
                entry.audioMimeType || entry.track.mimeType || 'audio/wav'
              )
            : undefined;
        await handleTrackItem({ track: entry.track, audioBlob: blob });
      }
      for (let i = 0; i < (parsed.stems || []).length; i++) {
        const st = parsed.stems![i];
        if (!st?.trackId) continue;
        if (options.includeStems && st.vocalBase64 && st.instrumentalBase64) {
          await handleStemItem({
            trackId: st.trackId,
            trackTitle: st.trackTitle,
            trackArtist: st.trackArtist,
            modelId: st.modelId,
            modelName: st.modelName,
            engineUsed: st.engineUsed,
            duration: st.duration,
            createdAt: st.createdAt,
            vocalBlob: base64ToBlob(st.vocalBase64, 'audio/wav'),
            instrumentalBlob: base64ToBlob(st.instrumentalBase64, 'audio/wav'),
          });
        }
      }
      for (let i = 0; i < (parsed.mvs || []).length; i++) {
        const entry = parsed.mvs![i];
        if (!entry?.meta?.id) continue;
        const videoBlob =
          options.includeMvVideos && entry.videoBase64
            ? base64ToBlob(entry.videoBase64, entry.meta.mimeType || 'video/mp4')
            : undefined;
        await handleMvItem({
          meta: entry.meta,
          trackTitle: entry.trackTitle,
          trackArtist: entry.trackArtist,
          videoBlob,
        });
      }
      if (parsed.playlists?.length) allPlaylistsData.push(...parsed.playlists);
      if (parsed.pendingMvTimelines?.length)
        allPendingData.push(...parsed.pendingMvTimelines);
      if (parsed.aiTasks?.length) allAiTasksData.push(...parsed.aiTasks);
      if (parsed.settings) settingsData = { ...settingsData, ...parsed.settings };
      if (parsed.aiConfigMetadata) aiConfigData = parsed.aiConfigMetadata;
    } else {
      onProgress?.(`正在以流式低内存模式读取大型 JSON：${file.name}`);
      await streamScanLuminaBackupFile(file, {
        onHeaderField: (key, val) => {
          if (key === 'playlists' && Array.isArray(val))
            allPlaylistsData.push(...(val as Playlist[]));
          if (key === 'pendingMvTimelines' && Array.isArray(val))
            allPendingData.push(...(val as PendingMvTimelineRecord[]));
          if (key === 'aiTasks' && Array.isArray(val))
            allAiTasksData.push(...(val as AiTaskRecord[]));
          if (key === 'settings' && val && typeof val === 'object')
            settingsData = {
              ...settingsData,
              ...(val as LuminaBackupBundle['settings']),
            };
          if (key === 'aiConfigMetadata' && val && typeof val === 'object')
            aiConfigData = val as LuminaBackupBundle['aiConfigMetadata'];
        },
        onTrack: async (item) => {
          onProgress?.(`正在流式写入曲目：${item.track.title}`);
          await handleTrackItem(item);
        },
        onStem: async (item) => {
          await handleStemItem(item);
        },
        onMv: async (item) => {
          onProgress?.(`正在流式同步 MV：${item.meta.title}`);
          await handleMvItem(item);
        },
      });
    }
  }

  // Fallback for any split MVs whose user only selected timeline metadata or incomplete video chunks:
  // still preserve MV timeline metadata as pending preset!
  if (options.includeMvTimelines) {
    for (const [, incompleteMv] of pendingMvChunks) {
      await handleMvItem({
        meta: incompleteMv.meta,
        trackTitle: incompleteMv.trackTitle,
        trackArtist: incompleteMv.trackArtist,
      });
    }
  }
  if (options.includeTracksMeta) {
    for (const [, incompleteTrack] of pendingTrackChunks) {
      if (incompleteTrack.includeMeta) {
        await handleTrackItem({ track: incompleteTrack.track });
      }
    }
  }

  // Check carried pendingMvTimelines against existing/imported MVs
  if (options.includeMvTimelines && allPendingData.length > 0) {
    for (const p of allPendingData) {
      if (!p || !p.timeline) continue;
      const matchedTrack = findTrackMatch(
        existingTracks,
        p.trackId ? idMap[p.trackId] || p.trackId : undefined,
        p.trackTitle,
        p.trackArtist
      );
      const pseudoMeta: TrackMvMeta = {
        id: p.id,
        trackId: matchedTrack?.id || p.trackId || '',
        title: p.mvTitle,
        fileName: p.fileName,
        mimeType: p.mimeType || 'video/mp4',
        fileSizeBytes: p.fileSizeBytes || 0,
        durationSec: p.durationSec || 0,
        sourceType: 'local',
        addedAt: p.savedAt || Date.now(),
        isActive: true,
        blurPx: p.blurPx,
        opacityPct: p.opacityPct,
        timeline: p.timeline,
      };
      const existingMvMeta = findMatchingExistingMvMeta(
        existingMvMetas,
        pseudoMeta,
        matchedTrack?.id || p.trackId
      );
      if (existingMvMeta) {
        await updateMvRecordMeta(existingMvMeta.id, {
          blurPx: p.blurPx,
          opacityPct: p.opacityPct,
          timeline: p.timeline,
        });
        mvTimelinesMatchedExisting++;
        mvsRestored++;
      } else {
        pendingToUpsert.push({
          ...p,
          trackId: matchedTrack?.id || p.trackId,
        });
      }
    }
  }

  if (options.includeMvTimelines && pendingToUpsert.length > 0) {
    pendingMvsStored = await upsertPendingMvTimelinesBatch(pendingToUpsert);
  }

  // Restore playlists
  if (options.includePlaylists && allPlaylistsData.length > 0) {
    onProgress?.('正在自动保存播放列表...');
    for (const pl of allPlaylistsData) {
      if (!pl?.id) continue;
      const remappedIds = Array.from(
        new Set((pl.trackIds || []).map((tid) => idMap[tid] || tid))
      );
      const existingPl =
        importMode === 'merge'
          ? existingPlaylists.find(
              (ex) =>
                ex.id === pl.id ||
                normalizeStr(ex.name) === normalizeStr(pl.name)
            )
          : undefined;
      const nextPl: Playlist = existingPl
        ? {
            ...existingPl,
            ...pl,
            id: existingPl.id,
            trackIds: Array.from(new Set([...existingPl.trackIds, ...remappedIds])),
            updatedAt: Date.now(),
          }
        : {
            ...pl,
            trackIds: remappedIds,
          };
      await savePlaylist(nextPl);
      playlistsRestored++;
    }
  }

  if (options.includeAudioSettings && settingsData?.audioSettings) {
    onProgress?.('正在自动保存音效与 DSP 参数...');
    await saveAudioSettings(settingsData.audioSettings);
    audioSettingsRestored = true;
  }

  if (options.includePersonalization) {
    if (settingsData?.personalization) {
      onProgress?.('正在自动保存个性化界面设置...');
      await savePersonalization(settingsData.personalization);
      personalizationRestored = true;
    }
    if (settingsData?.playbackPrefs) {
      const remappedLastTrack = settingsData.playbackPrefs.lastTrackId
        ? idMap[settingsData.playbackPrefs.lastTrackId] ||
          settingsData.playbackPrefs.lastTrackId
        : undefined;
      await savePlaybackPrefs({
        ...settingsData.playbackPrefs,
        lastTrackId: remappedLastTrack,
      });
      personalizationRestored = true;
    }
  }

  if (options.includeAiData) {
    const now = Date.now();
    const normalizedTasks: AiTaskRecord[] = allAiTasksData
      .filter((t): t is AiTaskRecord => Boolean(t && t.id))
      .map((task) => {
        const remappedTrackId = task.sourceTrackId
          ? idMap[task.sourceTrackId] || task.sourceTrackId
          : undefined;
        if (shouldNormalizeImportedTask(task.status)) {
          tasksNormalizedToResubmit++;
          const prevLogs = task.stageLogs ? [...task.stageLogs] : [];
          prevLogs.push({
            timestamp: now,
            stage: '从备份恢复 · 需要重新提交执行',
            detail: `原状态为「${task.status}」，跨环境导入不伪造后台运行状态`,
          });
          return {
            ...task,
            sourceTrackId: remappedTrackId,
            status: 'needs_resubmit',
            stageLabel: '从备份恢复 · 需要重新提交执行',
            estimatedRemainingSec: null,
            backendJobId: undefined,
            finishedAt: task.finishedAt ?? now,
            stageLogs: prevLogs.slice(-40),
          };
        }
        return {
          ...task,
          sourceTrackId: remappedTrackId,
        };
      });

    if (normalizedTasks.length > 0) {
      await saveAiTasksBatch(normalizedTasks);
      tasksRestored = normalizedTasks.length;
    }

    if (aiConfigData) {
      onProgress?.('正在同步 AI 服务商非敏感配置...');
      aiProvidersSynced = await syncAiConfigMetadataToServer(aiConfigData);
    }
  }

  return {
    tracksRestored,
    trackAudioRestored,
    playlistsRestored,
    stemsRestored,
    mvsRestored,
    mvVideosRestored,
    mvTimelinesMatchedExisting,
    pendingMvsStored,
    audioSettingsRestored,
    personalizationRestored,
    tasksRestored,
    tasksNormalizedToResubmit,
    aiProvidersSynced,
  };
}

export async function importLuminaBackup(
  file: File,
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  importMode: 'merge' | 'replace' = 'merge',
  onProgress?: (label: string) => void
): Promise<BackupImportSummary> {
  return importLuminaBackupFiles([file], options, importMode, onProgress);
}
