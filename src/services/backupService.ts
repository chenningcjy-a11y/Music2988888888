import { fetchProviders, fetchStemServices } from './ai/providerManager';
import {
  clearAiTasks,
  clearAllMusicData,
  getAllAiTasks,
  getAllMvRecords,
  getAllPlaylists,
  getAllStemRecords,
  getAllTracks,
  getAudioBlob,
  loadAudioSettings,
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
} from './storage';
import {
  AiProviderConfig,
  AiTaskRecord,
  AiTaskStatus,
  StemServiceConfig,
} from '../types/ai';
import {
  AudioDspSettings,
  PersonalizationSettings,
  PlaybackPrefs,
  Playlist,
  TrackMetadata,
  TrackMvMeta,
  TrackMvRecord,
  TrackStemsRecord,
} from '../types/music';

interface SerializedTrackEntry {
  track: TrackMetadata;
  audioBase64?: string;
  audioMimeType?: string;
}

interface SerializedStemEntry {
  trackId: string;
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
  videoBase64?: string;
}

export interface LuminaBackupBundle {
  format: 'lumina-music-backup';
  version: 2;
  exportedAt: number;
  tracks: SerializedTrackEntry[];
  playlists: Playlist[];
  stems: SerializedStemEntry[];
  mvs?: SerializedMvEntry[];
  aiTasks: AiTaskRecord[];
  settings: {
    audioSettings: AudioDspSettings;
    personalization: PersonalizationSettings;
    playbackPrefs: PlaybackPrefs;
  };
  // Non-secret metadata ONLY; API keys are NEVER included in backups
  aiConfigMetadata: {
    defaultProviderId: string | null;
    providers: Array<Omit<AiProviderConfig, 'hasKey'>>;
    activeStemServiceId: string | null;
    stemServices: Array<Omit<StemServiceConfig, 'hasKey'>>;
  };
}

export interface BackupImportSummary {
  tracksRestored: number;
  playlistsRestored: number;
  stemsRestored: number;
  mvsRestored?: number;
  tasksRestored: number;
  tasksNormalizedToResubmit: number;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function shouldNormalizeImportedTask(status: AiTaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'queued' ||
    status === 'paused' ||
    status === 'awaiting_confirmation'
  );
}

export async function exportFullLuminaBackup(): Promise<{
  bundle: LuminaBackupBundle;
  filename: string;
}> {
  const [
    tracks,
    playlists,
    stemRecords,
    mvRecords,
    aiTasks,
    audioSettings,
    personalization,
    playbackPrefs,
    providerResp,
    stemServiceResp,
  ] = await Promise.all([
    getAllTracks(),
    getAllPlaylists(),
    getAllStemRecords(),
    getAllMvRecords(),
    getAllAiTasks(),
    loadAudioSettings(),
    loadPersonalization(),
    loadPlaybackPrefs(),
    fetchProviders().catch(() => ({
      defaultProviderId: null,
      providers: [] as AiProviderConfig[],
      securityMode: 'server',
    })),
    fetchStemServices().catch(() => ({
      activeStemServiceId: null,
      services: [] as StemServiceConfig[],
    })),
  ]);

  const serializedTracks: SerializedTrackEntry[] = [];
  for (const track of tracks) {
    const blob = await getAudioBlob(track.id);
    if (blob) {
      serializedTracks.push({
        track,
        audioBase64: await blobToBase64(blob),
        audioMimeType: blob.type || 'audio/wav',
      });
    } else {
      serializedTracks.push({ track });
    }
  }

  const serializedStems: SerializedStemEntry[] = [];
  for (const stem of stemRecords) {
    serializedStems.push({
      trackId: stem.trackId,
      modelId: stem.modelId,
      modelName: stem.modelName,
      engineUsed: stem.engineUsed,
      duration: stem.duration,
      createdAt: stem.createdAt,
      vocalBase64: await blobToBase64(stem.vocalBlob),
      instrumentalBase64: await blobToBase64(stem.instrumentalBlob),
    });
  }

  const serializedMvs: SerializedMvEntry[] = [];
  for (const mv of mvRecords) {
    const { videoBlob, ...meta } = mv;
    serializedMvs.push({
      meta,
      videoBase64: videoBlob ? await blobToBase64(videoBlob) : undefined,
    });
  }

  // Explicitly strip any secret indicator or key material
  const safeProviders = (providerResp.providers || []).map(
    ({ hasKey: _ignored, ...rest }) => rest
  );
  const safeStemServices = (stemServiceResp.services || []).map(
    ({ hasKey: _ignored, ...rest }) => rest
  );

  const bundle: LuminaBackupBundle = {
    format: 'lumina-music-backup',
    version: 2,
    exportedAt: Date.now(),
    tracks: serializedTracks,
    playlists,
    stems: serializedStems,
    mvs: serializedMvs,
    aiTasks,
    settings: {
      audioSettings,
      personalization,
      playbackPrefs,
    },
    aiConfigMetadata: {
      defaultProviderId: providerResp.defaultProviderId,
      providers: safeProviders,
      activeStemServiceId: stemServiceResp.activeStemServiceId,
      stemServices: safeStemServices,
    },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    bundle,
    filename: `lumina-music-backup-${stamp}.json`,
  };
}

