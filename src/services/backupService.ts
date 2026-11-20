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
  getAllMvRecords,
  getAllPlaylists,
  getAllStemMetas,
  getAllStemRecords,
  getAllTracks,
  getAudioBlob,
  loadAudioSettings,
  loadPendingMvTimelines,
  loadPersonalization,
  loadPlaybackPrefs,
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

// 3 MiB slices: exact multiple of 3 bytes so independent Base64 chunks concatenate cleanly
const BASE64_ENCODE_SLICE_BYTES = 3 * 1024 * 1024;
const LARGE_FILE_STREAM_THRESHOLD_BYTES = 64 * 1024 * 1024;
const STREAM_READ_CHUNK_BYTES = 2 * 1024 * 1024;

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
  // Non-secret metadata ONLY; API keys are NEVER included in backups
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

export interface InspectedBackupFile {
  file: File;
  fileName: string;
  fileSizeBytes: number;
  version: number;
  exportedAt: number | null;
  manifest: BackupManifestSummary;
  availableOptions: BackupSelectionOptions;
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

function uint8ToBinaryString(bytes: Uint8Array): string {
  const subSize = 24576; // divisible by 3, avoids call-stack limits
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
    const b64 = btoa(uint8ToBinaryString(bytes));
    parts.push(b64);
  }
  parts.push('"');
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  if (!base64) return new Blob([], { type: mimeType });
  const parts: BlobPart[] = [];
  const step = 4 * 65536; // 262,144 chars (multiple of 4)
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

