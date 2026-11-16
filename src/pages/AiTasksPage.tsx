import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Disc3,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { TaskDetailView } from '../components/tasks/TaskDetailView';
import { useMusic } from '../context/MusicContext';
import { isRunningOrQueuedStatus, useTaskCenter } from '../context/TaskCenterContext';
import { AiTaskCategory, AiTaskRecord, AiTaskStatus } from '../types/ai';
import { formatFileSize, formatTime } from '../utils/constants';

type TaskFilterTab = 'all' | 'active' | 'completed' | 'failed';

const CATEGORY_LABELS: Record<AiTaskCategory, string> = {
  stem_separation: '人声与伴奏分离',
  audio_analysis: 'AI 歌曲分析',
  lyrics_assistant: 'AI 歌词处理',
  dsp_tuning: 'AI 智能调音',
  audio_processing: 'AI 音频处理',
  intent_routing: 'AI 智能调度',
  custom: '自定义 AI 任务',
};

const STATUS_DISPLAY: Record<
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
  needs_resubmit: { label: '等待重新提交', colorClass: 'text-amber-300' },
  error: { label: '执行失败', colorClass: 'text-rose-300' },
};

function renderStatusIcon(status: AiTaskStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-sky-300 animate-spin shrink-0" />;
    case 'queued':
      return <Clock className="w-4 h-4 text-amber-300 shrink-0" />;
    case 'paused':
      return <Pause className="w-4 h-4 text-violet-300 shrink-0" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />;
    case 'cancelled':
      return <XCircle className="w-4 h-4 text-white/50 shrink-0" />;
    default:
      return <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />;
  }
}

