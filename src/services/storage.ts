import { AiTaskRecord } from '../types/ai';
import {
  AudioDspSettings,
  PendingMvTimelineRecord,
  PersonalizationSettings,
  PlaybackPrefs,
  Playlist,
  TrackMetadata,
  TrackMvMeta,
  TrackMvRecord,
  TrackStemsMeta,
  TrackStemsRecord,
} from '../types/music';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_PERSONALIZATION,
  DEFAULT_PLAYBACK_PREFS,
} from '../utils/constants';

const DB_NAME = 'lumina-music-db';
const DB_VERSION = 5;

const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'audioBlobs';
const STORE_PLAYLISTS = 'playlists';
const STORE_SETTINGS = 'settings';
const STORE_STEMS = 'stems';
const STORE_MODELS = 'models';
const STORE_AI_TASKS = 'ai_tasks';
const STORE_MVS = 'mvs';
const STORE_MV_BLOBS = 'mvBlobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_STEMS)) {
        db.createObjectStore(STORE_STEMS, { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS);
      }
      if (!db.objectStoreNames.contains(STORE_AI_TASKS)) {
        db.createObjectStore(STORE_AI_TASKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MVS)) {
        const mvStore = db.createObjectStore(STORE_MVS, { keyPath: 'id' });
        mvStore.createIndex('by_trackId', 'trackId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MV_BLOBS)) {
        db.createObjectStore(STORE_MV_BLOBS);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开 IndexedDB 数据库'));
  });

  return dbPromise;
}

function wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllTracks(): Promise<TrackMetadata[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_TRACKS, 'readonly');
  const items = await wrapRequest(tx.objectStore(STORE_TRACKS).getAll());
  return (items as TrackMetadata[]).sort((a, b) => a.addedAt - b.addedAt);
}

export async function saveTrackWithBlob(
  track: TrackMetadata,
  blob?: Blob
): Promise<void> {
  const db = await openDatabase();
  const hasValidBlob = Boolean(blob && blob.size > 0);
  return new Promise((resolve, reject) => {
    const stores = hasValidBlob ? [STORE_TRACKS, STORE_BLOBS] : [STORE_TRACKS];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORE_TRACKS).put(track);
    if (hasValidBlob && blob) {
      tx.objectStore(STORE_BLOBS).put(blob, track.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const err = tx.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new Error('浏览器本地存储空间已满，请清理部分曲目后重试。'));
      } else {
        reject(err || new Error('保存音频到本地数据库失败'));
      }
    };
  });
}

export async function updateTrackMetadata(track: TrackMetadata): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_TRACKS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_TRACKS).put(track));
}

export async function getAudioBlob(trackId: string): Promise<Blob | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  return wrapRequest(tx.objectStore(STORE_BLOBS).get(trackId)) as Promise<
    Blob | undefined
  >;
}

export async function deleteTrackById(trackId: string): Promise<void> {
  const db = await openDatabase();
  const trackMvs = await getTrackMvs(trackId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE_TRACKS, STORE_BLOBS, STORE_STEMS, STORE_MVS, STORE_MV_BLOBS],
      'readwrite'
    );
    tx.objectStore(STORE_TRACKS).delete(trackId);
    tx.objectStore(STORE_BLOBS).delete(trackId);
    tx.objectStore(STORE_STEMS).delete(trackId);
    const mvStore = tx.objectStore(STORE_MVS);
    const mvBlobStore = tx.objectStore(STORE_MV_BLOBS);
    for (const mv of trackMvs) {
      mvStore.delete(mv.id);
      mvBlobStore.delete(mv.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveTrackStems(record: TrackStemsRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STEMS, 'readwrite');
    tx.objectStore(STORE_STEMS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const err = tx.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new Error('浏览器存储空间不足，无法缓存分离音轨，请清理部分缓存后重试。'));
      } else {
        reject(err || new Error('保存分离音轨失败'));
      }
    };
  });
}

export async function getTrackStems(
  trackId: string
): Promise<TrackStemsRecord | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_STEMS, 'readonly');
  return wrapRequest(tx.objectStore(STORE_STEMS).get(trackId)) as Promise<
    TrackStemsRecord | undefined
  >;
}