export async function importFullLuminaBackup(
  rawJson: string
): Promise<BackupImportSummary> {
  const parsed = JSON.parse(rawJson) as Partial<LuminaBackupBundle>;
  if (!parsed || parsed.format !== 'lumina-music-backup') {
    throw new Error('无效的备份文件格式，请选择由 LUMINA MUSIC 导出的 JSON 备份文件');
  }

  await clearAllMusicData();
  await clearAiTasks();

  let tracksRestored = 0;
  for (const entry of parsed.tracks || []) {
    if (!entry?.track?.id) continue;
    const blob = entry.audioBase64
      ? base64ToBlob(entry.audioBase64, entry.audioMimeType || 'audio/wav')
      : new Blob([], { type: 'audio/wav' });
    await saveTrackWithBlob(entry.track, blob);
    tracksRestored++;
  }

  let playlistsRestored = 0;
  for (const pl of parsed.playlists || []) {
    if (!pl?.id) continue;
    await savePlaylist(pl);
    playlistsRestored++;
  }

  let stemsRestored = 0;
  for (const st of parsed.stems || []) {
    if (!st?.trackId || !st.vocalBase64 || !st.instrumentalBase64) continue;
    await saveTrackStems({
      trackId: st.trackId,
      modelId: st.modelId,
      modelName: st.modelName,
      engineUsed: st.engineUsed,
      duration: st.duration,
      createdAt: st.createdAt,
      vocalBlob: base64ToBlob(st.vocalBase64, 'audio/wav'),
      instrumentalBlob: base64ToBlob(st.instrumentalBase64, 'audio/wav'),
    });
    stemsRestored++;
  }

  let mvsRestored = 0;
  for (const entry of parsed.mvs || []) {
    if (!entry?.meta?.id) continue;
    const record: TrackMvRecord = {
      ...entry.meta,
      videoBlob: entry.videoBase64
        ? base64ToBlob(entry.videoBase64, entry.meta.mimeType || 'video/mp4')
        : undefined,
    };
    await saveTrackMv(record);
    mvsRestored++;
  }

  if (parsed.settings?.audioSettings) {
    await saveAudioSettings(parsed.settings.audioSettings);
  }
  if (parsed.settings?.personalization) {
    await savePersonalization(parsed.settings.personalization);
  }
  if (parsed.settings?.playbackPrefs) {
    await savePlaybackPrefs(parsed.settings.playbackPrefs);
  }

  let tasksNormalizedToResubmit = 0;
  const now = Date.now();
  const normalizedTasks: AiTaskRecord[] = (parsed.aiTasks || [])
    .filter((t): t is AiTaskRecord => Boolean(t && t.id))
    .map((task) => {
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
          status: 'needs_resubmit',
          stageLabel: '从备份恢复 · 需要重新提交执行',
          estimatedRemainingSec: null,
          backendJobId: undefined,
          finishedAt: task.finishedAt ?? now,
          stageLogs: prevLogs.slice(-40),
        };
      }
      return task;
    });

  if (normalizedTasks.length > 0) {
    await saveAiTasksBatch(normalizedTasks);
  }

  return {
    tracksRestored,
    playlistsRestored,
    stemsRestored,
    mvsRestored,
    tasksRestored: normalizedTasks.length,
    tasksNormalizedToResubmit,
  };
}
