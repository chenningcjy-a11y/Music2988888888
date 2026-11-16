import { TrackMetadata, TrackMvMeta } from '../../types/music';
import { parseLrc } from '../../utils/lrcParser';
import {
  extractMvAudioWaveform,
  extractTrackAudioWaveform,
} from '../../utils/mvAudioWaveform';

export interface MvTheaterAiIntroSuggestion {
  recommended: boolean;
  introEndSec: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidenceTimestamps: number[];
}

export interface MvTheaterAiOutroSuggestion {
  recommended: boolean;
  outroStartSec: number;
  outroEndSec: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidenceTimestamps: number[];
}

export interface MvTheaterAiAnalysisResult {
  providerName: string;
  modelUsed: string;
  usedVisualFrames: boolean;
  summary: string;
  intro: MvTheaterAiIntroSuggestion;
  outro: MvTheaterAiOutroSuggestion;
}

interface CorrelationCandidate {
  mvOffsetSec: number;
  estimatedBoundarySec: number;
  similarityScore: number;
}

/**
 * Slides a slice of the song energy envelope over the MV energy envelope to locate
 * acoustic alignment peaks (handles quiet dialogue intros and credit outros).
 */
function findEnvelopeCorrelationPeaks(
  mvBins: number[],
  mvBinDurSec: number,
  songSegmentBins: number[],
  maxCandidates = 3
): { offsetBin: number; score: number }[] {
  if (mvBins.length === 0 || songSegmentBins.length < 8) return [];
  if (mvBins.length < songSegmentBins.length) return [];

  const maxOffset = mvBins.length - songSegmentBins.length;
  const scores: { offsetBin: number; score: number }[] = [];

  let songMean = 0;
  for (let j = 0; j < songSegmentBins.length; j++) songMean += songSegmentBins[j];
  songMean /= songSegmentBins.length;

  let songVar = 0;
  for (let j = 0; j < songSegmentBins.length; j++) {
    const d = songSegmentBins[j] - songMean;
    songVar += d * d;
  }
  if (songVar < 1e-6) return [];

  for (let offset = 0; offset <= maxOffset; offset++) {
    let mvMean = 0;
    for (let j = 0; j < songSegmentBins.length; j++) {
      mvMean += mvBins[offset + j];
    }
    mvMean /= songSegmentBins.length;

    let num = 0;
    let mvVar = 0;
    for (let j = 0; j < songSegmentBins.length; j++) {
      const a = mvBins[offset + j] - mvMean;
      const b = songSegmentBins[j] - songMean;
      num += a * b;
      mvVar += a * a;
    }

    const denom = Math.sqrt(mvVar * songVar);
    const pearson = denom > 1e-6 ? num / denom : 0;
    scores.push({ offsetBin: offset, score: Number(pearson.toFixed(3)) });
  }

  scores.sort((a, b) => b.score - a.score);

  const minSeparationBins = Math.max(4, Math.round(4 / Math.max(0.1, mvBinDurSec)));
  const picked: { offsetBin: number; score: number }[] = [];
  for (const cand of scores) {
    if (
      picked.every(
        (existing) => Math.abs(existing.offsetBin - cand.offsetBin) >= minSeparationBins
      )
    ) {
      picked.push(cand);
      if (picked.length >= maxCandidates) break;
    }
  }
  return picked;
}

function detectQuietSegments(
  mvBins: number[],
  binDurSec: number,
  threshold = 0.16,
  minLengthSec = 1.5
): { startSec: number; endSec: number; avgLevel: number }[] {
  const out: { startSec: number; endSec: number; avgLevel: number }[] = [];
  let runStart = -1;
  let sum = 0;
  let count = 0;

  for (let i = 0; i <= mvBins.length; i++) {
    const isQuiet = i < mvBins.length && mvBins[i] <= threshold;
    if (isQuiet) {
      if (runStart === -1) {
        runStart = i;
        sum = 0;
        count = 0;
      }
      sum += mvBins[i];
      count++;
    } else if (runStart !== -1) {
      const startSec = Number((runStart * binDurSec).toFixed(1));
      const endSec = Number((i * binDurSec).toFixed(1));
      if (endSec - startSec >= minLengthSec) {
        out.push({
          startSec,
          endSec,
          avgLevel: Math.round((sum / Math.max(1, count)) * 100),
        });
      }
      runStart = -1;
    }
  }
  return out.slice(0, 12);
}