export async function getAllStemMetas(): Promise<TrackStemsMeta[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_STEMS, 'readonly');
  const records = (await wrapRequest(tx.objectStore(STORE_STEMS).getAll())) as TrackStemsRecord[];
  return records.map((r) => ({
    trackId: r.trackId,
    modelId: r.modelId,
    modelName: r.modelName,
    engineUsed: r.engineUsed,
    duration: r.duration,
    createdAt: r.createdAt,
    vocalSizeBytes: r.vocalBlob?.size || 0,
    instrumentalSizeBytes: r.instrumentalBlob?.size || 0,
  }));
}

export async function deleteTrackStems(trackId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_STEMS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_STEMS).delete(trackId));
}

export async function getCachedModelBytes(modelId: string): Promise<ArrayBuffer | undefined> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MODELS, 'readonly');
    return (await wrapRequest(tx.objectStore(STORE_MODELS).get(modelId))) as
      | ArrayBuffer
      | undefined;
  } catch {
    return undefined;
  }
}

export async function saveCachedModelBytes(
  modelId: string,
  bytes: ArrayBuffer
): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MODELS, 'readwrite');
    await wrapRequest(tx.objectStore(STORE_MODELS).put(bytes, modelId));
  } catch {
    // Non-fatal if browser quota skips persisting 66MB ONNX weights
  }
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PLAYLISTS, 'readonly');
  const items = await wrapRequest(tx.objectStore(STORE_PLAYLISTS).getAll());
  return (items as Playlist[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function savePlaylist(playlist: Playlist): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PLAYLISTS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_PLAYLISTS).put(playlist));
}

export async function deletePlaylistById(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PLAYLISTS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_PLAYLISTS).delete(id));
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const val = await wrapRequest(tx.objectStore(STORE_SETTINGS).get(key));
    return val !== undefined ? { ...fallback, ...val } : fallback;
  } catch {
    return fallback;
  }
}

async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SETTINGS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_SETTINGS).put(value, key));
}

export const loadAudioSettings = () =>
  getSetting<AudioDspSettings>('audioSettings', DEFAULT_AUDIO_SETTINGS);

export const saveAudioSettings = (s: AudioDspSettings) =>
  setSetting('audioSettings', s);

export const loadPersonalization = () =>
  getSetting<PersonalizationSettings>('personalization', DEFAULT_PERSONALIZATION);

export const savePersonalization = (s: PersonalizationSettings) =>
  setSetting('personalization', s);

export const loadPlaybackPrefs = () =>
  getSetting<PlaybackPrefs>('playbackPrefs', DEFAULT_PLAYBACK_PREFS);

export const savePlaybackPrefs = (p: PlaybackPrefs) =>
  setSetting('playbackPrefs', p);

export async function hasInitializedDemo(): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const val = await wrapRequest(tx.objectStore(STORE_SETTINGS).get('demoSeeded'));
    return Boolean(val);
  } catch {
    return false;
  }
}

export async function markDemoInitialized(): Promise<void> {
  await setSetting('demoSeeded', true);
}

export async function getStorageEstimate(): Promise<{
  usageBytes: number;
  quotaBytes: number;
}> {
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    return {
      usageBytes: est.usage || 0,
      quotaBytes: est.quota || 0,
    };
  }
  return { usageBytes: 0, quotaBytes: 0 };
}

export async function clearAllMusicData(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE_TRACKS, STORE_BLOBS, STORE_PLAYLISTS, STORE_STEMS, STORE_MVS, STORE_MV_BLOBS, STORE_SETTINGS],
      'readwrite'
    );
    tx.objectStore(STORE_TRACKS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.objectStore(STORE_PLAYLISTS).clear();
    tx.objectStore(STORE_STEMS).clear();
    tx.objectStore(STORE_MVS).clear();
    tx.objectStore(STORE_MV_BLOBS).clear();
    tx.objectStore(STORE_SETTINGS).delete('pendingMvTimelines');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearTracksStore(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_TRACKS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPlaylistsStore(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PLAYLISTS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_PLAYLISTS).clear());
}

export async function clearStemsStore(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_STEMS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_STEMS).clear());
}

export async function getAllAiTasks(): Promise<AiTaskRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_AI_TASKS, 'readonly');
    const list = (await wrapRequest(
      tx.objectStore(STORE_AI_TASKS).getAll()
    )) as AiTaskRecord[];
    return list
      .sort((a, b) => (b.createdAt || b.startedAt) - (a.createdAt || a.startedAt))
      .slice(0, 200);
  } catch {
    return [];
  }
}

