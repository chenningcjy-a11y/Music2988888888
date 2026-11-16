import {
  AudioDspSettings,
  MvMidBreakRange,
  MvTheaterPhase,
  TrackMvTimelineConfig,
} from '../types/music';

export const MV_SYNC_CHANNEL_NAME = 'lumina-mv-sync-v1';
export const MV_SYNC_STORAGE_KEY = 'lumina_mv_sync_snapshot_v1';
export const MV_CMD_STORAGE_KEY = 'lumina_mv_sync_cmd_v1';
export const MV_FADE_LEAD_SEC = 1.0;

export function createDefaultMvTimeline(): TrackMvTimelineConfig {
  return {
    introEnabled: false,
    introEndSec: 0,
    midBreaks: [],
    outroEnabled: false,
    outroEndSec: undefined,
    fadeTransitionSec: MV_FADE_LEAD_SEC,
    syncOffsetSec: 0,
    playbackRateAdjust: 1,
  };
}

export function normalizeMidBreaks(
  breaks: MvMidBreakRange[]
): MvMidBreakRange[] {
  return [...breaks]
    .filter(
      (b) =>
        Number.isFinite(b.audioTriggerSec) &&
        Number.isFinite(b.mvStartSec) &&
        Number.isFinite(b.mvEndSec) &&
        b.mvEndSec > b.mvStartSec + 0.3 &&
        b.audioTriggerSec >= 0
    )
    .sort((a, b) => a.audioTriggerSec - b.audioTriggerSec);
}

/**
 * Sum of MV duration for mid-breaks that have already been passed/completed.
 */
export function getCompletedBreakOffsetSec(
  timeline: TrackMvTimelineConfig,
  completedBreakIds: Set<string>
): number {
  const sorted = normalizeMidBreaks(timeline.midBreaks || []);
  let total = 0;
  for (const brk of sorted) {
    if (completedBreakIds.has(brk.id)) {
      total += brk.mvEndSec - brk.mvStartSec;
    }
  }
  return total;
}

/**
 * Computes which mid-breaks are strictly before `seekAudioTime` so seeking
 * forward/backward on the audio scrubber keeps the MV aligned accurately.
 */
export function getCompletedBreakIdsForAudioSeek(
  seekAudioTime: number,
  timeline: TrackMvTimelineConfig
): Set<string> {
  const set = new Set<string>();
  const sorted = normalizeMidBreaks(timeline.midBreaks || []);
  for (const brk of sorted) {
    if (seekAudioTime > brk.audioTriggerSec + 0.15) {
      set.add(brk.id);
    }
  }
  return set;
}

/**
 * Maps current song audio playback time -> expected MV video time (in seconds)
 * during normal music playback.
 */
export function computeSyncedMvTime(
  audioTime: number,
  timeline: TrackMvTimelineConfig,
  completedBreakIds: Set<string>
): number {
  const introOffset =
    timeline.introEnabled && timeline.introEndSec > 0.3
      ? timeline.introEndSec
      : 0;
  const breakOffset = getCompletedBreakOffsetSec(timeline, completedBreakIds);
  return Math.max(0, introOffset + audioTime + breakOffset);
}

/**
 * Finds the next uncompleted mid-break whose audioTriggerSec has been reached.
 */
export function findTriggeredMidBreak(
  audioTime: number,
  timeline: TrackMvTimelineConfig,
  completedBreakIds: Set<string>
): MvMidBreakRange | null {
  const sorted = normalizeMidBreaks(timeline.midBreaks || []);
  for (const brk of sorted) {
    if (completedBreakIds.has(brk.id)) continue;
    if (
      audioTime >= brk.audioTriggerSec &&
      audioTime <= brk.audioTriggerSec + 1.1
    ) {
      return brk;
    }
  }
  return null;
}

export const MV_AUDIO_OVERLAP_SEC = 0.5;

/**
 * Computes UI opacity (0..1), skip affordance, and equal-power audio crossfade gains
 * (`songAudioGain`, `mvAudioGain`) so boundaries transition seamlessly without gaps or abrupt cuts.
 */