  setMimeType(mime: string) {
    if (mime) this.mimeType = mime;
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

function shouldNormalizeImportedTask(status: AiTaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'queued' ||
    status === 'paused' ||
    status === 'awaiting_confirmation'
  );
}

function normalizeStr(s?: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripExt(name?: string): string {
  return normalizeStr(name).replace(/\.[^/.]+$/, '');
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

/**
 * Chunked / streaming Blob exporter:
 * Writes JSON pieces into BlobPart[] incrementally with 3MiB base64 slices
 * so even multi-hundred-MB or GB-level media libraries never hit V8 string length limits.
 */
export async function exportLuminaBackupBlob(
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  onProgress?: (label: string) => void
): Promise<{
  blob: Blob;
  filename: string;
  manifest: BackupManifestSummary;
}> {
  onProgress?.('正在收集曲库与设置清单...');
  const needTracks = options.includeTracksMeta || options.includeTrackAudio;

  const [
    tracks,
    playlists,
    stemRecords,
    mvRecords,
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
    options.includeStems ? getAllStemRecords() : Promise.resolve([] as TrackStemsRecord[]),
    options.includeMvTimelines || options.includeMvVideos
      ? getAllMvRecords()
      : Promise.resolve([] as TrackMvRecord[]),
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
  const stemsToExport = options.includeStems ? stemRecords : [];
  const mvsToExport = options.includeMvTimelines || options.includeMvVideos ? mvRecords : [];
  const pendingToExport = options.includeMvTimelines ? pendingMvTimelines : [];

  const manifest: BackupManifestSummary = {
    tracksMetaCount: tracksToExport.length,
    tracksAudioCount: options.includeTrackAudio
      ? tracksToExport.filter((t) => t.fileSize > 0).length
      : 0,
    playlistsCount: playlists.length,
    mvTimelinesCount: mvsToExport.length + pendingToExport.length,
    mvVideosCount: options.includeMvVideos
      ? mvsToExport.filter((m) => Boolean(m.videoBlob && m.videoBlob.size > 0)).length
      : 0,
    pendingMvTimelinesCount: pendingToExport.length,
    stemsCount: stemsToExport.length,
    hasAudioSettings: Boolean(audioSettings),
    hasPersonalization: Boolean(personalization || playbackPrefs),
    aiTasksCount: aiTasks.length,
    aiProvidersCount: safeProviders.length,
    stemServicesCount: safeStemServices.length,
  };

  // Write lightweight manifest & configs FIRST so inspect() on multi-GB files completes in <20ms
  const parts: BlobPart[] = [];
  parts.push('{');
  parts.push(`"format":"lumina-music-backup",`);
  parts.push(`"version":3,`);
  parts.push(`"exportedAt":${Date.now()},`);
  parts.push(`"selection":${JSON.stringify(options)},`);
  parts.push(`"manifest":${JSON.stringify(manifest)},`);
  parts.push(`"playlists":${JSON.stringify(playlists)},`);
  parts.push(`"pendingMvTimelines":${JSON.stringify(pendingToExport)},`);
  parts.push(`"aiTasks":${JSON.stringify(aiTasks)},`);
  parts.push(
    `"settings":${JSON.stringify({
      ...(audioSettings ? { audioSettings } : {}),
      ...(personalization ? { personalization } : {}),
      ...(playbackPrefs ? { playbackPrefs } : {}),
    })},`
  );
  parts.push(
    `"aiConfigMetadata":${JSON.stringify({
      defaultProviderId: providerResp.defaultProviderId,
      providers: safeProviders,
      activeStemServiceId: stemServiceResp.activeStemServiceId,
      stemServices: safeStemServices,
    })},`
  );

  // Tracks array (streamed per track)
  parts.push(`"tracks":[`);
  let writtenTracks = 0;
  for (let i = 0; i < tracksToExport.length; i++) {
    const track = tracksToExport[i];
    if (writtenTracks > 0) parts.push(',');
    writtenTracks++;

    const blob = options.includeTrackAudio ? await getAudioBlob(track.id) : undefined;
    if (blob && blob.size > 0) {
      onProgress?.(
        `正在打包曲目音频 (${i + 1}/${tracksToExport.length}): ${track.title}`
      );
      parts.push(`{"track":${JSON.stringify(track)},`);
      parts.push(`"audioMimeType":${JSON.stringify(blob.type || track.mimeType || 'audio/wav')},`);
      parts.push(`"audioBase64":`);
      await appendBlobAsJsonBase64Parts(blob, parts);
      parts.push('}');
    } else {
      onProgress?.(
        `正在打包曲目信息 (${i + 1}/${tracksToExport.length}): ${track.title}`
      );
      parts.push(`{"track":${JSON.stringify(track)}}`);
    }
  }
  parts.push('],');

  // Stems array (streamed per stem)
  parts.push(`"stems":[`);
  for (let i = 0; i < stemsToExport.length; i++) {
    const stem = stemsToExport[i];
    if (i > 0) parts.push(',');
    const parentTrack = trackById.get(stem.trackId);
    onProgress?.(
      `正在打包分离音轨 (${i + 1}/${stemsToExport.length}): ${
        parentTrack?.title || stem.trackId
      }`
    );
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
  parts.push('],');

  // MVs array (streamed per MV)
  parts.push(`"mvs":[`);
  for (let i = 0; i < mvsToExport.length; i++) {
    const mv = mvsToExport[i];
    if (i > 0) parts.push(',');
    const { videoBlob, ...meta } = mv;
    const parentTrack = trackById.get(meta.trackId);
    onProgress?.(
      `正在打包 MV 配置${options.includeMvVideos && videoBlob ? '与视频' : ''} (${
        i + 1
      }/${mvsToExport.length}): ${meta.title}`
    );
    parts.push('{');
    parts.push(`"meta":${JSON.stringify(meta)},`);
    if (parentTrack) {
      parts.push(`"trackTitle":${JSON.stringify(parentTrack.title)},`);
      parts.push(`"trackArtist":${JSON.stringify(parentTrack.artist)},`);
    }
    const includeVideo = Boolean(
      options.includeMvVideos && videoBlob && videoBlob.size > 0
    );
    if (includeVideo && videoBlob) {
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
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix =
    !options.includeTrackAudio && !options.includeMvVideos && !options.includeStems
      ? 'config'
      : 'full';

  return {
    blob,
    filename: `lumina-music-${suffix}-backup-${stamp}.json`,
    manifest,
  };
}

/**
 * Streaming JSON parser over File.slice() for multi-hundred-MB backup files.
 * Decodes large base64 blob fields chunk-by-chunk into BlobPart[] so peak RAM stays minimal.
 */
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
    pos++; // consume opening '"'
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
      // null
      await ensure(4);
      pos += 4;
      return undefined;
    }
    if (first !== '"') {
      throw new Error('备份文件 Base64 字段格式异常');
    }
    pos++; // consume '"'
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

  // Reads a complete JSON value whose total serialized size fits comfortably in memory (<40MB)
  const readSmallJsonValue = async (): Promise<unknown> => {
    const first = await peekChar();
    if (first === null) return undefined;
    if (first === '"') {
      return readJsonString();
    }
    if (first !== '{' && first !== '[') {
      // number / boolean / null
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
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{' || ch === '[') {
          depth++;
        } else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            return JSON.parse(raw);
          }
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
    throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
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
  if (file.size <= LARGE_FILE_STREAM_THRESHOLD_BYTES) {
    const raw = await file.text();
    let parsed: Partial<LuminaBackupBundle>;
    try {
      parsed = JSON.parse(raw) as Partial<LuminaBackupBundle>;
    } catch {
      throw new Error('无效的 JSON 备份文件，无法解析');
    }
    if (!parsed || parsed.format !== 'lumina-music-backup') {
      throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
    }
    const manifest = buildManifestFromBundle(parsed);
    return {
      file,
      fileName: file.name,
      fileSizeBytes: file.size,
      version: parsed.version || 2,
      exportedAt: parsed.exportedAt || null,
      manifest,
      availableOptions: deriveAvailableImportOptions(manifest),
    };
  }

  // Streaming inspection for large backups
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
    throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
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
    version: header.version || 2,
    exportedAt: header.exportedAt || null,
    manifest,
    availableOptions: deriveAvailableImportOptions(manifest),
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

function findMatchingExistingMv(
  existingMvs: TrackMvRecord[],
  meta: TrackMvMeta,
  resolvedTrackId?: string
): TrackMvRecord | undefined {
  const byId = existingMvs.find((m) => m.id === meta.id);
  if (byId && (byId.sourceType === 'url' || Boolean(byId.videoBlob && byId.videoBlob.size > 0))) {
    return byId;
  }

  const nFile = normalizeStr(meta.fileName);
  const nTitle = normalizeStr(meta.title);

  // Match by trackId + file or MV title
  if (resolvedTrackId) {
    const sameTrackMvs = existingMvs.filter(
      (m) =>
        m.trackId === resolvedTrackId &&
        (m.sourceType === 'url' || Boolean(m.videoBlob && m.videoBlob.size > 0))
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

  // Match globally by exact video fileName + fileSizeBytes
  if (nFile && meta.fileSizeBytes > 0) {
    return existingMvs.find(
      (m) =>
        Boolean(m.videoBlob && m.videoBlob.size > 0) &&
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

export async function importLuminaBackup(
  file: File,
  options: BackupSelectionOptions = DEFAULT_BACKUP_EXPORT_OPTIONS,
  importMode: 'merge' | 'replace' = 'merge',
  onProgress?: (label: string) => void
): Promise<BackupImportSummary> {
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
  const existingMvs = await getAllMvRecords();
  const existingAiTasks = await getAllAiTasks();

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

    const existingMv = findMatchingExistingMv(existingMvs, meta, resolvedTrackId);

    // 1. Restore full video + timeline if backup carries video and user selected MV videos
    if (hasVideoPayload && videoBlob) {
      const record: TrackMvRecord = {
        ...meta,
        trackId: resolvedTrackId,
        blurPx: options.includeMvTimelines
          ? meta.blurPx
          : existingMv?.blurPx ?? meta.blurPx,
        opacityPct: options.includeMvTimelines
          ? meta.opacityPct
          : existingMv?.opacityPct ?? meta.opacityPct,
        timeline: options.includeMvTimelines
          ? meta.timeline
          : existingMv?.timeline ?? meta.timeline,
        videoBlob,
      };
      await saveTrackMv(record);
      existingMvs.push(record);
      mvsRestored++;
      mvVideosRestored++;
      return;
    }

    // 2. If only MV timelines/configs selected (or backup had no video):
    if (!options.includeMvTimelines) return;

    // 2a. Online URL MV with resolved track existing
    if (meta.sourceType === 'url' && meta.externalUrl && matchedTrack) {
      const urlRec: TrackMvRecord = {
        ...meta,
        trackId: matchedTrack.id,
      };
      await saveTrackMv(urlRec);
      existingMvs.push(urlRec);
      mvsRestored++;
      return;
    }

    // 2b. Existing local MV already imported in target environment -> apply timeline immediately!
    if (existingMv) {
      await updateMvRecordMeta(existingMv.id, {
        blurPx: meta.blurPx,
        opacityPct: meta.opacityPct,
        timeline: meta.timeline,
      });
      mvTimelinesMatchedExisting++;
      mvsRestored++;
      return;
    }

    // 2c. No matching MV video imported yet -> store in pendingMvTimelines so future MV upload auto-applies intro/outro!
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

  let playlistsData: Playlist[] = [];
  let pendingData: PendingMvTimelineRecord[] = [];
  let aiTasksData: AiTaskRecord[] = [];
  let settingsData: LuminaBackupBundle['settings'] | undefined;
  let aiConfigData: LuminaBackupBundle['aiConfigMetadata'] | undefined;

  if (file.size <= LARGE_FILE_STREAM_THRESHOLD_BYTES) {
    onProgress?.('正在解析备份文件并保存数据...');
    const rawJson = await file.text();
    const parsed = JSON.parse(rawJson) as Partial<LuminaBackupBundle>;
    if (!parsed || parsed.format !== 'lumina-music-backup') {
      throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
    }

    for (let i = 0; i < (parsed.tracks || []).length; i++) {
      const entry = parsed.tracks![i];
      if (!entry?.track?.id) continue;
      onProgress?.(`正在自动保存曲目 (${i + 1}/${parsed.tracks!.length}): ${entry.track.title}`);
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
        onProgress?.(`正在自动保存分离音轨 (${i + 1}/${parsed.stems!.length})...`);
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
      onProgress?.(`正在同步 MV 时间轴与视频 (${i + 1}/${parsed.mvs!.length})...`);
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

    playlistsData = parsed.playlists || [];
    pendingData = parsed.pendingMvTimelines || [];
    aiTasksData = parsed.aiTasks || [];
    settingsData = parsed.settings;
    aiConfigData = parsed.aiConfigMetadata;
  } else {
    onProgress?.('正在以流式低内存模式读取大型备份...');
    const header = await streamScanLuminaBackupFile(file, {
      onHeaderField: (key, val) => {
        if (key === 'playlists' && Array.isArray(val)) playlistsData = val as Playlist[];
        if (key === 'pendingMvTimelines' && Array.isArray(val))
          pendingData = val as PendingMvTimelineRecord[];
        if (key === 'aiTasks' && Array.isArray(val)) aiTasksData = val as AiTaskRecord[];
        if (key === 'settings' && val && typeof val === 'object')
          settingsData = val as LuminaBackupBundle['settings'];
        if (key === 'aiConfigMetadata' && val && typeof val === 'object')
          aiConfigData = val as LuminaBackupBundle['aiConfigMetadata'];
      },
      onTrack: async (item) => {
        onProgress?.(`正在流式写入曲目：${item.track.title}`);
        await handleTrackItem(item);
      },
      onStem: async (item) => {
        onProgress?.(`正在流式写入分离音轨...`);
        await handleStemItem(item);
      },
      onMv: async (item) => {
        onProgress?.(`正在流式同步 MV：${item.meta.title}`);
        await handleMvItem(item);
      },
    });
    if (header.format !== 'lumina-music-backup') {
      throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
    }
  }

  // Handle pendingMvTimelines carried inside the backup:
  // If target environment ALREADY has the corresponding MV video uploaded, apply timeline immediately!
  // Otherwise store in pendingToUpsert for auto-match when user uploads that MV later.
  if (options.includeMvTimelines && pendingData.length > 0) {
    for (const p of pendingData) {
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
      const existingMv = findMatchingExistingMv(
        existingMvs,
        pseudoMeta,
        matchedTrack?.id || p.trackId
      );
      if (existingMv) {
        await updateMvRecordMeta(existingMv.id, {
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

  // Restore playlists (remap trackIds safely)
  if (options.includePlaylists && playlistsData.length > 0) {
    onProgress?.('正在自动保存播放列表...');
    for (const pl of playlistsData) {
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

  // Restore audio DSP settings
  if (options.includeAudioSettings && settingsData?.audioSettings) {
    onProgress?.('正在自动保存音效与 DSP 参数...');
    await saveAudioSettings(settingsData.audioSettings);
    audioSettingsRestored = true;
  }

  // Restore personalization & playback prefs
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

  // Restore AI tasks & non-secret provider metadata
  if (options.includeAiData) {
    const now = Date.now();
    const normalizedTasks: AiTaskRecord[] = aiTasksData
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
