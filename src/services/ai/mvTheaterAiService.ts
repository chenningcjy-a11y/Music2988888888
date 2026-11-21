import { TrackMetadata, TrackMvMeta } from '../../types/music';
import { parseLrc } from '../../utils/lrcParser';
import {
  LOCAL_ENGINE_PRESETS,
  LocalEnginePreset,
  LocalEnsembleAnalysisResult,
  LocalFullTrackAnalysisResult,
  runLocalAllPresetsConsensus,
  runLocalFullTrackAnalysis,
} from './localAcousticAnalyzer';

export interface MvTheaterAiIntroSuggestion {
  recommended: boolean;
  introEndSec: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidenceTimestamps: number[];
}

export interface MvTheaterAiMidBreakSuggestion {
  id: string;
  label: string;
  audioTriggerSec: number;
  mvStartSec: number;
  mvEndSec: number;
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

export interface MvTheaterAiAnalysisStats {
  fullTrackCoveragePct: number;
  meanCorrelation: number;
  peakCorrelation: number;
  plateauCount: number;
  recommendedFadeSec: number;
  mvHasAudio: boolean;
  songHasAudio: boolean;
}

export interface MvTheaterEnsembleCandidateView {
  preset: LocalEnginePreset;
  name: string;
  modelCode: string;
  introAgreeCount: number;
  midAgreeCount: number;
  outroAgreeCount: number;
  exactAllMatchCount: number;
  isWinner: boolean;
  inWinningGroup: boolean;
  fullResult: MvTheaterAiAnalysisResult;
}

export interface MvTheaterEnsembleSummary {
  winningPreset: LocalEnginePreset;
  winningPresetName: string;
  introConsensusCount: number;
  midConsensusCount: number;
  outroConsensusCount: number;
  exactGroupCount: number;
  consensusSummary: string;
  candidates: MvTheaterEnsembleCandidateView[];
}

export interface MvTheaterAiAnalysisResult {
  providerName: string;
  modelUsed: string;
  usedVisualFrames: boolean;
  usedLocalEngine: boolean;
  summary: string;
  intro: MvTheaterAiIntroSuggestion;
  midBreaks: MvTheaterAiMidBreakSuggestion[];
  outro: MvTheaterAiOutroSuggestion;
  analysisStats?: MvTheaterAiAnalysisStats;
  ensembleComparison?: MvTheaterEnsembleSummary;
}

export class MvTheaterCloudError extends Error {
  localDraftResult: MvTheaterAiAnalysisResult;