export function computeTheaterVisualState(params: {
  phase: MvTheaterPhase;
  mvPhaseTime: number;
  timeline: TrackMvTimelineConfig;
  activeMidBreak: MvMidBreakRange | null;
  audioTime?: number;
  audioDuration?: number;
  mvDurationSec?: number;
  completedBreakIds?: Set<string>;
  fadeInSec?: number;
  fadeOutSec?: number;
  outroStartMvSec?: number;
}): {
  uiOpacity: number;
  isTheaterClarity: boolean;
  skipLabel: string | null;
  skipSubLabel: string | null;
  songAudioGain: number;
  mvAudioGain: number;
} {
  const {
    phase,
    mvPhaseTime,
    timeline,
    activeMidBreak,
    audioTime = 0,
    audioDuration = 0,
    mvDurationSec = 0,
    completedBreakIds,
    fadeInSec = MV_FADE_LEAD_SEC,
    fadeOutSec = MV_FADE_LEAD_SEC,
    outroStartMvSec = 0,
  } = params;

  const safeFadeIn = Math.max(0, Math.min(10, Number.isFinite(fadeInSec) ? fadeInSec : MV_FADE_LEAD_SEC));
  const safeFadeOut = Math.max(0, Math.min(10, Number.isFinite(fadeOutSec) ? fadeOutSec : MV_FADE_LEAD_SEC));

  if (phase === 'intro') {
    const endSec = timeline.introEndSec || 0;
    const remaining = Math.max(0, endSec - mvPhaseTime);
    const fadeWindow = Math.min(MV_AUDIO_OVERLAP_SEC, Math.max(0.2, endSec * 0.4));
    let mvAudioGain = 1;
    if (endSec > 0.4 && remaining <= fadeWindow) {
      const p = Math.max(0, Math.min(1, 1 - remaining / fadeWindow));
      // Smoothly taper from 1.0 -> 0.707 at boundary, then 0.707 -> 0 over first 0.5s of song
      mvAudioGain = Math.cos(p * Math.PI * 0.25);
    }

    if (safeFadeIn > 0.05 && remaining <= safeFadeIn && endSec > 0.3) {
      const progress = Math.max(0, Math.min(1, 1 - remaining / safeFadeIn));
      return {
        uiOpacity: progress,
        isTheaterClarity: true,
        skipLabel: '跳过前瞻',
        skipSubLabel: null,
        songAudioGain: 0,
        mvAudioGain,
      };
    }
    return {
      uiOpacity: 0,
      isTheaterClarity: true,
      skipLabel: '跳过前瞻',
      skipSubLabel: null,
      songAudioGain: 0,
      mvAudioGain,
    };
  }

  if (phase === 'mid-break' && activeMidBreak) {
    const elapsed = Math.max(0, mvPhaseTime - activeMidBreak.mvStartSec);
    const remaining = Math.max(0, activeMidBreak.mvEndSec - mvPhaseTime);
    const segDur = Math.max(0.4, activeMidBreak.mvEndSec - activeMidBreak.mvStartSec);
    const inWin = Math.min(0.45, segDur * 0.35);
    const outWin = Math.min(MV_AUDIO_OVERLAP_SEC, segDur * 0.35);

    let mvAudioGain = 1;
    if (elapsed < inWin) {
      const pIn = Math.max(0, Math.min(1, elapsed / inWin));
      mvAudioGain = Math.sin((0.35 + 0.65 * pIn) * Math.PI * 0.5);
    } else if (remaining <= outWin) {
      const pOut = Math.max(0, Math.min(1, 1 - remaining / outWin));
      mvAudioGain = Math.cos(pOut * Math.PI * 0.25);
    }

    if (safeFadeIn > 0.05 && remaining <= safeFadeIn) {
      const progress = Math.max(0, Math.min(1, 1 - remaining / safeFadeIn));
      return {
        uiOpacity: progress,
        isTheaterClarity: true,
        skipLabel: '跳过中段',
        skipSubLabel: null,
        songAudioGain: 0,
        mvAudioGain,
      };
    }
    return {
      uiOpacity: 0,
      isTheaterClarity: true,
      skipLabel: '跳过中段',
      skipSubLabel: null,
      songAudioGain: 0,
      mvAudioGain,
    };
  }

  if (phase === 'outro') {
    const elapsed = Math.max(0, mvPhaseTime - outroStartMvSec);
    const pIn = Math.max(0, Math.min(1, elapsed / 0.45));
    const mvAudioGain = Math.sin((0.35 + 0.65 * pIn) * Math.PI * 0.5);
    return {
      uiOpacity: 0,
      isTheaterClarity: true,
      skipLabel: '跳过后段',
      skipSubLabel: null,
      songAudioGain: 0,
      mvAudioGain,
    };
  }

  // Normal phase: compute smooth audio crossfades & anticipatory UI fade-out
  let songAudioGain = 1;
  let mvAudioGain = 0;

  const sortedBreaks = normalizeMidBreaks(timeline.midBreaks || []);

  // Crossfade tail right after Intro -> Music boundary
  if (timeline.introEnabled && (timeline.introEndSec || 0) > 0.3 && audioTime < MV_AUDIO_OVERLAP_SEC) {
    const t = Math.max(0, Math.min(1, audioTime / MV_AUDIO_OVERLAP_SEC));
    songAudioGain = Math.sin(t * Math.PI * 0.5);
    mvAudioGain = Math.cos((0.5 + 0.5 * t) * Math.PI * 0.5);
  }

  // Crossfade tail right after a Mid-Break -> Music boundary
  for (const brk of sortedBreaks) {
    if (
      completedBreakIds?.has(brk.id) &&
      audioTime >= brk.audioTriggerSec &&
      audioTime < brk.audioTriggerSec + MV_AUDIO_OVERLAP_SEC
    ) {
      const t = Math.max(0, Math.min(1, (audioTime - brk.audioTriggerSec) / MV_AUDIO_OVERLAP_SEC));
      songAudioGain = Math.min(songAudioGain, Math.sin(t * Math.PI * 0.5));
      mvAudioGain = Math.max(mvAudioGain, Math.cos((0.5 + 0.5 * t) * Math.PI * 0.5));
    }
  }

  // Smooth pre-taper of song right before an upcoming Mid-Break
  for (const brk of sortedBreaks) {
    if (completedBreakIds?.has(brk.id)) continue;
    const dist = brk.audioTriggerSec - audioTime;
    if (dist >= 0 && dist <= 0.45) {
      songAudioGain = Math.min(songAudioGain, 0.45 + 0.55 * (dist / 0.45));
    }
  }

  // Smooth pre-taper of song right before Outro
  if (timeline.outroEnabled && audioDuration > 0) {
    const distToEnd = audioDuration - audioTime;
    if (distToEnd >= 0 && distToEnd <= 0.45) {
      const endSyncMv = computeSyncedMvTime(
        audioDuration,
        timeline,
        completedBreakIds || new Set<string>()
      );
      const outroEnd = timeline.outroEndSec || mvDurationSec || 0;
      if (outroEnd > endSyncMv + 0.5) {
        songAudioGain = Math.min(songAudioGain, 0.45 + 0.55 * (distToEnd / 0.45));
      }
    }
  }

  // Anticipatory UI fade-out ahead of mid-break or outro
  if (safeFadeOut > 0.05) {
    for (const brk of sortedBreaks) {
      if (completedBreakIds?.has(brk.id)) continue;
      const dist = brk.audioTriggerSec - audioTime;
      if (dist >= 0 && dist <= safeFadeOut) {
        return {
          uiOpacity: Math.max(0, Math.min(1, dist / safeFadeOut)),
          isTheaterClarity: true,
          skipLabel: null,
          skipSubLabel: null,
          songAudioGain,
          mvAudioGain,
        };
      }
    }

    if (timeline.outroEnabled && audioDuration > 0) {
      const distToEnd = audioDuration - audioTime;
      if (distToEnd >= 0 && distToEnd <= safeFadeOut) {
        const endSyncMv = computeSyncedMvTime(
          audioDuration,
          timeline,
          completedBreakIds || new Set<string>()
        );
        const outroEnd = timeline.outroEndSec || mvDurationSec || 0;
        if (outroEnd > endSyncMv + 0.5) {
          return {
            uiOpacity: Math.max(0, Math.min(1, distToEnd / safeFadeOut)),
            isTheaterClarity: true,
            skipLabel: null,
            skipSubLabel: null,
            songAudioGain,
            mvAudioGain,
          };
        }
      }
    }
  }

  return {
    uiOpacity: 1,
    isTheaterClarity: true,
    skipLabel: null,
    skipSubLabel: null,
    songAudioGain,
    mvAudioGain,
  };
}