async function captureMvKeyframes(
  videoUrl: string,
  timestampsSec: number[],
  durationSec: number
): Promise<{ timestampSec: number; mimeType: string; base64Data: string }[]> {
  if (!videoUrl || durationSec <= 0 || timestampsSec.length === 0) return [];

  const uniqueTimes = Array.from(
    new Set(
      timestampsSec
        .map((t) => Math.max(0.2, Math.min(Math.max(0.2, durationSec - 0.2), Number(t.toFixed(1)))))
    )
  )
    .sort((a, b) => a - b)
    .slice(0, 8);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    if (!videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
      video.crossOrigin = 'anonymous';
    }

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');

    const captured: { timestampSec: number; mimeType: string; base64Data: string }[] = [];
    let settled = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(overallTimer);
      cleanup();
      resolve(captured);
    };

    const overallTimer = window.setTimeout(finish, 7000);

    const captureNext = async (idx: number) => {
      if (settled || idx >= uniqueTimes.length || !ctx) {
        finish();
        return;
      }
      const target = uniqueTimes[idx];
      await new Promise<void>((resSeek) => {
        let seekDone = false;
        const tId = window.setTimeout(() => {
          if (!seekDone) {
            seekDone = true;
            resSeek();
          }
        }, 900);
        const onSeeked = () => {
          if (seekDone) return;
          seekDone = true;
          window.clearTimeout(tId);
          video.removeEventListener('seeked', onSeeked);
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.58);
            const base64 = dataUrl.split(',')[1];
            if (base64 && base64.length > 50) {
              captured.push({
                timestampSec: target,
                mimeType: 'image/jpeg',
                base64Data: base64,
              });
            }
          } catch {
            // Tainted CORS video cannot export frames; proceed cleanly with acoustic profile
          }
          resSeek();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        try {
          video.currentTime = target;
        } catch {
          window.clearTimeout(tId);
          seekDone = true;
          resSeek();
        }
      });
      await captureNext(idx + 1);
    };

    video.onloadeddata = () => {
      captureNext(0);
    };
    video.onerror = () => {
      finish();
    };
    video.src = videoUrl;
  });
}

function summarizeTimelineBySecond(
  bins: number[],
  totalDurationSec: number,
  maxPoints = 90
): { tSec: number; level: number }[] {
  if (bins.length === 0 || totalDurationSec <= 0) return [];
  const step = Math.max(1, Math.ceil(bins.length / maxPoints));
  const out: { tSec: number; level: number }[] = [];
  for (let i = 0; i < bins.length; i += step) {
    let sum = 0;
    let cnt = 0;
    for (let k = i; k < Math.min(bins.length, i + step); k++) {
      sum += bins[k];
      cnt++;
    }
    const tSec = Number((((i + cnt / 2) / bins.length) * totalDurationSec).toFixed(1));
    out.push({
      tSec,
      level: Math.round((sum / Math.max(1, cnt)) * 100),
    });
  }
  return out;
}

