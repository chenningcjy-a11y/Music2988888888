import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Disc3,
  Download,
  FileAudio,
  Headphones,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useMusic } from '../../context/MusicContext';
import { useTaskCenter } from '../../context/TaskCenterContext';
import { getTrackStems } from '../../services/storage';
import { AiTaskCategory, AiTaskRecord, AiTaskStatus } from '../../types/ai';
import { TrackStemsRecord } from '../../types/music';
import {
  formatBitrate,
  formatFileSize,
  formatSampleRate,
  formatTime,
} from '../../utils/constants';

interface TaskDetailViewProps {
  task: AiTaskRecord;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<AiTaskCategory, string> = {
  stem_separation: '人声与伴奏分离',
  audio_analysis: 'AI 歌曲分析',
  lyrics_assistant: 'AI 歌词处理',
  dsp_tuning: 'AI 智能调音',
  audio_processing: 'AI 音频处理',
  intent_routing: 'AI 智能调度',
  custom: '自定义 AI 任务',
};

const STATUS_META: Record<
  AiTaskStatus,
  { label: string; colorClass: string }
> = {
  queued: { label: '等待队列', colorClass: 'text-amber-300' },
  running: { label: '正在执行', colorClass: 'text-sky-300' },
  paused: { label: '已暂停', colorClass: 'text-violet-300' },
  awaiting_confirmation: { label: '待确认', colorClass: 'text-amber-200' },
  completed: { label: '已完成', colorClass: 'text-emerald-300' },
  cancelled: { label: '已取消', colorClass: 'text-white/55' },
  interrupted: { label: '已中断', colorClass: 'text-amber-300' },
  needs_resubmit: { label: '等待重新执行', colorClass: 'text-amber-300' },
  error: { label: '执行失败', colorClass: 'text-rose-300' },
};

function formatTimestamp(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const TaskDetailView: React.FC<TaskDetailViewProps> = ({
  task,
  onBack,
}) => {
  const {
    activePalette,
    tracks,
    importTrackAndStemsToPlayer,
    pauseMainPlayer,
    showToast,
  } = useMusic();
  const {
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    deleteTaskRecord,
    deleteTaskStemResult,
  } = useTaskCenter();

  const [stemRecord, setStemRecord] = useState<TrackStemsRecord | null>(null);
  const [loadingStems, setLoadingStems] = useState(false);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState<
    'vocal' | 'instrumental' | null
  >(null);

  const sourceTrackStillInLibrary = Boolean(
    task.sourceTrackId && tracks.some((t) => t.id === task.sourceTrackId)
  );

  // Hydrate separated stems strictly by task.sourceTrackId (NEVER currentTrack)
  useEffect(() => {
    let active = true;
    if (task.category !== 'stem_separation' || !task.sourceTrackId) {
      setStemRecord(null);
      return;
    }
    setLoadingStems(true);
    getTrackStems(task.sourceTrackId)
      .then((rec) => {
        if (active) setStemRecord(rec || null);
      })
      .finally(() => {
        if (active) setLoadingStems(false);
      });
    return () => {
      active = false;
    };
  }, [task.category, task.sourceTrackId, task.status, task.stemMeta]);

  // Clean up independent preview player on unmount or task change
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = '';
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [task.id]);

  const togglePreviewStem = async (stemType: 'vocal' | 'instrumental') => {
    if (!stemRecord) return;
    const audio =
      previewAudioRef.current || (previewAudioRef.current = new Audio());

    if (previewPlaying === stemType && !audio.paused) {
      audio.pause();
      setPreviewPlaying(null);
      return;
    }

    pauseMainPlayer();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const blob =
      stemType === 'vocal' ? stemRecord.vocalBlob : stemRecord.instrumentalBlob;
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    audio.src = url;
    audio.onended = () => setPreviewPlaying(null);
    try {
      await audio.play();
      setPreviewPlaying(stemType);
    } catch {
      showToast('无法播放试听音轨，请检查浏览器音频权限');
      setPreviewPlaying(null);
    }
  };

  const stMeta = STATUS_META[task.status];
  const baseTitle = task.sourceTrackTitle || task.trackTitle || task.taskName;
  const safeFileBase = baseTitle.replace(/[\\/:*?"<>|]/g, '_');

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回任务列表</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {task.category === 'stem_separation' &&
            (task.status === 'running' || task.status === 'queued') && (
              <button
                type="button"
                onClick={() => void pauseTask(task.id)}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>暂停任务</span>
              </button>
            )}

          {task.status === 'paused' && (
            <button
              type="button"
              onClick={() => void resumeTask(task.id)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              <Play className="w-3.5 h-3.5" fill="currentColor" />
              <span>继续执行</span>
            </button>
          )}

          {(task.status === 'running' ||
            task.status === 'queued' ||
            task.status === 'paused') && (
            <button
              type="button"
              onClick={() => void cancelTask(task.id)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600/85 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" fill="currentColor" />
              <span>取消任务</span>
            </button>
          )}

          {(task.status === 'error' ||
            task.status === 'interrupted' ||
            task.status === 'needs_resubmit' ||
            task.status === 'cancelled') && (
            <button
              type="button"
              onClick={() => void retryTask(task.id)}
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {task.status === 'needs_resubmit' ? '重新提交任务' : '重试任务'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              await deleteTaskRecord(task.id);
              onBack();
            }}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-rose-500/20 border border-white/12 text-xs text-white/75 hover:text-rose-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除任务记录</span>
          </button>
        </div>
      </div>

      {/* Primary Immutable Source & Status Card */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 bg-gradient-to-br from-rose-900/50 via-purple-900/50 to-black/70 border border-white/15 flex items-center justify-center">
            {task.sourceTrackCoverUrl ? (
              <img
                src={task.sourceTrackCoverUrl}
                alt={baseTitle}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <Disc3 className="w-8 h-8 text-white/50" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span>{CATEGORY_LABELS[task.category]}</span>
              <span aria-hidden="true">·</span>
              <span className={`font-medium ${stMeta.colorClass}`}>
                {stMeta.label}
              </span>
              {task.stepLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular text-white/75">
                    步骤 {task.stepLabel}
                  </span>
                </>
              )}
            </div>

            <h2 className="font-display text-xl sm:text-2xl font-semibold text-white truncate">
              {baseTitle}
            </h2>

            <p className="text-xs sm:text-sm text-white/65 truncate">
              {task.sourceTrackArtist || '未知艺术家'}
              {task.sourceTrackAlbum ? ` · ${task.sourceTrackAlbum}` : ''}
            </p>

            <p className="text-[11px] font-mono-tabular text-white/40 truncate">
              Task ID: {task.id}
              {task.sourceTrackId ? ` · Track ID: ${task.sourceTrackId}` : ''}
            </p>
          </div>
        </div>

        {/* Real Progress Strip */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between text-xs gap-3">
            <span className="text-white/85 flex items-center gap-1.5 min-w-0 truncate">
              {task.status === 'running' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-sky-300" />
              )}
              {task.status === 'completed' && (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
              )}
              {(task.status === 'error' ||
                task.status === 'interrupted' ||
                task.status === 'needs_resubmit') && (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-300" />
              )}
              <span className="truncate">
                {task.stageLabel || stMeta.label}
              </span>
            </span>

            <div className="flex items-center gap-3 shrink-0 font-mono-tabular text-white/80">
              {task.estimatedRemainingSec != null &&
                task.estimatedRemainingSec > 0 &&
                task.status === 'running' && (
                  <span className="text-white/55">
                    预计剩余约 {task.estimatedRemainingSec}s
                  </span>
                )}
              <span className="font-semibold">{task.progress}%</span>
            </div>
          </div>

          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(task.status === 'queued' ? 2 : 0, task.progress)}%`,
                background:
                  task.status === 'error'
                    ? '#f43f5e'
                    : task.status === 'completed'
                    ? '#10b981'
                    : `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            />
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-white/10 text-xs">
          <div>
            <span className="text-white/45 block">分离模型 / AI 模型</span>
            <span className="text-white font-medium mt-1 block truncate">
              {task.modelName} ({task.providerName})
            </span>
          </div>
          <div>
            <span className="text-white/45 block">执行引擎</span>
            <span className="text-white font-medium mt-1 block truncate">
              {task.engineLabel || '默认引擎'}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">源文件参数</span>
            <span className="text-white font-mono-tabular mt-1 block truncate">
              {task.sourceFileInfo
                ? `${task.sourceFileInfo.format} · ${formatFileSize(
                    task.sourceFileInfo.fileSizeBytes
                  )} · ${formatTime(task.sourceFileInfo.durationSec)}`
                : '—'}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">采样率 / 码率</span>
            <span className="text-white font-mono-tabular mt-1 block truncate">
              {task.sourceFileInfo
                ? `${formatSampleRate(
                    task.sourceFileInfo.sampleRate
                  )} · ${formatBitrate(task.sourceFileInfo.bitrate)}`
                : '—'}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">创建时间</span>
            <span className="text-white/80 font-mono-tabular mt-1 block">
              {formatTimestamp(task.createdAt || task.startedAt)}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">开始时间</span>
            <span className="text-white/80 font-mono-tabular mt-1 block">
              {formatTimestamp(task.startedAt)}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">完成时间</span>
            <span className="text-white/80 font-mono-tabular mt-1 block">
              {formatTimestamp(task.finishedAt)}
            </span>
          </div>
          <div>
            <span className="text-white/45 block">原始音频标识</span>
            <span className="text-white/70 font-mono-tabular mt-1 block truncate">
              {task.sourceFileInfo?.fileIdentifier || task.sourceTrackId || '—'}
            </span>
          </div>
        </div>

        {/* Error Message */}
        {task.errorMessage && (
          <div className="rounded-2xl bg-rose-500/12 border border-rose-400/25 p-4 flex items-start gap-2.5 text-xs text-rose-100">
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">错误与中断说明</p>
              <p className="text-rose-200/90 leading-relaxed">
                {task.errorMessage}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Stem Separation Results Panel (Decoupled from currentTrack!) */}
      {task.category === 'stem_separation' && task.status === 'completed' && (
        <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">
                分离结果音轨（独立绑定至原曲：{baseTitle}）
              </h3>
              <p className="text-xs text-white/55 mt-0.5">
                试听操作仅在此详情页内独立播放，不会更改主播放器当前播放曲目；如需混音请点击「导入播放器」
              </p>
            </div>

            {stemRecord && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!sourceTrackStillInLibrary}
                  onClick={() =>
                    task.sourceTrackId &&
                    void importTrackAndStemsToPlayer(task.sourceTrackId)
                  }
                  title={
                    sourceTrackStillInLibrary
                      ? '加载原曲与分离双轨至主播放器'
                      : '曲库中已找不到该原曲'
                  }
                  className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  style={{
                    background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  }}
                >
                  <Headphones className="w-4 h-4" />
                  <span>导入播放器</span>
                </button>

                <button
                  type="button"
                  onClick={() => void deleteTaskStemResult(task.id)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-xs text-rose-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除分离结果</span>
                </button>
              </div>
            )}
          </div>

          {loadingStems ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-white/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>正在读取分离音轨缓存…</span>
            </div>
          ) : !stemRecord ? (
            <div className="rounded-2xl bg-black/25 border border-white/10 p-5 text-xs text-white/65 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileAudio className="w-4 h-4 text-white/45 shrink-0" />
                <span>该任务的分离音轨缓存已被清理。原始歌曲仍保留在曲库中。</span>
              </div>
              {sourceTrackStillInLibrary && (
                <button
                  type="button"
                  onClick={() => void retryTask(task.id)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-white cursor-pointer whitespace-nowrap"
                >
                  重新分离
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vocal Track */}
              <div className="rounded-2xl bg-gradient-to-br from-fuchsia-500/[0.12] to-transparent border border-fuchsia-400/25 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Mic2 className="w-4 h-4 text-fuchsia-300" />
                    <span className="text-sm font-semibold text-white">
                      Vocal：人声音轨
                    </span>
                  </div>
                  <span className="text-xs font-mono-tabular text-fuchsia-200/80">
                    {formatFileSize(stemRecord.vocalBlob.size)} · WAV
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void togglePreviewStem('vocal')}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-fuchsia-500/25 hover:bg-fuchsia-500/35 border border-fuchsia-400/35 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {previewPlaying === 'vocal' ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>停止试听人声</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>试听人声</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      triggerBlobDownload(
                        stemRecord.vocalBlob,
                        `${safeFileBase}-Vocal.wav`
                      )
                    }
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载人声</span>
                  </button>
                </div>
              </div>

              {/* Instrumental Track */}
              <div className="rounded-2xl bg-gradient-to-br from-indigo-500/[0.14] to-transparent border border-indigo-400/25 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music2 className="w-4 h-4 text-indigo-300" />
                    <span className="text-sm font-semibold text-white">
                      Instrumental：伴奏音轨
                    </span>
                  </div>
                  <span className="text-xs font-mono-tabular text-indigo-200/80">
                    {formatFileSize(stemRecord.instrumentalBlob.size)} · WAV
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void togglePreviewStem('instrumental')}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-indigo-500/25 hover:bg-indigo-500/35 border border-indigo-400/35 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {previewPlaying === 'instrumental' ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>停止试听伴奏</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>试听伴奏</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      triggerBlobDownload(
                        stemRecord.instrumentalBlob,
                        `${safeFileBase}-Instrumental.wav`
                      )
                    }
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载伴奏</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Stage Timeline Log */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/70" />
          <h3 className="text-sm font-semibold text-white">任务处理阶段日志</h3>
        </div>

        {(!task.stageLogs || task.stageLogs.length === 0) ? (
          <p className="text-xs text-white/50">
            {task.resultSummary || task.stageLabel || '暂无详细阶段记录'}
          </p>
        ) : (
          <div className="divide-y divide-white/8 text-xs">
            {task.stageLogs.map((log, i) => (
              <div
                key={`${log.timestamp}-${i}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono-tabular text-white/45 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                      hour12: false,
                    })}
                  </span>
                  <span className="text-white/90 font-medium truncate">
                    {log.stage}
                  </span>
                </div>
                {log.detail && (
                  <span className="text-white/55 truncate sm:max-w-md">
                    {log.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