export async function saveAiTask(task: AiTaskRecord): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_AI_TASKS, 'readwrite');
    await wrapRequest(tx.objectStore(STORE_AI_TASKS).put(task));
  } catch {
    // Non-fatal
  }
}

export async function deleteAiTaskById(taskId: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_AI_TASKS, 'readwrite');
    await wrapRequest(tx.objectStore(STORE_AI_TASKS).delete(taskId));
  } catch {
    // Non-fatal
  }
}

export async function clearAiTasks(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_AI_TASKS, 'readwrite');
  await wrapRequest(tx.objectStore(STORE_AI_TASKS).clear());
}

export async function getAllStemRecords(): Promise<TrackStemsRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_STEMS, 'readonly');
    return (await wrapRequest(tx.objectStore(STORE_STEMS).getAll())) as TrackStemsRecord[];
  } catch {
    return [];
  }
}

export async function saveAiTasksBatch(tasks: AiTaskRecord[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AI_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_AI_TASKS);
    for (const t of tasks) {
      store.put(t);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stripMvBlob(rec: TrackMvRecord): TrackMvMeta {
  const { videoBlob: _blob, ...meta } = rec;
  return meta;
}

export async function saveTrackMv(record: TrackMvRecord): Promise<void> {
  const db = await openDatabase();
  const { videoBlob, ...meta } = record;
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MVS, STORE_MV_BLOBS], 'readwrite');
    tx.objectStore(STORE_MVS).put(meta);
    if (videoBlob) {
      tx.objectStore(STORE_MV_BLOBS).put(videoBlob, record.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const err = tx.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new Error('浏览器本地存储空间已满，请删除旧 MV 缓存后重试。'));
      } else {
        reject(err || new Error('保存 MV 视频到本地数据库失败'));
      }
    };
  });
}

async function hydrateMvRecord(
  db: IDBDatabase,
  rec: TrackMvRecord
): Promise<TrackMvRecord> {
  if (rec.videoBlob) return rec;
  if (rec.sourceType !== 'local') return rec;
  try {
    const tx = db.transaction(STORE_MV_BLOBS, 'readonly');
    const blob = (await wrapRequest(
      tx.objectStore(STORE_MV_BLOBS).get(rec.id)
    )) as Blob | undefined;
    return blob ? { ...rec, videoBlob: blob } : rec;
  } catch {
    return rec;
  }
}

export async function getTrackMvs(trackId: string): Promise<TrackMvRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MVS, 'readonly');
    const store = tx.objectStore(STORE_MVS);
    let items: TrackMvRecord[];
    if (store.indexNames.contains('by_trackId')) {
      items = (await wrapRequest(
        store.index('by_trackId').getAll(trackId)
      )) as TrackMvRecord[];
    } else {
      const all = (await wrapRequest(store.getAll())) as TrackMvRecord[];
      items = all.filter((m) => m.trackId === trackId);
    }
    const hydrated = await Promise.all(items.map((item) => hydrateMvRecord(db, item)));
    return hydrated.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function getMvRecordById(
  mvId: string
): Promise<TrackMvRecord | undefined> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MVS, 'readonly');
    const rec = (await wrapRequest(tx.objectStore(STORE_MVS).get(mvId))) as
      | TrackMvRecord
      | undefined;
    if (!rec) return undefined;
    return hydrateMvRecord(db, rec);
  } catch {
    return undefined;
  }
}

export async function getAllMvMetas(): Promise<TrackMvMeta[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MVS, 'readonly');
    const all = (await wrapRequest(tx.objectStore(STORE_MVS).getAll())) as TrackMvRecord[];
    return all.map(stripMvBlob).sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function getAllMvRecords(): Promise<TrackMvRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MVS, 'readonly');
    const all = (await wrapRequest(tx.objectStore(STORE_MVS).getAll())) as TrackMvRecord[];
    return Promise.all(all.map((item) => hydrateMvRecord(db, item)));
  } catch {
    return [];
  }
}