export async function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    let settled = false;
    const finish = (dur: number) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };
    const timer = window.setTimeout(() => finish(0), 6000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(video.duration || 0);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    video.src = url;
  });
}

export interface MvSyncSnapshot {
  trackId: string | null;
  trackTitle: string;
  trackArtist: string;
  mvId: string | null;
  mvTitle: string;
  mvSourceType: 'local' | 'url';
  mvExternalUrl?: string;
  mvDurationSec: number;
  mvEnabled: boolean;
  phase: MvTheaterPhase;
  isPlaying: boolean;
  audioTime: number;
  audioDuration: number;
  mvTargetTime: number;
  mvPlaybackRate: number;
  mvMuted: boolean;
  mvAudioGain?: number;
  audioSettings?: AudioDspSettings;
  volume: number;
  muted: boolean;
  blurPx: number;
  opacityPct: number;
  uiOpacity: number;
  isTheaterClarity: boolean;
  skipLabel: string | null;
  skipSubLabel: string | null;
  sentAt: number;
}

export type MvRemoteCommand =
  | { type: 'STANDALONE_HELLO'; timestamp: number }
  | { type: 'STANDALONE_HEARTBEAT'; timestamp: number }
  | { type: 'STANDALONE_BYE'; timestamp: number }
  | { type: 'REQUEST_SYNC'; timestamp: number }
  | { type: 'REQUEST_MV_BLOB'; mvId: string; timestamp: number }
  | { type: 'SKIP_PHASE'; timestamp: number }
  | { type: 'TOGGLE_PLAY'; timestamp: number }
  | { type: 'NEXT_TRACK'; timestamp: number }
  | { type: 'PREV_TRACK'; timestamp: number }
  | { type: 'SEEK_MV'; mvTimeSec: number; timestamp: number }
  | { type: 'MV_ENDED_IN_OUTRO'; timestamp: number };

export interface MvBlobResponseMessage {
  type: 'MV_BLOB_RESPONSE';
  mvId: string;
  videoBlob?: Blob;
  externalUrl?: string;
  durationSec?: number;
}