export async function runMvTheaterAiAnalysis(params: {
  providerId?: string;
  model?: string;
  track: TrackMetadata;
  mv: TrackMvMeta;
  mvVideoUrl: string;
  mvDurationSec: number;
  songDurationSec: number;
  onStageProgress?: (stageLabel: string) => void;
}): Promise<MvTheaterAiAnalysisResult> {
  const {
    providerId,
    model,
    track,
    mv,
    mvVideoUrl,
    mvDurationSec,
    songDurationSec,
    onStageProgress,
  } = params;

  const safeMvDur = Math.max(1, mvDurationSec || mv.durationSec || 1);
  const safeSongDur = Math.max(1, songDurationSec || track.duration || 1);

  // Extract 0.5-second resolution envelopes (capped cleanly for accuracy)
  const mvBuckets = Math.min(900, Math.max(60, Math.round(safeMvDur * 2)));
  const songBuckets = Math.min(900, Math.max(60, Math.round(safeSongDur * 2)));

  onStageProgress?.('1/3 正在解析 MV 与音乐声波包络并计算互相关对齐位置...');

  const [mvWave, songWave] = await Promise.all([
    extractMvAudioWaveform({
      mvId: mv.id,
      sourceType: mv.sourceType,
      externalUrl: mv.externalUrl,
      buckets: mvBuckets,
    }),
    extractTrackAudioWaveform({
      trackId: track.id,
      buckets: songBuckets,
    }),
  ]);

  const mvBins = mvWave.peaks;
  const songBins = songWave.peaks;
  const actualMvDur = mvWave.durationSec > 0 ? mvWave.durationSec : safeMvDur;
  const actualSongDur = songWave.durationSec > 0 ? songWave.durationSec : safeSongDur;
  const mvBinDurSec = mvBins.length > 0 ? actualMvDur / mvBins.length : 0.5;
  const songBinDurSec = songBins.length > 0 ? actualSongDur / songBins.length : 0.5;

  // Compute acoustic head & tail correlation peaks
  const headWindowSec = Math.min(48, actualSongDur * 0.45);
  const headSongCount = Math.min(
    songBins.length,
    Math.max(12, Math.round(headWindowSec / Math.max(0.1, songBinDurSec)))
  );
  const tailSongCount = Math.min(
    songBins.length,
    Math.max(12, Math.round(headWindowSec / Math.max(0.1, songBinDurSec)))
  );

  // Resample song snippet to MV bin spacing when MV audio waveform is available
  const resampleSlice = (
    src: number[],
    startIdx: number,
    count: number,
    srcBinSec: number,
    dstBinSec: number
  ): number[] => {
    const sliceDur = count * srcBinSec;
    const outLen = Math.max(8, Math.round(sliceDur / Math.max(0.1, dstBinSec)));
    const out: number[] = [];
    for (let i = 0; i < outLen; i++) {
      const ratio = i / outLen;
      const idx = Math.min(src.length - 1, Math.floor(startIdx + ratio * count));
      out.push(src[idx] || 0);
    }
    return out;
  };

  const headCandidatesRaw =
    mvBins.length > 0 && songBins.length > 0
      ? findEnvelopeCorrelationPeaks(
          mvBins,
          mvBinDurSec,
          resampleSlice(songBins, 0, headSongCount, songBinDurSec, mvBinDurSec),
          3
        )
      : [];

  const tailStartIdx = Math.max(0, songBins.length - tailSongCount);
  const tailSlice =
    songBins.length > 0
      ? resampleSlice(songBins, tailStartIdx, tailSongCount, songBinDurSec, mvBinDurSec)
      : [];
  const tailCandidatesRaw =
    mvBins.length > 0 && tailSlice.length > 0
      ? findEnvelopeCorrelationPeaks(mvBins, mvBinDurSec, tailSlice, 3)
      : [];

  const headCorrelationCandidates: CorrelationCandidate[] = headCandidatesRaw.map(
    (c) => ({
      mvOffsetSec: Number((c.offsetBin * mvBinDurSec).toFixed(1)),
      estimatedBoundarySec: Number((c.offsetBin * mvBinDurSec).toFixed(1)),
      similarityScore: c.score,
    })
  );

  const tailCorrelationCandidates: CorrelationCandidate[] = tailCandidatesRaw.map(
    (c) => {
      const tailStartSec = c.offsetBin * mvBinDurSec;
      const tailEndSec = Math.min(
        actualMvDur,
        tailStartSec + tailSlice.length * mvBinDurSec
      );
      return {
        mvOffsetSec: Number(tailStartSec.toFixed(1)),
        estimatedBoundarySec: Number(tailEndSec.toFixed(1)),
        similarityScore: c.score,
      };
    }
  );

  const mvSilenceSegments =
    mvBins.length > 0 ? detectQuietSegments(mvBins, mvBinDurSec) : [];

  // Sample strategic video keyframes around candidates & opening/ending regions
  onStageProgress?.('2/3 正在提取 MV 关键画面帧用于视听联合确认...');
  const extraDur = Math.max(0, actualMvDur - actualSongDur);
  const topIntroCand =
    headCorrelationCandidates[0]?.estimatedBoundarySec ??
    Math.min(extraDur * 0.6, actualMvDur * 0.15);
  const topOutroStartCand =
    tailCorrelationCandidates[0]?.estimatedBoundarySec ??
    Math.min(actualMvDur, topIntroCand + actualSongDur);

  const sampleTimestamps = [
    1.5,
    Math.max(2, topIntroCand - 2.5),
    topIntroCand,
    Math.min(actualMvDur - 1, topIntroCand + 2.5),
    Math.max(1, topOutroStartCand - 2.5),
    topOutroStartCand,
    Math.min(actualMvDur - 0.5, topOutroStartCand + 2.5),
    Math.max(1, actualMvDur - 3),
  ];
  const frames = await captureMvKeyframes(mvVideoUrl, sampleTimestamps, actualMvDur);

  // Extract LRC vocal boundaries if present
  const parsedLrcLines = track.lyricsRaw ? parseLrc(track.lyricsRaw).lines : [];
  const firstLyricSec =
    parsedLrcLines.length > 0 ? Number(parsedLrcLines[0].time.toFixed(1)) : null;
  const lastLyricSec =
    parsedLrcLines.length > 0
      ? Number(parsedLrcLines[parsedLrcLines.length - 1].time.toFixed(1))
      : null;

  onStageProgress?.('3/3 AI 正在综合视频画面与声波相关性研判前瞻与后段位置...');

  const res = await fetch('/api/ai/tasks/mv-theater-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId,
      model,
      mvDurationSec: Number(actualMvDur.toFixed(2)),
      songDurationSec: Number(actualSongDur.toFixed(2)),
      trackTitle: track.title,
      artistName: track.artist,
      mvTitle: mv.title,
      firstLyricSec,
      lastLyricSec,
      headCorrelationCandidates,
      tailCorrelationCandidates,
      mvSilenceSegments,
      mvEnergyTimeline: summarizeTimelineBySecond(mvBins, actualMvDur, 90),
      songEnergyTimeline: summarizeTimelineBySecond(songBins, actualSongDur, 90),
      frames,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `AI 分析剧场分段失败 (${res.status})`);
  }

  return json as MvTheaterAiAnalysisResult;
}