export async function setActiveTrackMv(
  trackId: string,
  mvId: string
): Promise<void> {
  const db = await openDatabase();
  const txRead = db.transaction(STORE_MVS, 'readonly');
  const storeRead = txRead.objectStore(STORE_MVS);
  const items = (
    storeRead.indexNames.contains('by_trackId')
      ? await wrapRequest(storeRead.index('by_trackId').getAll(trackId))
      : ((await wrapRequest(storeRead.getAll())) as TrackMvRecord[]).filter(
          (m) => m.trackId === trackId
        )
  ) as TrackMvRecord[];
  if (items.length === 0) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MVS, 'readwrite');
    const store = tx.objectStore(STORE_MVS);
    for (const item of items) {
      const { videoBlob: _ignored, ...meta } = item;
      store.put({ ...meta, isActive: item.id === mvId });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateMvRecordMeta(
  mvId: string,
  patch: Partial<TrackMvMeta>
): Promise<TrackMvRecord | undefined> {
  const db = await openDatabase();
  const txRead = db.transaction(STORE_MVS, 'readonly');
  const existing = (await wrapRequest(txRead.objectStore(STORE_MVS).get(mvId))) as
    | TrackMvRecord
    | undefined;
  if (!existing) return undefined;

  // Migrate any legacy inline videoBlob out of STORE_MVS cleanly
  const legacyBlob = existing.videoBlob;
  const { videoBlob: _ignored, ...existingMeta } = existing;

  const updatedMeta: TrackMvMeta = {
    ...existingMeta,
    ...patch,
    id: existing.id,
    trackId: existing.trackId,
    timeline: patch.timeline
      ? { ...existing.timeline, ...patch.timeline }
      : existing.timeline,
  };

  await new Promise<void>((resolve, reject) => {
    const stores = legacyBlob ? [STORE_MVS, STORE_MV_BLOBS] : [STORE_MVS];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORE_MVS).put(updatedMeta);
    if (legacyBlob) {
      tx.objectStore(STORE_MV_BLOBS).put(legacyBlob, mvId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return updatedMeta;
}

export async function deleteMvById(mvId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MVS, STORE_MV_BLOBS], 'readwrite');
    tx.objectStore(STORE_MVS).delete(mvId);
    tx.objectStore(STORE_MV_BLOBS).delete(mvId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllMvs(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MVS, STORE_MV_BLOBS], 'readwrite');
    tx.objectStore(STORE_MVS).clear();
    tx.objectStore(STORE_MV_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Deferred / Pending MV Timeline Presets (cross-device sync before MV video upload) ----------

const PENDING_MV_TIMELINES_KEY = 'pendingMvTimelines';

function normalizeMatchText(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stripFileExtension(fileName?: string): string {
  return normalizeMatchText(fileName).replace(/\.[^/.]+$/, '');
}

export async function loadPendingMvTimelines(): Promise<PendingMvTimelineRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const raw = await wrapRequest(
      tx.objectStore(STORE_SETTINGS).get(PENDING_MV_TIMELINES_KEY)
    );
    if (!Array.isArray(raw)) return [];
    return (raw as PendingMvTimelineRecord[])
      .filter((item) => Boolean(item && item.id && item.timeline))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch {
    return [];
  }
}

export async function savePendingMvTimelines(
  items: PendingMvTimelineRecord[]
): Promise<void> {
  await setSetting(PENDING_MV_TIMELINES_KEY, items);
}

export async function upsertPendingMvTimelinesBatch(
  incoming: PendingMvTimelineRecord[]
): Promise<number> {
  if (incoming.length === 0) return 0;
  const existing = await loadPendingMvTimelines();
  const next = [...existing];
  let addedOrUpdated = 0;

  for (const item of incoming) {
    if (!item || !item.timeline) continue;
    const normFile = normalizeMatchText(item.fileName);
    const normTrackTitle = normalizeMatchText(item.trackTitle);
    const normTrackArtist = normalizeMatchText(item.trackArtist);
    const normMvTitle = normalizeMatchText(item.mvTitle);

    const idx = next.findIndex((cur) => {
      if (cur.id === item.id) return true;
      if (normFile && normalizeMatchText(cur.fileName) === normFile) {
        if (!normTrackTitle || !normalizeMatchText(cur.trackTitle)) return true;
        if (normalizeMatchText(cur.trackTitle) === normTrackTitle) return true;
      }
      if (
        item.trackId &&
        cur.trackId === item.trackId &&
        normMvTitle &&
        normalizeMatchText(cur.mvTitle) === normMvTitle
      ) {
        return true;
      }
      if (
        normTrackTitle &&
        normalizeMatchText(cur.trackTitle) === normTrackTitle &&
        normalizeMatchText(cur.trackArtist) === normTrackArtist &&
        normMvTitle &&
        normalizeMatchText(cur.mvTitle) === normMvTitle
      ) {
        return true;
      }
      return false;
    });

    if (idx >= 0) {
      next[idx] = { ...next[idx], ...item, savedAt: item.savedAt || Date.now() };
    } else {
      next.unshift({
        ...item,
        savedAt: item.savedAt || Date.now(),
      });
    }
    addedOrUpdated++;
  }

  await savePendingMvTimelines(next.slice(0, 300));
  return addedOrUpdated;
}

export async function removePendingMvTimelineById(id: string): Promise<void> {
  const existing = await loadPendingMvTimelines();
  const filtered = existing.filter((item) => item.id !== id);
  if (filtered.length !== existing.length) {
    await savePendingMvTimelines(filtered);
  }
}

export async function clearPendingMvTimelines(): Promise<void> {
  await savePendingMvTimelines([]);
}

export async function matchAndConsumePendingMvTimeline(candidate: {
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string;
  fileName?: string;
  mvTitle?: string;
  fileSizeBytes?: number;
  durationSec?: number;
}): Promise<PendingMvTimelineRecord | null> {
  const pending = await loadPendingMvTimelines();
  if (pending.length === 0) return null;

  const candFile = normalizeMatchText(candidate.fileName);
  const candStem = stripFileExtension(candidate.fileName);
  const candMvTitle = normalizeMatchText(candidate.mvTitle) || candStem;
  const candTrackTitle = normalizeMatchText(candidate.trackTitle);
  const candTrackArtist = normalizeMatchText(candidate.trackArtist);

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const pFile = normalizeMatchText(p.fileName);
    const pStem = stripFileExtension(p.fileName);
    const pMvTitle = normalizeMatchText(p.mvTitle) || pStem;
    const pTrackTitle = normalizeMatchText(p.trackTitle);
    const pTrackArtist = normalizeMatchText(p.trackArtist);

    const exactFileMatch = Boolean(candFile && pFile && candFile === pFile);
    const exactSizeMatch = Boolean(
      candidate.fileSizeBytes &&
        p.fileSizeBytes &&
        candidate.fileSizeBytes > 0 &&
        candidate.fileSizeBytes === p.fileSizeBytes
    );
    const stemMatch = Boolean(candStem && pStem && candStem === pStem);

    // Avoid cross-song mismatches when uploading an unrelated file onto a different track
    if (
      !exactFileMatch &&
      !exactSizeMatch &&
      pTrackTitle &&
      candTrackTitle &&
      pTrackTitle !== candTrackTitle
    ) {
      continue;
    }

    let score = 0;
    if (exactFileMatch) score += 100;
    else if (stemMatch) score += 65;

    if (exactSizeMatch) score += 80;

    const exactTrackMatch = Boolean(
      candidate.trackId && p.trackId && candidate.trackId === p.trackId
    );
    const exactTrackTitleMatch = Boolean(
      candTrackTitle && pTrackTitle && candTrackTitle === pTrackTitle
    );

    if (exactTrackMatch) {
      score += 55;
    }

    if (exactTrackTitleMatch) {
      if (!pTrackArtist || !candTrackArtist || pTrackArtist === candTrackArtist) {
        score += 60;
      } else {
        score += 45;
      }
    }

    if (candMvTitle && pMvTitle && candMvTitle === pMvTitle) {
      score += 35;
    } else if (
      candTrackTitle &&
      pMvTitle &&
      (pMvTitle.includes(candTrackTitle) || candTrackTitle.includes(pMvTitle))
    ) {
      score += 25;
    }

    if (
      candidate.durationSec &&
      p.durationSec &&
      candidate.durationSec > 0 &&
      p.durationSec > 0 &&
      Math.abs(candidate.durationSec - p.durationSec) <= 2.5
    ) {
      score += 25;
    }

    const qualified =
      exactFileMatch ||
      exactSizeMatch ||
      exactTrackMatch ||
      exactTrackTitleMatch ||
      score >= 55;

    if (qualified && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  const matched = pending[bestIdx];
  const remaining = pending.filter((_, idx) => idx !== bestIdx);
  await savePendingMvTimelines(remaining);
  return matched;
}