export const AiTasksPage: React.FC = () => {
  const { tracks, currentTrack, activePalette, showToast } = useMusic();
  const {
    tasks,
    selectedTaskId,
    setSelectedTaskId,
    hasLocalBackgroundTask,
    runningCount,
    queuedCount,
    completedCount,
    failedCount,
    enqueueStemSeparationTask,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    deleteTaskRecord,
    clearCompletedOrAllTasks,
  } = useTaskCenter();

  const [filterTab, setFilterTab] = useState<TaskFilterTab>('all');
  const [launcherTrackId, setLauncherTrackId] = useState<string>('');
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!launcherTrackId && tracks.length > 0) {
      setLauncherTrackId(currentTrack?.id || tracks[0].id);
    } else if (launcherTrackId && !tracks.some((t) => t.id === launcherTrackId)) {
      setLauncherTrackId(tracks[0]?.id || '');
    }
  }, [tracks, currentTrack, launcherTrackId]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  const filteredTasks = useMemo(() => {
    switch (filterTab) {
      case 'active':
        return tasks.filter(
          (t) =>
            isRunningOrQueuedStatus(t.status) ||
            t.status === 'awaiting_confirmation'
        );
      case 'completed':
        return tasks.filter((t) => t.status === 'completed');
      case 'failed':
        return tasks.filter(
          (t) =>
            t.status === 'error' ||
            t.status === 'interrupted' ||
            t.status === 'needs_resubmit' ||
            t.status === 'cancelled'
        );
      default:
        return tasks;
    }
  }, [tasks, filterTab]);

  const handleQuickCreateStemTask = async () => {
    const track = tracks.find((t) => t.id === launcherTrackId);
    if (!track) {
      showToast('请先在「我的音乐」导入歌曲后再创建分离任务');
      return;
    }
    setLaunching(true);
    try {
      await enqueueStemSeparationTask(track);
    } catch {
      // Toast already shown in enqueueStemSeparationTask
    } finally {
      setLaunching(false);
    }
  };

  if (selectedTask) {
    return (
      <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6">
        <TaskDetailView
          task={selectedTask}
          onBack={() => setSelectedTaskId(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6">
      {/* Header + Quick Independent Task Launcher */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border border-white/15"
            style={{
              background: `linear-gradient(135deg, ${activePalette.primary}45, ${activePalette.secondary}45)`,
            }}
          >
            <ListChecks className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
              AI 任务中心
            </h1>
            <p className="text-xs sm:text-sm text-white/60 mt-1">
              所有 AI 音源分离、歌曲分析、歌词与调音任务均以独立 Task ID 后台队列执行，切换播放歌曲或页面绝不影响任务归属与进度
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {tracks.length > 0 && (
            <div className="flex items-center gap-2 bg-black/30 border border-white/12 rounded-2xl p-1.5">
              <select
                value={launcherTrackId}
                onChange={(e) => setLauncherTrackId(e.target.value)}
                aria-label="选择要创建分离任务的歌曲"
                className="bg-transparent text-xs text-white px-2.5 py-1.5 outline-none max-w-[200px] sm:max-w-[260px] truncate cursor-pointer"
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#180713] text-white">
                    {t.title} — {t.artist}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={launching || !launcherTrackId}
                onClick={() => void handleQuickCreateStemTask()}
                className="min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-45 whitespace-nowrap shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>创建分离任务</span>
              </button>
            </div>
          )}

          {tasks.length > 0 && (
            <button
              type="button"
              onClick={() => void clearCompletedOrAllTasks()}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-rose-500/20 border border-white/12 text-xs text-white/75 hover:text-rose-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空已结束</span>
            </button>
          )}
        </div>
      </div>

      {/* Explicit Browser Local Worker Limitation Banner */}
      {hasLocalBackgroundTask && (
        <div className="rounded-2xl bg-amber-500/12 border border-amber-400/25 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-100">
          <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            检测到浏览器本地推理任务正在运行：请保持当前标签页开启，切勿刷新或关闭页面；切换正在播放的歌曲或切换到其他应用页面不会中断任务。如需关闭标签页后仍持续运行，请在「音质与音效」切换至服务端 ONNX 引擎。
          </p>
        </div>
      )}

      {/* Top 4 Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4">
          <span className="text-xs text-white/55 block">正在运行</span>
          <span className="font-mono-tabular text-2xl font-bold text-sky-300 mt-1.5 block">
            {runningCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4">
          <span className="text-xs text-white/55 block">等待中 / 已暂停</span>
          <span className="font-mono-tabular text-2xl font-bold text-amber-300 mt-1.5 block">
            {queuedCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4">
          <span className="text-xs text-white/55 block">已完成</span>
          <span className="font-mono-tabular text-2xl font-bold text-emerald-300 mt-1.5 block">
            {completedCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4">
          <span className="text-xs text-white/55 block">失败 / 中断</span>
          <span className="font-mono-tabular text-2xl font-bold text-rose-300 mt-1.5 block">
            {failedCount}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-black/30 border border-white/10 w-fit">
        {(
          [
            { id: 'all', label: `全部任务 (${tasks.length})` },
            { id: 'active', label: `进行中 (${runningCount + queuedCount})` },
            { id: 'completed', label: `已完成 (${completedCount})` },
            { id: 'failed', label: '失败 / 中断' },
          ] as { id: TaskFilterTab; label: string }[]
        ).map((tab) => {
          const active = filterTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-white/16 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Task Cards */}
      {filteredTasks.length === 0 ? (
        <section className="rounded-3xl bg-white/[0.04] border border-white/10 p-10 text-center space-y-2.5">
          <p className="text-sm font-medium text-white/80">
            {filterTab === 'all' ? '暂无 AI 后台任务记录' : '当前筛选分类下暂无任务'}
          </p>
          <p className="text-xs text-white/50 max-w-lg mx-auto leading-relaxed">
            您可以在上方选择任意曲库歌曲点击「创建分离任务」，或在「音质与音效」及「AI 智能中心」发起音源分离、歌词翻译与音乐分析。
          </p>
        </section>
      ) : (
        <div className="space-y-3.5">
          {filteredTasks.map((task: AiTaskRecord) => {
            const st = STATUS_DISPLAY[task.status];
            const displayTitle =
              task.sourceTrackTitle || task.trackTitle || task.taskName;
            const createdStr = new Date(
              task.createdAt || task.startedAt
            ).toLocaleString('zh-CN', { hour12: false });

            return (
              <article
                key={task.id}
                className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors p-4 sm:p-5 space-y-3.5"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Immutable Source Snapshot */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-gradient-to-br from-rose-900/50 via-purple-900/50 to-black/70 border border-white/12 flex items-center justify-center">
                      {task.sourceTrackCoverUrl ? (
                        <img
                          src={task.sourceTrackCoverUrl}
                          alt={displayTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Disc3 className="w-6 h-6 text-white/45" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {renderStatusIcon(task.status)}
                        <span className={`font-semibold ${st.colorClass}`}>
                          {st.label}
                        </span>
                        <span className="text-white/35" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-white/75">
                          {CATEGORY_LABELS[task.category]}
                        </span>
                        <span className="text-white/35" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-tabular text-white/50">
                          {createdStr}
                        </span>
                      </div>

                      <h3 className="text-sm sm:text-base font-semibold text-white truncate">
                        {displayTitle}
                      </h3>

                      <p className="text-xs text-white/55 truncate">
                        {task.sourceTrackArtist
                          ? `${task.sourceTrackArtist} · `
                          : ''}
                        {task.engineLabel || task.providerName} · {task.modelName}
                        {task.sourceFileInfo
                          ? ` · ${task.sourceFileInfo.format} ${formatFileSize(
                              task.sourceFileInfo.fileSizeBytes
                            )} (${formatTime(task.sourceFileInfo.durationSec)})`
                          : ''}
                      </p>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {task.category === 'stem_separation' &&
                      (task.status === 'running' || task.status === 'queued') && (
                        <button
                          type="button"
                          onClick={() => void pauseTask(task.id)}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>暂停</span>
                        </button>
                      )}

                    {task.status === 'paused' && (
                      <button
                        type="button"
                        onClick={() => void resumeTask(task.id)}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        style={{
                          background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                        }}
                      >
                        <Play className="w-3.5 h-3.5" fill="currentColor" />
                        <span>继续</span>
                      </button>
                    )}

                    {(task.status === 'running' ||
                      task.status === 'queued' ||
                      task.status === 'paused') && (
                      <button
                        type="button"
                        onClick={() => void cancelTask(task.id)}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Square className="w-3 h-3" fill="currentColor" />
                        <span>取消</span>
                      </button>
                    )}

                    {(task.status === 'error' ||
                      task.status === 'interrupted' ||
                      task.status === 'needs_resubmit' ||
                      task.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => void retryTask(task.id)}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        style={{
                          background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>
                          {task.status === 'needs_resubmit' ? '重新提交' : '重试'}
                        </span>
                      </button>
                    )}

                    {task.status === 'completed' && (
                      <button
                        type="button"
                        onClick={() => setSelectedTaskId(task.id)}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        style={{
                          background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                        }}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>查看结果</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/85 cursor-pointer whitespace-nowrap"
                    >
                      查看详情
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteTaskRecord(task.id)}
                      title="仅删除任务记录（保留曲库中的原始歌曲）"
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 border border-white/10 text-xs text-white/60 hover:text-rose-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除记录</span>
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Real Step / ETA */}
                <div className="space-y-1.5 pt-1 border-t border-white/8">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-white/80 truncate">
                      {task.stageLabel || st.label}
                      {task.stepLabel ? ` · 分段 ${task.stepLabel}` : ''}
                    </span>
                    <div className="flex items-center gap-3 shrink-0 font-mono-tabular text-white/80">
                      {task.estimatedRemainingSec != null &&
                        task.estimatedRemainingSec > 0 &&
                        task.status === 'running' && (
                          <span className="text-white/55">
                            约剩 {task.estimatedRemainingSec}s
                          </span>
                        )}
                      <span className="font-semibold">{task.progress}%</span>
                    </div>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(
                          task.status === 'queued' ? 2 : 0,
                          task.progress
                        )}%`,
                        background:
                          task.status === 'error'
                            ? '#f43f5e'
                            : task.status === 'completed'
                            ? '#10b981'
                            : `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
                      }}
                    />
                  </div>

                  {(task.errorMessage || task.resultSummary) && (
                    <p
                      className={`text-[11px] leading-relaxed pt-0.5 ${
                        task.errorMessage ? 'text-rose-200/90' : 'text-white/55'
                      }`}
                    >
                      {task.errorMessage || task.resultSummary}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
