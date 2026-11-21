import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { parseAudioFileToTrack } from '../services/audioMetadata';
import {
  clearAllMusicData,
  deleteMvById,
  deletePlaylistById,
  deleteTrackById,
  deleteTrackStems,
  getAllMvMetas,
  getAllPlaylists,
  getAllStemMetas,
  getAllTracks,
  getAudioBlob,
  getMvRecordById,
  getTrackMvs,
  getTrackStems,
  hasInitializedDemo,
  loadAudioSettings,
  loadPendingMvTimelines,
  loadPersonalization,
  loadPlaybackPrefs,
  markDemoInitialized,
  matchAndConsumePendingMvTimeline,
  removePendingMvTimelineById,
  requestPersistentStorage,
  saveAudioSettings,
  savePersonalization,
  savePlaybackPrefs,
  savePlaylist,
  saveTrackMv,
  saveTrackWithBlob,
  setActiveTrackMv,
  updateMvRecordMeta,
  updateTrackMetadata,
} from '../services/storage';
import {
  AudioDspSettings,
  MvMidBreakRange,
  MvTheaterPhase,
  NavPage,
  PendingMvTimelineRecord,
  PersonalizationSettings,
  Playlist,
  RepeatMode,
  SeparationEngineMode,
  TrackColorPalette,
  TrackMetadata,
  TrackMvMeta,
  TrackMvRecord,
  TrackStemsMeta,
} from '../types/music';
import {
  extractPaletteFromImage,
  resizeCoverToDataUrl,
} from '../utils/colorExtractor';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_PALETTE,
  DEFAULT_PERSONALIZATION,
} from '../utils/constants';
import { generateDemoTracks } from '../utils/demoAudioGenerator';
import {
  LyricTargetLanguage,
  translateLyricsToBilingual,
} from '../utils/lrcParser';
import {
  computeSyncedMvTime,
  computeTheaterVisualState,
  createDefaultMvTimeline,
  findTriggeredMidBreak,
  getCompletedBreakIdsForAudioSeek,
  MV_CMD_STORAGE_KEY,
  MV_SYNC_CHANNEL_NAME,
  MV_SYNC_STORAGE_KEY,
  MvBlobResponseMessage,
  MvRemoteCommand,
  MvSyncSnapshot,
  probeVideoDuration,
} from '../utils/mvTimeline';

const THEME_PALETTES: Record<string, TrackColorPalette> = {
  burgundy: {
    primary: '#e8437f',
    secondary: '#9d2c6b',
    deep: '#1a050d',
    rgbPrimary: [232, 67, 127],
    rgbSecondary: [157, 44, 107],
  },
  violet: {
    primary: '#a855f7',
    secondary: '#ec4899',
    deep: '#150723',
    rgbPrimary: [168, 85, 247],
    rgbSecondary: [236, 72, 153],
  },
  emerald: {
    primary: '#10b981',
    secondary: '#06b6d4',
    deep: '#051916',
    rgbPrimary: [16, 185, 129],
    rgbSecondary: [6, 182, 212],
  },
};

interface MusicContextValue {
  activePage: NavPage;
  setActivePage: (p: NavPage) => void;
  tracks: TrackMetadata[];
  playlists: Playlist[];
  queueIds: string[];
  currentTrack: TrackMetadata | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  shufflePlayedIds: string[];
  repeat: RepeatMode;
  isQueueOpen: boolean;
  setIsQueueOpen: (open: boolean) => void;
  showLyricsInPlayer: boolean;
  setShowLyricsInPlayer: (show: boolean) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  audioSettings: AudioDspSettings;
  personalization: PersonalizationSettings;
  activePalette: TrackColorPalette;
  isImporting: boolean;
  importProgress: string | null;
  toastMessage: string | null;
  showToast: (msg: string) => void;