  constructor(message: string, localDraftResult: MvTheaterAiAnalysisResult) {
    super(message);
    this.name = 'MvTheaterCloudError';
    this.localDraftResult = localDraftResult;
  }
}

async function captureMvKeyframes(
  videoUrl: string,
  timestampsSec: number[],
  durationSec: number
): Promise<{ timestampSec: number; mimeType: string; base64Data: string }[]> {
  if (!videoUrl || durationSec <= 0 || timestampsSec.length === 0) return [];

  const uniqueTimes = Array.from(
    new Set(
      timestampsSec.map((t) =>
        Math.max(
          0.2,
          Math.min(Math.max(0.2, durationSec - 0.2), Number(t.toFixed(1)))
        )
      )
    )
  )
    .sort((a, b) => a - b)
    .slice(0, 10);

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

    const captured: { timestampSec: number; mimeType: string; base64Data: string }[] =
      [];
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

    const overallTimer = window.setTimeout(finish, 7500);

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

function buildLocalResult(
  local: LocalFullTrackAnalysisResult,
  preset: LocalEnginePreset = 'standard'
): MvTheaterAiAnalysisResult {
  const cfg = LOCAL_ENGINE_PRESETS[preset] || LOCAL_ENGINE_PRESETS.standard;
  return {
    providerName: cfg.name,
    modelUsed: cfg.modelCode,
    usedVisualFrames: false,
    usedLocalEngine: true,
    summary: local.summary,
    intro: local.intro,
    midBreaks: local.midBreaks.map((b) => ({
      id: b.id,
      label: b.label,
      audioTriggerSec: b.audioTriggerSec,
      mvStartSec: b.mvStartSec,
      mvEndSec: b.mvEndSec,
      confidence: b.confidence,
      reason: b.reason,
      evidenceTimestamps: b.evidenceTimestamps,
    })),
    outro: local.outro,
    analysisStats: {
      fullTrackCoveragePct: local.fullTrackCoveragePct,
      meanCorrelation: local.meanCorrelation,
      peakCorrelation: local.peakCorrelation,
      plateauCount: local.plateaus.length,
      recommendedFadeSec: local.recommendedFadeSec,
      mvHasAudio: local.mvHasAudio,
      songHasAudio: local.songHasAudio,
    },
  };
}

function buildEnsembleResult(
  ensemble: LocalEnsembleAnalysisResult
): MvTheaterAiAnalysisResult {
  const winningBase = buildLocalResult(ensemble.winningResult, ensemble.winningPreset);
  const candidates: MvTheaterEnsembleCandidateView[] = ensemble.candidates.map(
    (c) => ({
      preset: c.preset,
      name: c.name,
      modelCode: c.modelCode,
      introAgreeCount: c.introAgreeCount,
      midAgreeCount: c.midAgreeCount,
      outroAgreeCount: c.outroAgreeCount,
      exactAllMatchCount: c.exactAllMatchCount,
      isWinner: c.isWinner,
      inWinningGroup: c.inWinningGroup,
      fullResult: buildLocalResult(c.result, c.preset),
    })
  );

  return {
    ...winningBase,
    providerName: `4 模型联合共识投票 (主选: ${ensemble.winningPresetName})`,
    modelUsed: 'DSP-All-4-Consensus',
    ensembleComparison: {
      winningPreset: ensemble.winningPreset,
      winningPresetName: ensemble.winningPresetName,
      introConsensusCount: ensemble.introConsensusCount,
      midConsensusCount: ensemble.midConsensusCount,
      outroConsensusCount: ensemble.outroConsensusCount,
      exactGroupCount: ensemble.exactGroupCount,
      consensusSummary: ensemble.consensusSummary,
      candidates,
    },
  };
}

export async function runMvTheaterAiAnalysis(params: {
  providerId?: string;
  model?: string;
  localPreset?: LocalEnginePreset | 'all';
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
    localPreset = 'standard',
    track,
    mv,
    mvVideoUrl,
    mvDurationSec,
    songDurationSec,
    onStageProgress,
  } = params;

  // When "all" local consensus mode is selected, decode once, run all 4 models, and pick max-agreement group
  if (localPreset === 'all') {
    const ensemble = await runLocalAllPresetsConsensus({
      track,
      mv,
      mvDurationSec,
      songDurationSec,
      onProgress: onStageProgress,
    });
    const consensusResult = buildEnsembleResult(ensemble);
    if (!providerId || providerId.startsWith('__local_engine__')) {
      return consensusResult;
    }
    // If paired with a cloud provider, pass the winning consensus draft
    const local = ensemble.winningResult;
    const localResult = consensusResult;
    return await runCloudHybridRefinement({
      providerId,
      model,
      track,
      mv,
      mvVideoUrl,
      local,
      localResult,
      onStageProgress,
    });
  }

  // Always run full-song vs full-MV multi-band acoustic comparison locally first!
  const local = await runLocalFullTrackAnalysis({
    track,
    mv,
    mvDurationSec,
    songDurationSec,
    preset: localPreset,
    onProgress: onStageProgress,
  });

  const localResult = buildLocalResult(local, localPreset);

  // Pure local full-track AI mode: return zero-latency local analysis directly
  if (!providerId || providerId.startsWith('__local_engine__')) {
    return localResult;
  }

  return await runCloudHybridRefinement({
    providerId,
    model,
    track,
    mv,
    mvVideoUrl,
    local,
    localResult,
    onStageProgress,
  });
}

async function runCloudHybridRefinement(params: {
  providerId: string;
  model?: string;
  track: TrackMetadata;
  mv: TrackMvMeta;
  mvVideoUrl: string;
  local: LocalFullTrackAnalysisResult;
  localResult: MvTheaterAiAnalysisResult;
  onStageProgress?: (stageLabel: string) => void;
}): Promise<MvTheaterAiAnalysisResult> {
  const {
    providerId,
    model,
    track,
    mv,
    mvVideoUrl,
    local,
    localResult,
    onStageProgress,
  } = params;

  // Cloud + Local hybrid mode: capture strategic keyframes across Intro, Mid-Breaks & Outro
  onStageProgress?.('4/5 正在截取前瞻、中段与片尾临界点画面帧...');
  const sampleTimestamps: number[] = [
    1.5,
    Math.max(1, local.intro.introEndSec - 2.0),
    local.intro.introEndSec,
    Math.min(local.mvDurationSec - 0.5, local.intro.introEndSec + 2.0),
  ];

  for (const brk of local.midBreaks.slice(0, 2)) {
    sampleTimestamps.push(brk.mvStartSec);
    sampleTimestamps.push(brk.mvEndSec);
  }

  sampleTimestamps.push(
    Math.max(1, local.outro.outroStartSec - 2.0),
    local.outro.outroStartSec,
    Math.max(1, local.mvDurationSec - 2.5)
  );

  const frames = await captureMvKeyframes(
    mvVideoUrl,
    sampleTimestamps,
    local.mvDurationSec
  );

  const parsedLrcLines = track.lyricsRaw ? parseLrc(track.lyricsRaw).lines : [];
  const firstLyricSec =
    parsedLrcLines.length > 0 ? Number(parsedLrcLines[0].time.toFixed(1)) : null;
  const lastLyricSec =
    parsedLrcLines.length > 0
      ? Number(parsedLrcLines[parsedLrcLines.length - 1].time.toFixed(1))
      : null;

  onStageProgress?.('5/5 正在融合本地全曲声纹结论与云端 AI 联合校验前瞻/中段/后段...');

  try {
    const res = await fetch('/api/ai/tasks/mv-theater-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        model,
        mvDurationSec: local.mvDurationSec,
        songDurationSec: local.songDurationSec,
        trackTitle: track.title,
        artistName: track.artist,
        mvTitle: mv.title,
        firstLyricSec,
        lastLyricSec,
        headCorrelationCandidates: local.plateaus.slice(0, 2).map((p) => ({
          mvOffsetSec: p.lagSec,
          estimatedBoundarySec: Number(Math.max(0, p.lagSec).toFixed(1)),
          similarityScore: p.meanCorrelation,
        })),
        tailCorrelationCandidates: local.plateaus.slice(-2).map((p) => ({
          mvOffsetSec: p.mvStartSec,
          estimatedBoundarySec: Number(
            Math.min(local.mvDurationSec, local.songDurationSec + p.lagSec).toFixed(1)
          ),
          similarityScore: p.meanCorrelation,
        })),
        alignmentPlateaus: local.plateaus,
        localDraft: {
          summary: local.summary,
          fullTrackCoveragePct: local.fullTrackCoveragePct,
          meanCorrelation: local.meanCorrelation,
          intro: local.intro,
          midBreaks: local.midBreaks,
          outro: local.outro,
        },
        mvSilenceSegments: local.mvSilenceSegments,
        mvEnergyTimeline: local.mvEnergyTimeline,
        songEnergyTimeline: local.songEnergyTimeline,
        frames,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new MvTheaterCloudError(
        json?.error || `云端 AI 分析失败 (${res.status})`,
        localResult
      );
    }

    const cloudMidBreaks: MvTheaterAiMidBreakSuggestion[] = Array.isArray(
      json.midBreaks
    )
      ? json.midBreaks
      : localResult.midBreaks;

    return {
      providerName: json.providerName || '云端 + 本地联合引擎',
      modelUsed: json.modelUsed || model || 'auto',
      usedVisualFrames: Boolean(json.usedVisualFrames),
      usedLocalEngine: true,
      summary: json.summary || local.summary,
      intro: json.intro || local.intro,
      midBreaks: cloudMidBreaks,
      outro: json.outro || local.outro,
      analysisStats: localResult.analysisStats,
    };
  } catch (err) {
    if (err instanceof MvTheaterCloudError) throw err;
    throw new MvTheaterCloudError(
      err instanceof Error ? err.message : '云端 AI 请求失败',
      localResult
    );
  }
}