  // Playback controls
  playTrackById: (id: string, customQueue?: string[]) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  playNext: (manual?: boolean) => Promise<void>;
  playPrev: () => Promise<void>;
  seekTo: (timeSec: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  // Queue operations
  enqueueTrack: (id: string) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;

  // Library & Metadata
  importLocalFiles: (files: FileList | File[]) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  deleteTrack: (id: string) => Promise<void>;
  updateTrackInfo: (
    id: string,
    patch: { title: string; artist: string; album?: string }
  ) => Promise<void>;
  updateTrackCover: (id: string, imageFile: File) => Promise<void>;
  updateTrackLyrics: (id: string, lyricsRaw: string) => Promise<void>;
  translateTrackLyrics: (
    id: string,
    targetLanguage?: LyricTargetLanguage,
    style?: string,
    providerId?: string,
    modelName?: string
  ) => Promise<void>;
  isTranslatingLyrics: boolean;
  updateLyricsOffset: (id: string, offsetMs: number) => Promise<void>;
  loadDemoLibrary: () => Promise<void>;
  resetLibrary: () => Promise<void>;

  // Playlists
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  playPlaylist: (playlistId: string, startTrackId?: string) => Promise<void>;

  // Settings
  updateAudioSettings: (patch: Partial<AudioDspSettings>) => void;
  resetAudioSettings: () => void;
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void;

  // Stem Cache & Decoupled Playback Sync (task execution lives in TaskCenterContext)
  stemMetas: Record<string, TrackStemsMeta>;
  currentTrackStemMeta: TrackStemsMeta | null;
  separationEngineMode: SeparationEngineMode;
  setSeparationEngineMode: (mode: SeparationEngineMode) => void;
  refreshStemMetas: (
    updatedTrackId?: string,
    autoEnableIfLoaded?: boolean
  ) => Promise<void>;
  importTrackAndStemsToPlayer: (trackId: string) => Promise<void>;
  pauseMainPlayer: () => void;
  removeTrackStems: (trackId: string) => Promise<void>;
  reloadAllLibraryData: () => Promise<void>;

  // MV Library & Theater Timeline Sync
  trackMvs: TrackMvMeta[];
  allMvCountByTrack: Record<string, number>;
  pendingMvTimelines: PendingMvTimelineRecord[];
  activeMv: TrackMvRecord | null;
  activeMvVideoUrl: string | null;
  mvPhase: MvTheaterPhase;
  mvPhaseTime: number;
  activeMidBreak: MvMidBreakRange | null;
  mvUiOpacity: number;
  mvTheaterClarity: boolean;
  mvVideoMuted: boolean;
  mvAudioGain: number;
  mvSkipLabel: string | null;
  mvSkipSubLabel: string | null;
  mvTargetTime: number;
  standaloneMvConnected: boolean;
  uploadTrackMvFile: (trackId: string, file: File) => Promise<TrackMvMeta>;
  bindTrackMvUrl: (trackId: string, url: string, title?: string) => Promise<TrackMvMeta>;
  selectActiveTrackMv: (trackId: string, mvId: string) => Promise<void>;
  updateTrackMvConfig: (mvId: string, patch: Partial<TrackMvMeta>) => Promise<void>;
  deleteTrackMv: (mvId: string) => Promise<void>;
  refreshPendingMvTimelines: () => Promise<void>;
  removePendingMvTimeline: (id: string) => Promise<void>;
  skipMvPhase: () => Promise<void>;
  restartTrackWithMvIntro: () => Promise<void>;
  seekMvTimeline: (mvTimeSec: number) => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activePage, setActivePage] = useState<NavPage>('player');
  const [tracks, setTracks] = useState<TrackMetadata[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [shufflePlayedIds, setShufflePlayedIds] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<RepeatMode>('all');

  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [showLyricsInPlayer, setShowLyricsInPlayer] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [audioSettings, setAudioSettings] = useState<AudioDspSettings>(
    DEFAULT_AUDIO_SETTINGS
  );
  const [personalization, setPersonalization] = useState<PersonalizationSettings>(
    DEFAULT_PERSONALIZATION
  );

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [isTranslatingLyrics, setIsTranslatingLyrics] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [stemMetas, setStemMetas] = useState<Record<string, TrackStemsMeta>>({});
  const [separationEngineMode, setSeparationEngineMode] =
    useState<SeparationEngineMode>('auto');

  // MV state
  const [trackMvs, setTrackMvs] = useState<TrackMvMeta[]>([]);
  const [allMvCountByTrack, setAllMvCountByTrack] = useState<Record<string, number>>({});
  const [pendingMvTimelines, setPendingMvTimelines] = useState<PendingMvTimelineRecord[]>([]);
  const [activeMv, setActiveMv] = useState<TrackMvRecord | null>(null);
  const [activeMvVideoUrl, setActiveMvVideoUrl] = useState<string | null>(null);
  const [mvPhase, setMvPhase] = useState<MvTheaterPhase>('normal');
  const [mvPhaseTime, setMvPhaseTime] = useState(0);
  const [activeMidBreak, setActiveMidBreak] = useState<MvMidBreakRange | null>(null);
  const [standaloneMvConnected, setStandaloneMvConnected] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef<number>(0);
  const mvObjectUrlRef = useRef<string | null>(null);
  const mvPhaseRef = useRef<MvTheaterPhase>('normal');
  const mvPhaseTimeRef = useRef<number>(0);
  const activeMidBreakRef = useRef<MvMidBreakRange | null>(null);
  const activeMvRef = useRef<TrackMvRecord | null>(null);
  const completedBreakIdsRef = useRef<Set<string>>(new Set());
  const introDoneForPlayRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const standaloneHeartbeatAtRef = useRef<number>(0);
  const mvChannelRef = useRef<BroadcastChannel | null>(null);
  const standaloneWindowsRef = useRef<Set<Window>>(new Set());
  const outroStartMvSecRef = useRef<number>(0);
  const allowIntroTailCrossfadeRef = useRef<boolean>(true);
  const lastLiveSnapAtRef = useRef<number>(0);
  const shufflePlayedIdsRef = useRef<Set<string>>(new Set());
  const shuffleHistoryRef = useRef<string[]>([]);

  const syncShufflePlayedState = useCallback(() => {
    setShufflePlayedIds(Array.from(shufflePlayedIdsRef.current));
  }, []);

  mvPhaseRef.current = mvPhase;
  activeMidBreakRef.current = activeMidBreak;
  activeMvRef.current = activeMv;
  isPlayingRef.current = isPlaying;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3400);
  }, []);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) || null,
    [tracks, currentTrackId]
  );

  const currentTrackStemMeta = useMemo(
    () => (currentTrackId ? stemMetas[currentTrackId] || null : null),
    [currentTrackId, stemMetas]
  );

  const activePalette = useMemo<TrackColorPalette>(() => {
    if (personalization.themePreset !== 'adaptive') {
      return THEME_PALETTES[personalization.themePreset] || DEFAULT_PALETTE;
    }
    if (personalization.followCoverColor && currentTrack?.palette) {
      return currentTrack.palette;
    }
    return DEFAULT_PALETTE;
  }, [personalization, currentTrack]);

  // Keep CSS variables updated with active palette
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--lumina-accent', activePalette.primary);
    root.style.setProperty('--lumina-secondary', activePalette.secondary);
    root.style.setProperty('--lumina-bg-deep', activePalette.deep);
  }, [activePalette]);

  // Refs for latest state inside audio event listeners
  const stateRef = useRef({
    tracks,
    queueIds,
    currentTrackId,
    shuffle,
    repeat,
  });
  stateRef.current = { tracks, queueIds, currentTrackId, shuffle, repeat };

  const mvPrefsRef = useRef({
    mvBackgroundEnabled: personalization.mvBackgroundEnabled !== false,
    mvStandaloneOnly: Boolean(personalization.mvStandaloneOnly),
    volume,
    muted,
  });
  mvPrefsRef.current = {
    mvBackgroundEnabled: personalization.mvBackgroundEnabled !== false,
    mvStandaloneOnly: Boolean(personalization.mvStandaloneOnly),
    volume,
    muted,
  };

  const refreshAllMvCounts = useCallback(async () => {
    const allMetas = await getAllMvMetas();
    const counts: Record<string, number> = {};
    for (const m of allMetas) {
      counts[m.trackId] = (counts[m.trackId] || 0) + 1;
    }
    setAllMvCountByTrack(counts);
  }, []);

  const syncTrackMvsForTrack = useCallback(
    async (trackId: string | null): Promise<TrackMvRecord | null> => {
      if (!trackId) {
        if (mvObjectUrlRef.current) {
          URL.revokeObjectURL(mvObjectUrlRef.current);
          mvObjectUrlRef.current = null;
        }
        setTrackMvs([]);
        setActiveMv(null);
        setActiveMvVideoUrl(null);
        return null;
      }

      const records = await getTrackMvs(trackId);
      const metas: TrackMvMeta[] = records.map(({ videoBlob: _b, ...meta }) => meta);
      setTrackMvs(metas);
      setAllMvCountByTrack((prev) => ({
        ...prev,
        [trackId]: metas.length,
      }));

      const chosen = records.find((r) => r.isActive) || records[0] || null;
      setActiveMv(chosen);

      if (mvObjectUrlRef.current) {
        URL.revokeObjectURL(mvObjectUrlRef.current);
        mvObjectUrlRef.current = null;
      }

      if (chosen?.videoBlob) {
        const objUrl = URL.createObjectURL(chosen.videoBlob);
        mvObjectUrlRef.current = objUrl;
        setActiveMvVideoUrl(objUrl);
      } else if (chosen?.externalUrl) {
        setActiveMvVideoUrl(chosen.externalUrl);
      } else {
        setActiveMvVideoUrl(null);
      }

      return chosen;
    },
    []
  );

  // Sync MV list & blob URL whenever currentTrackId changes
  useEffect(() => {
    syncTrackMvsForTrack(currentTrackId).catch(() => {});
  }, [currentTrackId, syncTrackMvsForTrack]);

  // Revoke MV blob URL on unmount
  useEffect(() => {
    return () => {
      if (mvObjectUrlRef.current) {
        URL.revokeObjectURL(mvObjectUrlRef.current);
        mvObjectUrlRef.current = null;
      }
    };
  }, []);

  const loadBlobIntoEngine = useCallback(
    async (
      track: TrackMetadata,
      autoplay: boolean,
      options?: { suppressAutoplay?: boolean }
    ) => {
      const seq = ++loadSeqRef.current;
      setCurrentTrackId(track.id);
      audioEngine.pause();
      const blob = await getAudioBlob(track.id);
      if (loadSeqRef.current !== seq) return;
      if (!blob || blob.size === 0) {
        showToast('未找到音频文件数据，请重新导入该歌曲');
        return;
      }
      audioEngine.loadBlob(blob);
      loadedTrackIdRef.current = track.id;
      setCurrentTime(0);
      setDuration(track.duration || 0);

      // Hydrate cached AI-separated stems if available for this track
      getTrackStems(track.id)
        .then((stems) => {
          if (stems && loadedTrackIdRef.current === track.id) {
            return audioEngine.loadStems(
              track.id,
              stems.vocalBlob,
              stems.instrumentalBlob
            );
          }
        })
        .catch((err) => {
          console.warn('Failed to hydrate cached stems:', err);
        });

      if (autoplay && !options?.suppressAutoplay) {
        try {
          await audioEngine.play();
          setIsPlaying(true);
        } catch (err) {
          console.warn('Autoplay blocked until gesture:', err);
          setIsPlaying(false);
        }
      }
    },
    [showToast]
  );

  const playTrackById = useCallback(
    async (
      id: string,
      customQueue?: string[],
      internalOpts?: { fromShuffleCycle?: boolean }
    ) => {
      const target = stateRef.current.tracks.find((t) => t.id === id);
      if (!target) return;

      setCurrentTrackId(id); // Immediate UI & album cover popup update

      if (customQueue) {
        setQueueIds(customQueue);
        // New explicit queue starts a fresh shuffle cycle starting from this track
        shufflePlayedIdsRef.current = new Set([id]);
        shuffleHistoryRef.current = [id];
        syncShufflePlayedState();
      } else {
        if (!stateRef.current.queueIds.includes(id)) {
          setQueueIds((prev) => (prev.length > 0 ? [...prev, id] : [id]));
        }
        if (!internalOpts?.fromShuffleCycle && stateRef.current.shuffle) {
          shufflePlayedIdsRef.current.add(id);
          if (
            shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1] !== id
          ) {
            shuffleHistoryRef.current = [...shuffleHistoryRef.current, id].slice(
              -200
            );
          }
          syncShufflePlayedState();
        }
      }

      savePlaybackPrefs({
        volume,
        muted,
        shuffle: stateRef.current.shuffle,
        repeat: stateRef.current.repeat,
        lastTrackId: id,
      }).catch(() => {});

      completedBreakIdsRef.current.clear();
      introDoneForPlayRef.current = false;
      setActiveMidBreak(null);

      const chosenMv = await syncTrackMvsForTrack(id);
      const shouldStartIntro = Boolean(
        mvPrefsRef.current.mvBackgroundEnabled &&
          chosenMv?.timeline.introEnabled &&
          (chosenMv.timeline.introEndSec || 0) > 0.5
      );

      if (shouldStartIntro) {
        audioEngine.resumeContext().catch(() => {});
        audioEngine.pause();
        audioEngine.setTheaterMixGains(0, 1, 0.005);
        if (loadedTrackIdRef.current !== id || !audioEngine.element.src) {
          await loadBlobIntoEngine(target, false, { suppressAutoplay: true });
        } else {
          audioEngine.seek(0);
          setCurrentTime(0);
        }
        allowIntroTailCrossfadeRef.current = true;
        audioEngine.primeForDelayedPlayback().catch(() => {});
        mvPhaseTimeRef.current = 0;
        setMvPhase('intro');
        setMvPhaseTime(0);
        setIsPlaying(true);
        return;
      }

      allowIntroTailCrossfadeRef.current = false;
      audioEngine.setTheaterMixGains(1, 0, 0.008);
      setMvPhase('normal');
      mvPhaseTimeRef.current = 0;
      setMvPhaseTime(0);

      if (loadedTrackIdRef.current === id && audioEngine.element.src) {
        audioEngine.seek(0);
        setCurrentTime(0);
        try {
          await audioEngine.play();
          setIsPlaying(true);
        } catch (err) {
          console.warn('Track playback failed:', err);
          setIsPlaying(false);
        }
      } else {
        await loadBlobIntoEngine(target, true);
      }
    },
    [loadBlobIntoEngine, muted, syncShufflePlayedState, syncTrackMvsForTrack, volume]
  );

  const playNext = useCallback(
    async (manual = true) => {
      const { queueIds: q, tracks: all, currentTrackId: curId, shuffle: shuf, repeat: rep } =
        stateRef.current;
      const list = q.length > 0 ? q : all.map((t) => t.id);
      if (list.length === 0) return;

      if (!manual && rep === 'one' && curId) {
        await playTrackById(curId, undefined, { fromShuffleCycle: true });
        return;
      }

      const curIdx = curId ? list.indexOf(curId) : -1;
      let nextIdx = 0;

      if (shuf && list.length > 1) {
        // Ensure the currently playing track is marked as played in this cycle
        if (curId && list.includes(curId)) {
          shufflePlayedIdsRef.current.add(curId);
        }

        // Remove stale IDs no longer present in the active queue
        const listSet = new Set(list);
        for (const pid of Array.from(shufflePlayedIdsRef.current)) {
          if (!listSet.has(pid)) {
            shufflePlayedIdsRef.current.delete(pid);
          }
        }

        let remaining = list.filter(
          (id) => !shufflePlayedIdsRef.current.has(id)
        );

        if (remaining.length === 0) {
          // Every song in the current queue has been randomly played once
          if (!manual && rep === 'off') {
            shufflePlayedIdsRef.current.clear();
            syncShufflePlayedState();
            audioEngine.pause();
            audioEngine.seek(0);
            setMvPhase('normal');
            setActiveMidBreak(null);
            setIsPlaying(false);
            showToast('本队列全部歌曲已随机播放完毕');
            return;
          }

          // Reset for a brand new shuffle round across the full queue
          // Avoid immediate back-to-back repeat of the last song when starting round N+1
          shufflePlayedIdsRef.current.clear();
          remaining = list.filter((id) => id !== curId);
          if (remaining.length === 0) remaining = list;
          showToast('本队列全部歌曲已随机完成，已开启新一轮全队列随机');
        }

        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        shufflePlayedIdsRef.current.add(pick);
        if (
          shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1] !==
          pick
        ) {
          shuffleHistoryRef.current = [...shuffleHistoryRef.current, pick].slice(
            -200
          );
        }
        syncShufflePlayedState();
        await playTrackById(pick, undefined, { fromShuffleCycle: true });
        return;
      } else {
        nextIdx = curIdx + 1;
        if (nextIdx >= list.length) {
          if (!manual && rep === 'off') {
            audioEngine.pause();
            audioEngine.seek(0);
            setMvPhase('normal');
            setActiveMidBreak(null);
            setIsPlaying(false);
            return;
          }
          nextIdx = 0;
        }
      }

      await playTrackById(list[nextIdx]);
    },
    [playTrackById, showToast, syncShufflePlayedState]
  );

  const playPrev = useCallback(async () => {
    if (mvPhaseRef.current === 'normal' && audioEngine.element.currentTime > 3) {
      completedBreakIdsRef.current.clear();
      setActiveMidBreak(null);
      audioEngine.seek(0);
      setCurrentTime(0);
      return;
    }
    if (mvPhaseRef.current === 'mid-break' || mvPhaseRef.current === 'outro') {
      if (stateRef.current.currentTrackId) {
        await playTrackById(stateRef.current.currentTrackId, undefined, {
          fromShuffleCycle: true,
        });
        return;
      }
    }
    const { queueIds: q, tracks: all, currentTrackId: curId, shuffle: shuf } =
      stateRef.current;
    const list = q.length > 0 ? q : all.map((t) => t.id);
    if (list.length === 0) return;

    if (shuf && shuffleHistoryRef.current.length > 1) {
      const listSet = new Set(list);
      const nextHist = [...shuffleHistoryRef.current];
      // Pop current track from history top
      if (nextHist[nextHist.length - 1] === curId) {
        nextHist.pop();
      }
      while (nextHist.length > 0) {
        const candidate = nextHist[nextHist.length - 1];
        if (candidate && candidate !== curId && listSet.has(candidate)) {
          shuffleHistoryRef.current = nextHist;
          await playTrackById(candidate, undefined, { fromShuffleCycle: true });
          return;
        }
        nextHist.pop();
      }
      shuffleHistoryRef.current = nextHist;
    }

    const curIdx = curId ? list.indexOf(curId) : 0;
    const prevIdx = (curIdx - 1 + list.length) % list.length;
    await playTrackById(list[prevIdx]);
  }, [playTrackById]);

  const togglePlayPause = useCallback(async () => {
    const el = audioEngine.element;
    if (!currentTrack && tracks.length > 0) {
      await playTrackById(tracks[0].id, tracks.map((t) => t.id));
      return;
    }
    if (!currentTrack) {
      showToast('请先在「我的音乐」中导入本地歌曲');
      return;
    }

    // During intro / mid-break / outro, transport toggles MV theater clock cleanly
    if (mvPhaseRef.current !== 'normal') {
      setIsPlaying((prev) => !prev);
      return;
    }

    // Starting fresh at 0:00 when intro is enabled & not yet completed
    if (
      el.paused &&
      (el.currentTime || 0) < 0.25 &&
      !introDoneForPlayRef.current &&
      mvPrefsRef.current.mvBackgroundEnabled &&
      activeMvRef.current?.timeline.introEnabled &&
      (activeMvRef.current.timeline.introEndSec || 0) > 0.5
    ) {
      audioEngine.resumeContext().catch(() => {});
      audioEngine.setTheaterMixGains(0, 1, 0.005);
      allowIntroTailCrossfadeRef.current = true;
      audioEngine.primeForDelayedPlayback().catch(() => {});
      mvPhaseTimeRef.current = 0;
      setMvPhase('intro');
      setMvPhaseTime(0);
      setIsPlaying(true);
      return;
    }

    if (el.paused) {
      if (loadedTrackIdRef.current !== currentTrack.id || !el.src) {
        await loadBlobIntoEngine(currentTrack, true);
      } else {
        try {
          await audioEngine.play();
        } catch (err) {
          console.warn('Playback toggle failed:', err);
          setIsPlaying(false);
        }
      }
    } else {
      audioEngine.pause();
    }
  }, [currentTrack, tracks, playTrackById, loadBlobIntoEngine, showToast]);

  // Initial hydrate from IndexedDB
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const [loadedAudio, loadedPers, loadedPrefs] = await Promise.all([
        loadAudioSettings(),
        loadPersonalization(),
        loadPlaybackPrefs(),
      ]);
      if (cancelled) return;

      setAudioSettings(loadedAudio);
      audioEngine.applySettings(loadedAudio);
      setPersonalization(loadedPers);
      setVolumeState(loadedPrefs.volume);
      setMuted(loadedPrefs.muted);
      setShuffle(loadedPrefs.shuffle);
      setRepeat(loadedPrefs.repeat);
      audioEngine.setVolume(loadedPrefs.volume, loadedPrefs.muted);

      let existingTracks = await getAllTracks();
      const seeded = await hasInitializedDemo();

      if (existingTracks.length === 0 && !seeded) {
        try {
          const demos = await generateDemoTracks();
          for (const d of demos) {
            await saveTrackWithBlob(d.track, d.blob);
          }
          await markDemoInitialized();
          existingTracks = await getAllTracks();
        } catch (err) {
          console.warn('Demo seed skipped:', err);
        }
      }

      if (cancelled) return;
      const [existingPlaylists, existingStemMetas, existingMvMetas, existingPendingMvs] =
        await Promise.all([
          getAllPlaylists(),
          getAllStemMetas(),
          getAllMvMetas(),
          loadPendingMvTimelines(),
        ]);
      if (cancelled) return;

      const metaMap: Record<string, TrackStemsMeta> = {};
      for (const m of existingStemMetas) {
        metaMap[m.trackId] = m;
      }

      const mvCountMap: Record<string, number> = {};
      for (const mv of existingMvMetas) {
        mvCountMap[mv.trackId] = (mvCountMap[mv.trackId] || 0) + 1;
      }

      setTracks(existingTracks);
      setPlaylists(existingPlaylists);
      setStemMetas(metaMap);
      setAllMvCountByTrack(mvCountMap);
      setPendingMvTimelines(existingPendingMvs);
      setQueueIds(existingTracks.map((t) => t.id));

      const preferred =
        existingTracks.find((t) => t.id === loadedPrefs.lastTrackId) ||
        existingTracks[0];

      if (preferred) {
        if (loadedPrefs.shuffle) {
          shufflePlayedIdsRef.current = new Set([preferred.id]);
          shuffleHistoryRef.current = [preferred.id];
          setShufflePlayedIds([preferred.id]);
        }
        await loadBlobIntoEngine(preferred, false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [loadBlobIntoEngine]);

  // Bind HTMLAudioElement listeners (respecting MV theater phase)
  useEffect(() => {
    const el = audioEngine.element;

    const onPlay = () => {
      if (audioEngine.isPriming) return;
      setIsPlaying(true);
    };
    const onPause = () => {
      if (audioEngine.isPriming) return;
      if (mvPhaseRef.current === 'normal') {
        setIsPlaying(false);
      }
    };
    const onTimeUpdate = () => {
      if (audioEngine.isPriming) return;
      setCurrentTime(el.currentTime || 0);
    };
    const onLoadedMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };
    const onEnded = () => {
      const mv = activeMvRef.current;
      if (
        mvPrefsRef.current.mvBackgroundEnabled &&
        mv &&
        mv.timeline.outroEnabled
      ) {
        const audioDur =
          Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
        const curMv = computeSyncedMvTime(
          audioDur,
          mv.timeline,
          completedBreakIdsRef.current
        );
        const outroEnd = mv.timeline.outroEndSec || mv.durationSec || 0;
        if (outroEnd > curMv + 0.5) {
          outroStartMvSecRef.current = curMv;
          mvPhaseTimeRef.current = curMv;
          setMvPhase('outro');
          setMvPhaseTime(curMv);
          setIsPlaying(true);
          return;
        }
      }
      playNext(false);
    };
    const onError = () => {
      if (mvPhaseRef.current === 'normal') {
        setIsPlaying(false);
        showToast('当前音频解码失败，可能不受此浏览器支持');
      }
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMeta);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMeta);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [playNext, showToast]);

  // Media Session API for Android Chrome hardware/lockscreen controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      artwork: currentTrack.coverDataUrl
        ? [{ src: currentTrack.coverDataUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
    navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext(true));
  }, [currentTrack, togglePlayPause, playPrev, playNext]);

  // MV Theater Timeline RAF Clock & Mid-Break Trigger Loop
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastStamp = performance.now();
    let lastUiSync = 0;
    let lastCrossfadeUiSync = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.25, Math.max(0, (now - lastStamp) / 1000));
      lastStamp = now;

      const phase = mvPhaseRef.current;
      const mv = activeMvRef.current;
      let phaseTransitioned = false;

      if (phase === 'intro' && mv) {
        const nextMvT = mvPhaseTimeRef.current + dt;
        mvPhaseTimeRef.current = nextMvT;
        const endSec = mv.timeline.introEndSec || 0;
        if (nextMvT >= endSec) {
          introDoneForPlayRef.current = true;
          allowIntroTailCrossfadeRef.current = true;
          mvPhaseRef.current = 'normal';
          setMvPhase('normal');
          setMvPhaseTime(endSec);
          audioEngine.seek(0);
          setCurrentTime(0);
          audioEngine.play().catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.warn('Transition from MV intro to song audio failed:', err);
            setIsPlaying(false);
          });
          phaseTransitioned = true;
        } else if (now - lastUiSync >= 50) {
          lastUiSync = now;
          setMvPhaseTime(nextMvT);
        }
      } else if (phase === 'mid-break' && mv && activeMidBreakRef.current) {
        const brk = activeMidBreakRef.current;
        const nextMvT = mvPhaseTimeRef.current + dt;
        mvPhaseTimeRef.current = nextMvT;
        if (nextMvT >= brk.mvEndSec) {
          completedBreakIdsRef.current.add(brk.id);
          mvPhaseRef.current = 'normal';
          activeMidBreakRef.current = null;
          setMvPhase('normal');
          setActiveMidBreak(null);
          setMvPhaseTime(brk.mvEndSec);
          audioEngine.seek(brk.audioTriggerSec + 0.02);
          setCurrentTime(brk.audioTriggerSec + 0.02);
          audioEngine.play().catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.warn('Transition from MV mid-break to song audio failed:', err);
            setIsPlaying(false);
          });
          phaseTransitioned = true;
        } else if (now - lastUiSync >= 50) {
          lastUiSync = now;
          setMvPhaseTime(nextMvT);
        }
      } else if (phase === 'outro' && mv) {
        const nextMvT = mvPhaseTimeRef.current + dt;
        mvPhaseTimeRef.current = nextMvT;
        const endSec = mv.timeline.outroEndSec || mv.durationSec || 0;
        if (endSec > 0 && nextMvT >= endSec) {
          mvPhaseRef.current = 'normal';
          setMvPhase('normal');
          playNext(false);
          return;
        }
        if (now - lastUiSync >= 50) {
          lastUiSync = now;
          setMvPhaseTime(nextMvT);
        }
      } else if (phase === 'normal' && mv && mvPrefsRef.current.mvBackgroundEnabled) {
        const audioT = audioEngine.element.currentTime || 0;
        const brk = findTriggeredMidBreak(
          audioT,
          mv.timeline,
          completedBreakIdsRef.current
        );
        if (brk) {
          audioEngine.pause();
          audioEngine.seek(brk.audioTriggerSec);
          setCurrentTime(brk.audioTriggerSec);
          mvPhaseRef.current = 'mid-break';
          activeMidBreakRef.current = brk;
          mvPhaseTimeRef.current = brk.mvStartSec;
          setMvPhase('mid-break');
          setActiveMidBreak(brk);
          setMvPhaseTime(brk.mvStartSec);
          setIsPlaying(true);
          phaseTransitioned = true;
        }
      }

      // Apply 60fps smooth equal-power crossfade gains directly on AudioEngine GainNodes
      if (mv && mvPrefsRef.current.mvBackgroundEnabled) {
        const elDur =
          Number.isFinite(audioEngine.element.duration) && audioEngine.element.duration > 0
            ? audioEngine.element.duration
            : 0;
        const liveAudioT = audioEngine.element.currentTime || 0;
        const vis = computeTheaterVisualState({
          phase: mvPhaseRef.current,
          mvPhaseTime: mvPhaseTimeRef.current,
          timeline: mv.timeline,
          activeMidBreak: activeMidBreakRef.current,
          audioTime: liveAudioT,
          audioDuration: elDur,
          mvDurationSec: mv.durationSec,
          completedBreakIds: completedBreakIdsRef.current,
          outroStartMvSec: outroStartMvSecRef.current,
          allowIntroTailCrossfade: allowIntroTailCrossfadeRef.current,
        });
        audioEngine.setTheaterMixGains(vis.songAudioGain, vis.mvAudioGain, 0.015);

        // During crossfade overlaps in normal phase, update React currentTime smoothly (~25fps)
        // instead of waiting 250ms for HTMLAudioElement timeupdate
        const inCrossfade =
          mvPhaseRef.current === 'normal' &&
          vis.mvAudioGain > 0.002 &&
          vis.songAudioGain < 0.998;
        if (inCrossfade && now - lastCrossfadeUiSync >= 38) {
          lastCrossfadeUiSync = now;
          setCurrentTime(liveAudioT);
        }
        if (phaseTransitioned || (inCrossfade && now - lastLiveSnapAtRef.current >= 38)) {
          lastLiveSnapAtRef.current = now;
          publishMvSyncSnapshotRef.current?.();
        }
      } else {
        audioEngine.setTheaterMixGains(1, 0, 0.018);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playNext]);

  const seekTo = useCallback((timeSec: number) => {
    const mv = activeMvRef.current;
    allowIntroTailCrossfadeRef.current = false;
    if (mvPhaseRef.current !== 'normal') {
      mvPhaseRef.current = 'normal';
      setMvPhase('normal');
      setActiveMidBreak(null);
    }
    if (mv) {
      completedBreakIdsRef.current = getCompletedBreakIdsForAudioSeek(
        timeSec,
        mv.timeline
      );
      introDoneForPlayRef.current = true;
    }
    audioEngine.seek(timeSec);
    setCurrentTime(timeSec);
    audioEngine.setTheaterMixGains(1, 0, 0.012);
  }, []);

  const seekMvTimeline = useCallback((mvTimeSec: number) => {
    const mv = activeMvRef.current;
    const targetMvT = Math.max(0, Number.isFinite(mvTimeSec) ? mvTimeSec : 0);
    if (!mv) {
      audioEngine.seek(targetMvT);
      setCurrentTime(targetMvT);
      return;
    }

    const tl = mv.timeline;
    const audioDur =
      Number.isFinite(audioEngine.element.duration) && audioEngine.element.duration > 0
        ? audioEngine.element.duration
        : stateRef.current.tracks.find((t) => t.id === stateRef.current.currentTrackId)
            ?.duration || 0;

    // 1. Inside Intro range
    if (tl.introEnabled && (tl.introEndSec || 0) > 0.5 && targetMvT < tl.introEndSec) {
      audioEngine.pause();
      audioEngine.seek(0);
      setCurrentTime(0);
      completedBreakIdsRef.current.clear();
      introDoneForPlayRef.current = false;
      mvPhaseRef.current = 'intro';
      activeMidBreakRef.current = null;
      mvPhaseTimeRef.current = targetMvT;
      setMvPhase('intro');
      setActiveMidBreak(null);
      setMvPhaseTime(targetMvT);
      return;
    }

    // 2. Inside a Mid-Break range
    const sortedBreaks = [...(tl.midBreaks || [])]
      .filter((b) => b.mvEndSec > b.mvStartSec + 0.3)
      .sort((a, b) => a.audioTriggerSec - b.audioTriggerSec);

    for (const brk of sortedBreaks) {
      if (targetMvT >= brk.mvStartSec && targetMvT < brk.mvEndSec) {
        const passed = new Set<string>();
        for (const prev of sortedBreaks) {
          if (prev.id === brk.id) break;
          passed.add(prev.id);
        }
        completedBreakIdsRef.current = passed;
        introDoneForPlayRef.current = true;
        audioEngine.pause();
        audioEngine.seek(brk.audioTriggerSec);
        setCurrentTime(brk.audioTriggerSec);
        mvPhaseRef.current = 'mid-break';
        activeMidBreakRef.current = brk;
        mvPhaseTimeRef.current = targetMvT;
        setMvPhase('mid-break');
        setActiveMidBreak(brk);
        setMvPhaseTime(targetMvT);
        return;
      }
    }

    // 3. Check Outro range (past end of song audio)
    const introOffset = tl.introEnabled && (tl.introEndSec || 0) > 0.3 ? tl.introEndSec : 0;
    const allBreakDur = sortedBreaks.reduce(
      (sum, b) => sum + (b.mvEndSec - b.mvStartSec),
      0
    );
    const songEndMvTime = introOffset + audioDur + allBreakDur;

    if (tl.outroEnabled && audioDur > 0 && targetMvT >= songEndMvTime) {
      audioEngine.pause();
      completedBreakIdsRef.current = new Set(sortedBreaks.map((b) => b.id));
      introDoneForPlayRef.current = true;
      mvPhaseRef.current = 'outro';
      activeMidBreakRef.current = null;
      mvPhaseTimeRef.current = targetMvT;
      setMvPhase('outro');
      setActiveMidBreak(null);
      setMvPhaseTime(targetMvT);
      return;
    }

    // 4. Normal aligned song segment
    let passedBreakOffset = 0;
    const completedSet = new Set<string>();
    for (const brk of sortedBreaks) {
      if (targetMvT >= brk.mvEndSec) {
        completedSet.add(brk.id);
        passedBreakOffset += brk.mvEndSec - brk.mvStartSec;
      }
    }
    const rawAudioT = targetMvT - introOffset - passedBreakOffset;
    const clampedAudioT = Math.max(
      0,
      audioDur > 0 ? Math.min(audioDur, rawAudioT) : rawAudioT
    );

    completedBreakIdsRef.current = completedSet;
    introDoneForPlayRef.current = true;
    mvPhaseRef.current = 'normal';
    activeMidBreakRef.current = null;
    mvPhaseTimeRef.current = targetMvT;
    setMvPhase('normal');
    setActiveMidBreak(null);
    setMvPhaseTime(targetMvT);
    audioEngine.seek(clampedAudioT);
    setCurrentTime(clampedAudioT);
    if (isPlayingRef.current && audioEngine.element.paused) {
      audioEngine.play().catch(() => {});
    }
  }, []);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(1, vol));
      setVolumeState(clamped);
      const nextMuted = clamped === 0;
      setMuted(nextMuted);
      audioEngine.setVolume(clamped, nextMuted);
      savePlaybackPrefs({
        volume: clamped,
        muted: nextMuted,
        shuffle,
        repeat,
        lastTrackId: currentTrackId || undefined,
      }).catch(() => {});
    },
    [shuffle, repeat, currentTrackId]
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    audioEngine.setVolume(volume, next);
  }, [muted, volume]);

  const toggleShuffle = useCallback(() => {
    setShuffle((prev) => {
      const next = !prev;
      if (next) {
        shufflePlayedIdsRef.current = new Set(
          currentTrackId ? [currentTrackId] : []
        );
        shuffleHistoryRef.current = currentTrackId ? [currentTrackId] : [];
        syncShufflePlayedState();
        showToast('已开启不重复随机：本队列全部歌曲听完前不会重复');
      } else {
        shufflePlayedIdsRef.current.clear();
        shuffleHistoryRef.current = [];
        syncShufflePlayedState();
        showToast('已关闭随机播放');
      }
      savePlaybackPrefs({
        volume,
        muted,
        shuffle: next,
        repeat,
        lastTrackId: currentTrackId || undefined,
      }).catch(() => {});
      return next;
    });
  }, [volume, muted, repeat, currentTrackId, showToast, syncShufflePlayedState]);

  const cycleRepeat = useCallback(() => {
    setRepeat((prev) => {
      const next: RepeatMode = prev === 'all' ? 'one' : prev === 'one' ? 'off' : 'all';
      savePlaybackPrefs({
        volume,
        muted,
        shuffle,
        repeat: next,
        lastTrackId: currentTrackId || undefined,
      }).catch(() => {});
      return next;
    });
  }, [volume, muted, shuffle, currentTrackId]);

  const enqueueTrack = useCallback(
    (id: string) => {
      setQueueIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      showToast('已添加到播放队列');
    },
    [showToast]
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueueIds((prev) => prev.filter((item) => item !== id));
      if (shufflePlayedIdsRef.current.delete(id)) {
        syncShufflePlayedState();
      }
      shuffleHistoryRef.current = shuffleHistoryRef.current.filter(
        (item) => item !== id
      );
    },
    [syncShufflePlayedState]
  );

  const clearQueue = useCallback(() => {
    setQueueIds(currentTrackId ? [currentTrackId] : []);
    shufflePlayedIdsRef.current = new Set(
      currentTrackId ? [currentTrackId] : []
    );
    shuffleHistoryRef.current = currentTrackId ? [currentTrackId] : [];
    syncShufflePlayedState();
  }, [currentTrackId, syncShufflePlayedState]);

  const importLocalFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        return (
          f.type.startsWith('audio/') ||
          ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'webm'].includes(ext)
        );
      });

      if (files.length === 0) {
        showToast('未检测到支持的音频文件 (MP3 / FLAC / WAV / AAC / M4A / OGG / OPUS)');
        return;
      }

      setIsImporting(true);
      let importedCount = 0;
      let overwrittenCount = 0;
      const newlyAdded: TrackMetadata[] = [];

      try {
        await requestPersistentStorage();
        const existingTracks = await getAllTracks();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setImportProgress(`正在解析 ${i + 1}/${files.length}: ${file.name}`);
          const track = await parseAudioFileToTrack(
            file,
            personalization.importMode || 'lean'
          );

          // Check if song already exists (duplicate detection by title + artist or duration + filesize)
          const normTitle = track.title.trim().toLowerCase();
          const normArtist = track.artist.trim().toLowerCase();
          const existing = existingTracks.find((t) => {
            const tTitle = t.title.trim().toLowerCase();
            const tArtist = t.artist.trim().toLowerCase();
            return (
              (tTitle === normTitle && tArtist === normArtist) ||
              (Math.abs(t.duration - track.duration) < 1.0 && t.fileSize === track.fileSize)
            );
          });

          if (existing) {
            // Overwrite existing track: preserve ID, favorite status, lyrics, addedAt
            track.id = existing.id;
            track.favorite = existing.favorite;
            track.lyricsRaw = track.lyricsRaw || existing.lyricsRaw;
            track.lyricsOffsetMs = existing.lyricsOffsetMs || existing.lyricsOffsetMs;
            track.addedAt = existing.addedAt;
            overwrittenCount++;
          }

          await saveTrackWithBlob(track, file);
          newlyAdded.push(track);
          importedCount++;
        }

        const refreshed = await getAllTracks();
        setTracks(refreshed);
        setQueueIds((prev) => {
          const addedIds = newlyAdded.map((t) => t.id);
          return Array.from(new Set([...prev, ...addedIds]));
        });

        if (!currentTrackId && newlyAdded.length > 0) {
          await loadBlobIntoEngine(newlyAdded[0], false);
        }

        showToast(
          `成功导入 ${importedCount} 首本地歌曲${
            overwrittenCount > 0 ? ` (已自动覆盖 ${overwrittenCount} 首重复歌曲)` : ''
          }`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入歌曲时发生错误';
        showToast(msg);
      } finally {
        setIsImporting(false);
        setImportProgress(null);
      }
    },
    [currentTrackId, loadBlobIntoEngine, showToast, personalization.importMode]
  );

  const toggleFavorite = useCallback(async (id: string) => {
    setTracks((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target) return prev;
      const updated = { ...target, favorite: !target.favorite };
      updateTrackMetadata(updated).catch(() => {});
      return prev.map((t) => (t.id === id ? updated : t));
    });
  }, []);

  const deleteTrack = useCallback(
    async (id: string) => {
      await deleteTrackById(id);
      await refreshAllMvCounts();
      setTracks((prev) => prev.filter((t) => t.id !== id));
      setStemMetas((prev) => {
        if (!prev[id]) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setQueueIds((prev) => prev.filter((qId) => qId !== id));
      if (shufflePlayedIdsRef.current.delete(id)) {
        syncShufflePlayedState();
      }
      shuffleHistoryRef.current = shuffleHistoryRef.current.filter(
        (hId) => hId !== id
      );
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (!pl.trackIds.includes(id)) return pl;
          const updatedPl = {
            ...pl,
            trackIds: pl.trackIds.filter((tid) => tid !== id),
            updatedAt: Date.now(),
          };
          savePlaylist(updatedPl).catch(() => {});
          return updatedPl;
        })
      );

      if (currentTrackId === id) {
        audioEngine.pause();
        audioEngine.clearStems();
        setIsPlaying(false);
        setCurrentTrackId(null);
        setMvPhase('normal');
        setActiveMidBreak(null);
        loadedTrackIdRef.current = null;
      }
      showToast('已从曲库删除歌曲');
    },
    [currentTrackId, refreshAllMvCounts, showToast]
  );

  const updateTrackInfo = useCallback(
    async (
      id: string,
      patch: { title: string; artist: string; album?: string }
    ) => {
      const target = stateRef.current.tracks.find((t) => t.id === id);
      if (!target) return;
      const nextTitle = patch.title.trim() || target.title;
      const nextArtist = patch.artist.trim() || '未知艺术家';
      const nextAlbum =
        patch.album !== undefined ? patch.album.trim() || '本地音乐' : target.album;
      const updated: TrackMetadata = {
        ...target,
        title: nextTitle,
        artist: nextArtist,
        album: nextAlbum,
      };
      await updateTrackMetadata(updated);
      setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      showToast('已更新歌曲名称与人物信息');
    },
    [showToast]
  );

  const updateTrackCover = useCallback(
    async (id: string, imageFile: File) => {
      const target = tracks.find((t) => t.id === id);
      if (!target) return;
      const coverDataUrl = await resizeCoverToDataUrl(imageFile);
      const palette = await extractPaletteFromImage(coverDataUrl);
      const updated = { ...target, coverDataUrl, palette };
      await updateTrackMetadata(updated);
      setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      showToast('专辑封面已更新并同步配色');
    },
    [tracks, showToast]
  );

  const updateTrackLyrics = useCallback(
    async (id: string, lyricsRaw: string) => {
      const target = tracks.find((t) => t.id === id);
      if (!target) return;
      const updated = { ...target, lyricsRaw };
      await updateTrackMetadata(updated);
      setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      showToast('歌词已保存');
    },
    [tracks, showToast]
  );

  const translateTrackLyrics = useCallback(
    async (
      id: string,
      targetLanguage: LyricTargetLanguage = 'zh-CN',
      style: string = 'poetic',
      providerId?: string,
      modelName?: string
    ) => {
      const target = tracks.find((t) => t.id === id);
      if (!target || !target.lyricsRaw) return;
      setIsTranslatingLyrics(true);
      try {
        const res = await translateLyricsToBilingual(
          target.lyricsRaw,
          target.title,
          target.artist,
          targetLanguage,
          style,
          providerId,
          modelName
        );
        if (res.translatedCount > 0) {
          const updated = { ...target, lyricsRaw: res.bilingualLyrics };
          await updateTrackMetadata(updated);
          setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
          setPersonalization((prev) => {
            if (prev.showBilingualLyrics) return prev;
            const next = { ...prev, showBilingualLyrics: true };
            savePersonalization(next).catch(() => {});
            return next;
          });
          const via = res.providerName ? ` (${res.providerName})` : '';
          showToast(`已完成 ${res.translatedCount} 行诗意双语翻译${via}`);
        } else if (res.skippedReason === 'already_bilingual') {
          showToast('当前歌词已包含双语译文');
        } else {
          showToast('当前歌词无需翻译或已为目标语言');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : '歌词翻译失败，请稍后重试');
      } finally {
        setIsTranslatingLyrics(false);
      }
    },
    [tracks, showToast]
  );

  const updateLyricsOffset = useCallback(
    async (id: string, offsetMs: number) => {
      const target = tracks.find((t) => t.id === id);
      if (!target) return;
      const updated = { ...target, lyricsOffsetMs: offsetMs };
      await updateTrackMetadata(updated);
      setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    },
    [tracks]
  );

  const loadDemoLibrary = useCallback(async () => {
    const demos = await generateDemoTracks();
    for (const d of demos) {
      await saveTrackWithBlob(d.track, d.blob);
    }
    const refreshed = await getAllTracks();
    setTracks(refreshed);
    setQueueIds(refreshed.map((t) => t.id));
    if (refreshed.length > 0 && !currentTrackId) {
      await loadBlobIntoEngine(refreshed[0], false);
    }
    showToast('已重新加载内置无损 WAV 示例曲目');
  }, [currentTrackId, loadBlobIntoEngine, showToast]);

  const resetLibrary = useCallback(async () => {
    audioEngine.pause();
    audioEngine.clearStems();
    setIsPlaying(false);
    setCurrentTrackId(null);
    loadedTrackIdRef.current = null;
    await clearAllMusicData();
    setTracks([]);
    setPlaylists([]);
    setStemMetas({});
    setTrackMvs([]);
    setAllMvCountByTrack({});
    setActiveMv(null);
    setActiveMvVideoUrl(null);
    setMvPhase('normal');
    setActiveMidBreak(null);
    setQueueIds([]);
    shufflePlayedIdsRef.current.clear();
    shuffleHistoryRef.current = [];
    syncShufflePlayedState();
    showToast('本地曲库、MV 缓存与播放列表已清空');
  }, [showToast, syncShufflePlayedState]);

  // Playlist operations
  const createPlaylist = useCallback(
    async (name: string, description?: string) => {
      const pl: Playlist = {
        id: crypto.randomUUID ? crypto.randomUUID() : `pl-${Date.now()}`,
        name: name.trim() || '新建播放列表',
        description: description?.trim(),
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await savePlaylist(pl);
      setPlaylists((prev) => [...prev, pl]);
      showToast(`已创建播放列表「${pl.name}」`);
      return pl;
    },
    [showToast]
  );

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== id) return pl;
        const updated = { ...pl, name: name.trim() || pl.name, updatedAt: Date.now() };
        savePlaylist(updated).catch(() => {});
        return updated;
      })
    );
  }, []);

  const deletePlaylist = useCallback(
    async (id: string) => {
      await deletePlaylistById(id);
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
      showToast('已删除播放列表');
    },
    [showToast]
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) return;
      if (target.trackIds.includes(trackId)) {
        showToast('歌曲已在该播放列表中');
        return;
      }
      const updated: Playlist = {
        ...target,
        trackIds: [...target.trackIds, trackId],
        updatedAt: Date.now(),
      };
      await savePlaylist(updated);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
      showToast(`已添加到「${target.name}」`);
    },
    [playlists, showToast]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target) return;
      const updated: Playlist = {
        ...target,
        trackIds: target.trackIds.filter((id) => id !== trackId),
        updatedAt: Date.now(),
      };
      await savePlaylist(updated);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
    },
    [playlists]
  );

  const playPlaylist = useCallback(
    async (playlistId: string, startTrackId?: string) => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl || pl.trackIds.length === 0) {
        showToast('该播放列表暂无歌曲');
        return;
      }
      const validIds = pl.trackIds.filter((id) => tracks.some((t) => t.id === id));
      if (validIds.length === 0) return;
      const targetId = startTrackId && validIds.includes(startTrackId) ? startTrackId : validIds[0];
      await playTrackById(targetId, validIds);
      setActivePage('player');
    },
    [playlists, tracks, playTrackById, showToast]
  );

  // Settings updates
  const updateAudioSettings = useCallback((patch: Partial<AudioDspSettings>) => {
    setAudioSettings((prev) => {
      const next = { ...prev, ...patch };
      audioEngine.applySettings(next);
      saveAudioSettings(next).catch(() => {});
      return next;
    });
  }, []);

  const resetAudioSettings = useCallback(() => {
    setAudioSettings(DEFAULT_AUDIO_SETTINGS);
    audioEngine.applySettings(DEFAULT_AUDIO_SETTINGS);
    saveAudioSettings(DEFAULT_AUDIO_SETTINGS).catch(() => {});
    showToast('音效与均衡器已恢复默认设置');
  }, [showToast]);

  const updatePersonalization = useCallback(
    (patch: Partial<PersonalizationSettings>) => {
      setPersonalization((prev) => {
        const next = { ...prev, ...patch };
        savePersonalization(next).catch(() => {});
        return next;
      });
    },
    []
  );

  const refreshStemMetas = useCallback(
    async (updatedTrackId?: string, autoEnableIfLoaded = false) => {
      const metas = await getAllStemMetas();
      const metaMap: Record<string, TrackStemsMeta> = {};
      for (const m of metas) {
        metaMap[m.trackId] = m;
      }
      setStemMetas(metaMap);

      if (updatedTrackId && loadedTrackIdRef.current === updatedTrackId) {
        const record = await getTrackStems(updatedTrackId);
        if (record && loadedTrackIdRef.current === updatedTrackId) {
          await audioEngine.loadStems(
            updatedTrackId,
            record.vocalBlob,
            record.instrumentalBlob
          );
          if (autoEnableIfLoaded) {
            setAudioSettings((prev) => {
              const next = { ...prev, stemModeActive: true };
              audioEngine.applySettings(next);
              saveAudioSettings(next).catch(() => {});
              return next;
            });
          }
        }
      }
    },
    []
  );

  const importTrackAndStemsToPlayer = useCallback(
    async (trackId: string) => {
      const target = stateRef.current.tracks.find((t) => t.id === trackId);
      if (!target) {
        showToast('未在曲库中找到该任务对应的歌曲');
        return;
      }
      await playTrackById(trackId);
      const stems = await getTrackStems(trackId);
      if (stems && loadedTrackIdRef.current === trackId) {
        await audioEngine.loadStems(trackId, stems.vocalBlob, stems.instrumentalBlob);
        setAudioSettings((prev) => {
          const next = { ...prev, stemModeActive: true };
          audioEngine.applySettings(next);
          saveAudioSettings(next).catch(() => {});
          return next;
        });
      }
      setActivePage('player');
      showToast(`已将「${target.title}」及分离音轨导入播放器`);
    },
    [playTrackById, showToast]
  );

  const pauseMainPlayer = useCallback(() => {
    if (!audioEngine.element.paused) {
      audioEngine.pause();
    }
  }, []);

  const reloadAllLibraryData = useCallback(async () => {
    const [
      loadedAudio,
      loadedPers,
      loadedPrefs,
      allTracks,
      allPlaylists,
      allMetas,
      allMvMetas,
      pendingMvs,
    ] = await Promise.all([
      loadAudioSettings(),
      loadPersonalization(),
      loadPlaybackPrefs(),
      getAllTracks(),
      getAllPlaylists(),
      getAllStemMetas(),
      getAllMvMetas(),
      loadPendingMvTimelines(),
    ]);

    setAudioSettings(loadedAudio);
    audioEngine.applySettings(loadedAudio);
    setPersonalization(loadedPers);
    setVolumeState(loadedPrefs.volume);
    setMuted(loadedPrefs.muted);
    setShuffle(loadedPrefs.shuffle);
    setRepeat(loadedPrefs.repeat);
    audioEngine.setVolume(loadedPrefs.volume, loadedPrefs.muted);

    const metaMap: Record<string, TrackStemsMeta> = {};
    for (const m of allMetas) {
      metaMap[m.trackId] = m;
    }

    const mvCountMap: Record<string, number> = {};
    for (const mv of allMvMetas) {
      mvCountMap[mv.trackId] = (mvCountMap[mv.trackId] || 0) + 1;
    }

    setTracks(allTracks);
    setPlaylists(allPlaylists);
    setStemMetas(metaMap);
    setAllMvCountByTrack(mvCountMap);
    setPendingMvTimelines(pendingMvs);
    setQueueIds(allTracks.map((t) => t.id));

    const preferred =
      allTracks.find((t) => t.id === loadedPrefs.lastTrackId) || allTracks[0];
    if (preferred) {
      if (loadedPrefs.shuffle) {
        shufflePlayedIdsRef.current = new Set([preferred.id]);
        shuffleHistoryRef.current = [preferred.id];
        setShufflePlayedIds([preferred.id]);
      } else {
        shufflePlayedIdsRef.current.clear();
        shuffleHistoryRef.current = [];
        setShufflePlayedIds([]);
      }
      await loadBlobIntoEngine(preferred, false);
      await syncTrackMvsForTrack(preferred.id);
    }
  }, [loadBlobIntoEngine, syncTrackMvsForTrack]);

  const removeTrackStems = useCallback(
    async (trackId: string) => {
      await deleteTrackStems(trackId);
      setStemMetas((prev) => {
        const copy = { ...prev };
        delete copy[trackId];
        return copy;
      });
      if (loadedTrackIdRef.current === trackId) {
        audioEngine.clearStems();
        updateAudioSettings({ stemModeActive: false });
      }
      showToast('已清除该曲目的分离音轨缓存');
    },
    [showToast, updateAudioSettings]
  );

  // Sync native Fullscreen API & Escape key with immersive fullscreen mode
  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const nativeActive = Boolean(
        document.fullscreenElement || doc.webkitFullscreenElement
      );
      if (!nativeActive) {
        setIsFullscreen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
    } catch {
      // Ignore native exit errors if iframe or browser restricted it
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
      return;
    }
    setIsFullscreen(true);
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // If browser/iframe blocks native requestFullscreen, immersive full-viewport mode still activates cleanly
      showToast('已进入沉浸式全屏展示（按 ESC 或点击右上角退出）');
    }
  }, [isFullscreen, exitFullscreen, showToast]);

  const refreshPendingMvTimelines = useCallback(async () => {
    const list = await loadPendingMvTimelines();
    setPendingMvTimelines(list);
  }, []);

  const removePendingMvTimeline = useCallback(
    async (id: string) => {
      await removePendingMvTimelineById(id);
      await refreshPendingMvTimelines();
      showToast('已移除待匹配的 MV 时间轴预设');
    },
    [refreshPendingMvTimelines, showToast]
  );

  // MV CRUD & Skip Controls
  const uploadTrackMvFile = useCallback(
    async (trackId: string, file: File): Promise<TrackMvMeta> => {
      await requestPersistentStorage();
      const tempUrl = URL.createObjectURL(file);
      let durationSec = 0;
      try {
        durationSec = await probeVideoDuration(tempUrl);
      } finally {
        URL.revokeObjectURL(tempUrl);
      }

      const mvId = crypto.randomUUID
        ? crypto.randomUUID()
        : `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const targetTrack = stateRef.current.tracks.find((t) => t.id === trackId);
      const baseTitle = file.name.replace(/\.[^/.]+$/, '') || '本地 MV 视频';
      const matchedPending = await matchAndConsumePendingMvTimeline({
        trackId,
        trackTitle: targetTrack?.title,
        trackArtist: targetTrack?.artist,
        fileName: file.name,
        mvTitle: baseTitle,
        fileSizeBytes: file.size,
        durationSec,
      });

      const record: TrackMvRecord = {
        id: mvId,
        trackId,
        title: matchedPending?.mvTitle || baseTitle,
        fileName: file.name,
        mimeType: file.type || 'video/mp4',
        fileSizeBytes: file.size,
        durationSec,
        sourceType: 'local',
        addedAt: Date.now(),
        isActive: true,
        blurPx: matchedPending?.blurPx ?? 14,
        opacityPct: matchedPending?.opacityPct ?? 48,
        timeline: matchedPending?.timeline || createDefaultMvTimeline(),
        videoBlob: file,
      };

      const existing = await getTrackMvs(trackId);
      for (const item of existing) {
        if (item.isActive) {
          await saveTrackMv({ ...item, isActive: false });
        }
      }
      await saveTrackMv(record);
      await refreshAllMvCounts();
      if (matchedPending) {
        await refreshPendingMvTimelines();
      }
      if (currentTrackId === trackId) {
        await syncTrackMvsForTrack(trackId);
      }
      if (matchedPending) {
        const introDesc = matchedPending.timeline.introEnabled
          ? `前瞻 ${matchedPending.timeline.introEndSec}s`
          : '前瞻关闭';
        const outroDesc = matchedPending.timeline.outroEnabled
          ? `后段 ${
              matchedPending.timeline.outroEndSec
                ? `${matchedPending.timeline.outroEndSec}s`
                : '至末尾'
            }`
          : '后段关闭';
        showToast(
          `已导入 MV「${record.title}」并自动匹配恢复（${introDesc} · ${outroDesc}）`
        );
      } else {
        showToast(`已导入 MV「${record.title}」并设为当前曲目默认版本`);
      }
      const { videoBlob: _b, ...meta } = record;
      return meta;
    },
    [
      currentTrackId,
      refreshAllMvCounts,
      refreshPendingMvTimelines,
      showToast,
      syncTrackMvsForTrack,
    ]
  );

  const bindTrackMvUrl = useCallback(
    async (trackId: string, url: string, title?: string): Promise<TrackMvMeta> => {
      const trimmed = url.trim();
      if (!trimmed) {
        throw new Error('请输入有效的视频流地址');
      }
      const durationSec = await probeVideoDuration(trimmed);
      const mvId = crypto.randomUUID
        ? crypto.randomUUID()
        : `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const targetTrack = stateRef.current.tracks.find((t) => t.id === trackId);
      const baseTitle = title?.trim() || '在线 MV 链接';
      const matchedPending = await matchAndConsumePendingMvTimeline({
        trackId,
        trackTitle: targetTrack?.title,
        trackArtist: targetTrack?.artist,
        fileName: trimmed,
        mvTitle: baseTitle,
        durationSec,
      });

      const record: TrackMvRecord = {
        id: mvId,
        trackId,
        title: matchedPending?.mvTitle || baseTitle,
        fileName: trimmed,
        mimeType: 'video/mp4',
        fileSizeBytes: 0,
        durationSec,
        sourceType: 'url',
        externalUrl: trimmed,
        addedAt: Date.now(),
        isActive: true,
        blurPx: matchedPending?.blurPx ?? 14,
        opacityPct: matchedPending?.opacityPct ?? 48,
        timeline: matchedPending?.timeline || createDefaultMvTimeline(),
      };

      const existing = await getTrackMvs(trackId);
      for (const item of existing) {
        if (item.isActive) {
          await saveTrackMv({ ...item, isActive: false });
        }
      }
      await saveTrackMv(record);
      await refreshAllMvCounts();
      if (matchedPending) {
        await refreshPendingMvTimelines();
        const introDesc = matchedPending.timeline.introEnabled
          ? `前瞻 ${matchedPending.timeline.introEndSec}s`
          : '前瞻关闭';
        const outroDesc = matchedPending.timeline.outroEnabled
          ? `后段 ${
              matchedPending.timeline.outroEndSec
                ? `${matchedPending.timeline.outroEndSec}s`
                : '至末尾'
            }`
          : '后段关闭';
        showToast(`已绑定 MV 链接并自动匹配恢复（${introDesc} · ${outroDesc}）`);
      } else {
        showToast(`已绑定 MV 链接「${record.title}」`);
      }
      if (currentTrackId === trackId) {
        await syncTrackMvsForTrack(trackId);
      }
      const { videoBlob: _b, ...meta } = record;
      return meta;
    },
    [
      currentTrackId,
      refreshAllMvCounts,
      refreshPendingMvTimelines,
      showToast,
      syncTrackMvsForTrack,
    ]
  );

  const selectActiveTrackMv = useCallback(
    async (trackId: string, mvId: string) => {
      await setActiveTrackMv(trackId, mvId);
      if (currentTrackId === trackId) {
        await syncTrackMvsForTrack(trackId);
      }
      showToast('已切换当前歌曲的激活 MV 版本');
    },
    [currentTrackId, showToast, syncTrackMvsForTrack]
  );

  const mvSaveTimersRef = useRef<Record<string, number>>({});
  const mvPendingPatchesRef = useRef<Record<string, Partial<TrackMvMeta>>>({});

  const updateTrackMvConfig = useCallback(
    async (mvId: string, patch: Partial<TrackMvMeta>) => {
      // Merge into React state synchronously for instant 60fps slider responsiveness
      setTrackMvs((prev) =>
        prev.map((m) =>
          m.id === mvId
            ? {
                ...m,
                ...patch,
                timeline: patch.timeline
                  ? { ...m.timeline, ...patch.timeline }
                  : m.timeline,
              }
            : m
        )
      );
      setActiveMv((prev) => {
        if (!prev || prev.id !== mvId) return prev;
        return {
          ...prev,
          ...patch,
          timeline: patch.timeline
            ? { ...prev.timeline, ...patch.timeline }
            : prev.timeline,
        };
      });

      const prevPending = mvPendingPatchesRef.current[mvId] || {};
      mvPendingPatchesRef.current[mvId] = {
        ...prevPending,
        ...patch,
        timeline: patch.timeline
          ? { ...(prevPending.timeline || {}), ...patch.timeline }
          : prevPending.timeline,
      };

      if (mvSaveTimersRef.current[mvId]) {
        window.clearTimeout(mvSaveTimersRef.current[mvId]);
      }

      mvSaveTimersRef.current[mvId] = window.setTimeout(() => {
        const merged = mvPendingPatchesRef.current[mvId];
        delete mvPendingPatchesRef.current[mvId];
        delete mvSaveTimersRef.current[mvId];
        if (merged) {
          updateMvRecordMeta(mvId, merged).catch(() => {});
        }
      }, 180);
    },
    []
  );

  const deleteTrackMv = useCallback(
    async (mvId: string) => {
      await deleteMvById(mvId);
      await refreshAllMvCounts();
      if (currentTrackId) {
        const remaining = await getTrackMvs(currentTrackId);
        if (remaining.length > 0 && !remaining.some((m) => m.isActive)) {
          await setActiveTrackMv(currentTrackId, remaining[0].id);
        }
        await syncTrackMvsForTrack(currentTrackId);
      }
      showToast('已删除该 MV 版本');
    },
    [currentTrackId, refreshAllMvCounts, showToast, syncTrackMvsForTrack]
  );

  const skipMvPhase = useCallback(async () => {
    const phase = mvPhaseRef.current;
    const mv = activeMvRef.current;

    if (phase === 'intro') {
      introDoneForPlayRef.current = true;
      allowIntroTailCrossfadeRef.current = false;
      mvPhaseRef.current = 'normal';
      setMvPhase('normal');
      const endSec = mv?.timeline.introEndSec || 0;
      mvPhaseTimeRef.current = endSec;
      setMvPhaseTime(endSec);
      audioEngine.seek(0);
      setCurrentTime(0);
      audioEngine.setTheaterMixGains(1, 0, 0.02);
      if (currentTrack) {
        if (loadedTrackIdRef.current !== currentTrack.id || !audioEngine.element.src) {
          await loadBlobIntoEngine(currentTrack, true);
        } else {
          await audioEngine.play().catch(() => {});
        }
      }
      showToast('已跳过前瞻，进入主歌对齐播放');
      return;
    }

    if (phase === 'mid-break' && activeMidBreakRef.current) {
      const brk = activeMidBreakRef.current;
      completedBreakIdsRef.current.add(brk.id);
      mvPhaseRef.current = 'normal';
      activeMidBreakRef.current = null;
      setMvPhase('normal');
      setActiveMidBreak(null);
      mvPhaseTimeRef.current = brk.mvEndSec;
      setMvPhaseTime(brk.mvEndSec);
      audioEngine.seek(brk.audioTriggerSec + 0.04);
      setCurrentTime(brk.audioTriggerSec + 0.04);
      audioEngine.setTheaterMixGains(1, 0, 0.02);
      await audioEngine.play().catch(() => {});
      showToast('已跳过中段，恢复音乐播放');
      return;
    }

    if (phase === 'outro') {
      mvPhaseRef.current = 'normal';
      setMvPhase('normal');
      await playNext(true);
    }
  }, [currentTrack, loadBlobIntoEngine, playNext, showToast]);

  const restartTrackWithMvIntro = useCallback(async () => {
    if (!currentTrack) return;
    await playTrackById(currentTrack.id);
  }, [currentTrack, playTrackById]);

  // Derived MV theater visual state & target timestamp
  const mvTheaterVisual = useMemo(() => {
    if (!activeMv || personalization.mvBackgroundEnabled === false) {
      return {
        uiOpacity: 1,
        isTheaterClarity: true,
        skipLabel: null,
        skipSubLabel: null,
        songAudioGain: 1,
        mvAudioGain: 0,
      };
    }
    const audioDur = duration > 0 ? duration : currentTrack?.duration || 0;
    return computeTheaterVisualState({
      phase: mvPhase,
      mvPhaseTime,
      timeline: activeMv.timeline,
      activeMidBreak,
      audioTime: currentTime,
      audioDuration: audioDur,
      mvDurationSec: activeMv.durationSec,
      completedBreakIds: completedBreakIdsRef.current,
      fadeInSec: personalization.mvUiFadeInSec ?? 1.0,
      fadeOutSec: personalization.mvUiFadeOutSec ?? 1.0,
      outroStartMvSec: outroStartMvSecRef.current,
      allowIntroTailCrossfade: allowIntroTailCrossfadeRef.current,
    });
  }, [
    activeMv,
    personalization.mvBackgroundEnabled,
    mvPhase,
    mvPhaseTime,
    activeMidBreak,
    currentTime,
    duration,
    currentTrack?.duration,
    personalization.mvUiFadeInSec,
    personalization.mvUiFadeOutSec,
  ]);

  // Keep AudioEngine mix gains in sync even when paused or right after phase transitions
  useEffect(() => {
    audioEngine.setTheaterMixGains(
      mvTheaterVisual.songAudioGain,
      mvTheaterVisual.mvAudioGain,
      0.015
    );
  }, [mvTheaterVisual.songAudioGain, mvTheaterVisual.mvAudioGain]);

  const mvTargetTime = useMemo(() => {
    if (!activeMv) return 0;
    if (mvPhase !== 'normal') {
      return mvPhaseTime;
    }
    return computeSyncedMvTime(
      currentTime,
      activeMv.timeline,
      completedBreakIdsRef.current
    );
  }, [activeMv, mvPhase, mvPhaseTime, currentTime]);

  const mvVideoMuted = mvTheaterVisual.mvAudioGain <= 0.002;

  // Keep a mutable ref for BroadcastChannel snapshot publishing & command handling
  const snapshotSourceRef = useRef({
    currentTrack,
    activeMv,
    personalization,
    audioSettings,
    mvPhase,
    isPlaying,
    currentTime,
    effectiveDuration: duration > 0 ? duration : currentTrack?.duration || 0,
    mvTargetTime,
    mvVideoMuted,
    volume,
    muted,
    mvTheaterVisual,
  });
  snapshotSourceRef.current = {
    currentTrack,
    activeMv,
    personalization,
    audioSettings,
    mvPhase,
    isPlaying,
    currentTime,
    effectiveDuration: duration > 0 ? duration : currentTrack?.duration || 0,
    mvTargetTime,
    mvVideoMuted,
    volume,
    muted,
    mvTheaterVisual,
  };

  const remoteActionRef = useRef({
    skipMvPhase,
    togglePlayPause,
    playNext,
    playPrev,
    seekMvTimeline,
  });
  remoteActionRef.current = {
    skipMvPhase,
    togglePlayPause,
    playNext,
    playPrev,
    seekMvTimeline,
  };

  const publishMvSyncSnapshotRef = useRef<(() => void) | null>(null);

  const publishMvSyncSnapshot = useCallback(() => {
    const s = snapshotSourceRef.current;
    const livePhase = mvPhaseRef.current;
    const liveAudioTime =
      audioEngine.element.src && Number.isFinite(audioEngine.element.currentTime)
        ? audioEngine.element.currentTime
        : s.currentTime;
    const liveAudioDur =
      Number.isFinite(audioEngine.element.duration) && audioEngine.element.duration > 0
        ? audioEngine.element.duration
        : s.effectiveDuration;
    const liveMv = activeMvRef.current;
    const liveMvTargetTime = !liveMv
      ? 0
      : livePhase !== 'normal'
      ? mvPhaseTimeRef.current
      : computeSyncedMvTime(
          liveAudioTime,
          liveMv.timeline,
          completedBreakIdsRef.current
        );
    const liveVisual =
      liveMv && s.personalization.mvBackgroundEnabled !== false
        ? computeTheaterVisualState({
            phase: livePhase,
            mvPhaseTime: mvPhaseTimeRef.current,
            timeline: liveMv.timeline,
            activeMidBreak: activeMidBreakRef.current,
            audioTime: liveAudioTime,
            audioDuration: liveAudioDur,
            mvDurationSec: liveMv.durationSec,
            completedBreakIds: completedBreakIdsRef.current,
            fadeInSec: s.personalization.mvUiFadeInSec ?? 1.0,
            fadeOutSec: s.personalization.mvUiFadeOutSec ?? 1.0,
            outroStartMvSec: outroStartMvSecRef.current,
            allowIntroTailCrossfade: allowIntroTailCrossfadeRef.current,
          })
        : s.mvTheaterVisual;
    const liveMvMuted = liveVisual.mvAudioGain <= 0.002;

    const snap: MvSyncSnapshot = {
      trackId: s.currentTrack?.id || null,
      trackTitle: s.currentTrack?.title || '未选择曲目',
      trackArtist: s.currentTrack?.artist || '',
      mvId: liveMv?.id || null,
      mvTitle: liveMv?.title || '',
      mvSourceType: liveMv?.sourceType || 'local',
      mvExternalUrl: liveMv?.externalUrl,
      mvDurationSec: liveMv?.durationSec || 0,
      mvEnabled: s.personalization.mvBackgroundEnabled !== false,
      phase: livePhase,
      isPlaying: isPlayingRef.current,
      audioTime: liveAudioTime,
      audioDuration: liveAudioDur,
      mvTargetTime: liveMvTargetTime,
      mvPlaybackRate: 1,
      mvMuted: liveMvMuted,
      mvAudioGain: liveVisual.mvAudioGain,
      audioSettings: s.audioSettings,
      volume: s.volume,
      muted: s.muted,
      blurPx: 0,
      opacityPct: 100,
      uiOpacity: liveVisual.uiOpacity,
      isTheaterClarity: true,
      skipLabel: liveVisual.skipLabel,
      skipSubLabel: liveVisual.skipSubLabel,
      sentAt: Date.now(),
    };
    try {
      mvChannelRef.current?.postMessage({ type: 'SYNC_SNAPSHOT', payload: snap });
    } catch {
      // ignore closed channel
    }
    if (typeof window !== 'undefined' && standaloneWindowsRef.current.size > 0) {
      for (const win of Array.from(standaloneWindowsRef.current)) {
        try {
          if (win.closed) {
            standaloneWindowsRef.current.delete(win);
          } else {
            win.postMessage(
              { type: 'SYNC_SNAPSHOT', payload: snap },
              window.location.origin
            );
          }
        } catch {
          standaloneWindowsRef.current.delete(win);
        }
      }
    }
    try {
      localStorage.setItem(MV_SYNC_STORAGE_KEY, JSON.stringify(snap));
    } catch {
      // ignore storage errors
    }
  }, []);
  publishMvSyncSnapshotRef.current = publishMvSyncSnapshot;

  // BroadcastChannel + window.postMessage + localStorage bridge to Standalone MV Window (/?mvTheater=1)
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(MV_SYNC_CHANNEL_NAME);
      mvChannelRef.current = channel;
    }

    const sendBlobToTarget = async (
      mvId: string,
      replyWindow?: Window | null
    ) => {
      try {
        const rec =
          activeMvRef.current?.id === mvId && activeMvRef.current.videoBlob
            ? activeMvRef.current
            : await getMvRecordById(mvId);
        if (!rec) return;
        const msg: MvBlobResponseMessage = {
          type: 'MV_BLOB_RESPONSE',
          mvId,
          videoBlob: rec.videoBlob,
          externalUrl: rec.externalUrl,
          durationSec: rec.durationSec,
        };
        if (replyWindow && !replyWindow.closed) {
          replyWindow.postMessage(msg, window.location.origin);
        } else {
          for (const win of Array.from(standaloneWindowsRef.current)) {
            if (!win.closed) {
              win.postMessage(msg, window.location.origin);
            }
          }
        }
      } catch {
        // ignore blob relay error
      }
    };

    const handleCommand = (
      cmd: MvRemoteCommand,
      sourceWindow?: Window | null
    ) => {
      if (!cmd || !cmd.type) return;
      if (sourceWindow && !sourceWindow.closed) {
        standaloneWindowsRef.current.add(sourceWindow);
      }

      if (cmd.type === 'STANDALONE_HELLO' || cmd.type === 'STANDALONE_HEARTBEAT') {
        standaloneHeartbeatAtRef.current = Date.now();
        setStandaloneMvConnected(true);
        if (cmd.type === 'STANDALONE_HELLO') {
          publishMvSyncSnapshot();
        }
      } else if (cmd.type === 'STANDALONE_BYE') {
        if (sourceWindow) {
          standaloneWindowsRef.current.delete(sourceWindow);
        }
        standaloneHeartbeatAtRef.current = 0;
        setStandaloneMvConnected(false);
      } else if (cmd.type === 'REQUEST_SYNC') {
        publishMvSyncSnapshot();
      } else if (cmd.type === 'REQUEST_MV_BLOB') {
        void sendBlobToTarget(cmd.mvId, sourceWindow);
      } else if (cmd.type === 'SKIP_PHASE') {
        remoteActionRef.current.skipMvPhase();
      } else if (cmd.type === 'TOGGLE_PLAY') {
        remoteActionRef.current.togglePlayPause();
      } else if (cmd.type === 'NEXT_TRACK') {
        remoteActionRef.current.playNext(true);
      } else if (cmd.type === 'PREV_TRACK') {
        remoteActionRef.current.playPrev();
      } else if (cmd.type === 'SEEK_MV') {
        remoteActionRef.current.seekMvTimeline(cmd.mvTimeSec);
      } else if (cmd.type === 'MV_ENDED_IN_OUTRO') {
        if (mvPhaseRef.current === 'outro') {
          remoteActionRef.current.playNext(false);
        }
      }
    };

    if (channel) {
      channel.onmessage = (event) => {
        handleCommand(event.data as MvRemoteCommand);
      };
    }

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as MvRemoteCommand | undefined;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      const srcWin =
        event.source && 'postMessage' in event.source
          ? (event.source as Window)
          : null;
      handleCommand(data, srcWin);
    };
    window.addEventListener('message', onWindowMessage);

    const onStorage = (e: StorageEvent) => {
      if (e.key === MV_CMD_STORAGE_KEY && e.newValue) {
        try {
          handleCommand(JSON.parse(e.newValue) as MvRemoteCommand);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);

    const heartbeatWatch = window.setInterval(() => {
      if (
        standaloneHeartbeatAtRef.current > 0 &&
        Date.now() - standaloneHeartbeatAtRef.current > 6500
      ) {
        standaloneHeartbeatAtRef.current = 0;
        setStandaloneMvConnected(false);
      }
    }, 2500);

    publishMvSyncSnapshot();

    return () => {
      window.clearInterval(heartbeatWatch);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorage);
      if (channel) {
        channel.close();
      }
      mvChannelRef.current = null;
      standaloneWindowsRef.current.clear();
    };
  }, [publishMvSyncSnapshot]);

  // Publish immediately on important state changes and at 150ms cadence while playing or standalone connected
  useEffect(() => {
    publishMvSyncSnapshot();
    if (!isPlaying && !standaloneMvConnected) return;
    const timer = window.setInterval(() => {
      publishMvSyncSnapshot();
    }, 85);
    return () => window.clearInterval(timer);
  }, [
    isPlaying,
    standaloneMvConnected,
    currentTrackId,
    activeMv,
    mvPhase,
    audioSettings,
    personalization.mvBackgroundEnabled,
    publishMvSyncSnapshot,
  ]);

  const value: MusicContextValue = {
    activePage,
    setActivePage,
    tracks,
    playlists,
    queueIds,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    shufflePlayedIds,
    repeat,
    isQueueOpen,
    setIsQueueOpen,
    showLyricsInPlayer,
    setShowLyricsInPlayer,
    isFullscreen,
    toggleFullscreen,
    exitFullscreen,
    audioSettings,
    personalization,
    activePalette,
    isImporting,
    importProgress,
    toastMessage,
    showToast,
    playTrackById,
    togglePlayPause,
    playNext,
    playPrev,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    enqueueTrack,
    removeFromQueue,
    clearQueue,
    importLocalFiles,
    toggleFavorite,
    deleteTrack,
    updateTrackInfo,
    updateTrackCover,
    updateTrackLyrics,
    translateTrackLyrics,
    isTranslatingLyrics,
    updateLyricsOffset,
    loadDemoLibrary,
    resetLibrary,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    playPlaylist,
    updateAudioSettings,
    resetAudioSettings,
    updatePersonalization,
    stemMetas,
    currentTrackStemMeta,
    separationEngineMode,
    setSeparationEngineMode,
    refreshStemMetas,
    importTrackAndStemsToPlayer,
    pauseMainPlayer,
    removeTrackStems,
    reloadAllLibraryData,
    trackMvs,
    allMvCountByTrack,
    pendingMvTimelines,
    activeMv,
    activeMvVideoUrl,
    mvPhase,
    mvPhaseTime,
    activeMidBreak,
    mvUiOpacity: mvTheaterVisual.uiOpacity,
    mvTheaterClarity: mvTheaterVisual.isTheaterClarity,
    mvVideoMuted,
    mvAudioGain: mvTheaterVisual.mvAudioGain,
    mvSkipLabel: mvTheaterVisual.skipLabel,
    mvSkipSubLabel: mvTheaterVisual.skipSubLabel,
    mvTargetTime,
    standaloneMvConnected,
    uploadTrackMvFile,
    bindTrackMvUrl,
    selectActiveTrackMv,
    updateTrackMvConfig,
    deleteTrackMv,
    refreshPendingMvTimelines,
    removePendingMvTimeline,
    skipMvPhase,
    restartTrackWithMvIntro,
    seekMvTimeline,
  };

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
};

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusic must be used within MusicProvider');
  return ctx;
}
