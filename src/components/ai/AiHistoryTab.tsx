import React, { useMemo, useState } from 'react';
import { ExternalLink, History, RotateCcw, Trash2 } from 'lucide-react';
import { useAi } from '../../context/AiContext';
import { useMusic } from '../../context/MusicContext';
import { useTaskCenter } from '../../context/TaskCenterContext';
import { AiTaskRecord, AiTaskStatus } from '../../types/ai';

interface AiHistoryTabProps {
  onReplayTask: (task: AiTaskRecord) => void;
}

const STATUS_LABELS: Record<AiTaskStatus, { label: string; colorClass: string }> = {
  queued: { label: '等待队列', colorClass: 'text-amber-300' },
  running: { label: '执行中', colorClass: 'text-sky-300' },
  paused: { label: '已暂停', colorClass: 'text-violet-300' },
  awaiting_confirmation: { label: '待确认', colorClass: 'text-amber-200' },
  completed: { label: '已完成', colorClass: 'text-emerald-300' },
  cancelled: { label: '已取消', colorClass: 'text-white/55' },
  interrupted: { label: '已中断', colorClass: 'text-amber-300' },
  needs_resubmit: { label: '待重提交', colorClass: 'text-amber-300' },
  error: { label: '失败', colorClass: 'text-rose-300' },
};

export const AiHistoryTab: React.FC<AiHistoryTabProps> = ({ onReplayTask }) => {
  const { setActivePage } = useMusic();
  const { taskHistory, clearTaskHistory } = useAi();
  const { setSelectedTaskId } = useTaskCenter();
  const [filter, setFilter] = useState<'all' | AiTaskStatus>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return taskHistory;
    return taskHistory.filter((t) => t.status === filter);
  }, [taskHistory, filter]);

  return (
    <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <History className="w-5 h-5 text-white/80" />
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">
              AI 任务执行历史
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              仅记录任务摘要与状态，不保存任何 API 密钥；完整后台队列控制请前往「AI 任务中心」
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-black/30 border border-white/10">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'completed', label: '已完成' },
                { id: 'error', label: '失败' },
                { id: 'cancelled', label: '已取消' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filter === opt.id
                    ? 'bg-white/16 text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {taskHistory.length > 0 && (
            <button
              type="button"
              onClick={clearTaskHistory}
              className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-xs text-rose-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空已结束</span>
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center space-y-2 border-t border-white/8">
          <p className="text-sm text-white/70">暂无匹配的 AI 任务记录</p>
          <p className="text-xs text-white/45">
            在「AI 助手」、「AI 音乐工具箱」或「AI 任务中心」发起任务后将在此同步展示
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-white/50">
                <th className="py-2.5 pr-4 font-medium">任务名称</th>
                <th className="py-2.5 pr-4 font-medium">服务商 / 模型</th>
                <th className="py-2.5 pr-4 font-medium">创建时间</th>
                <th className="py-2.5 pr-4 font-medium">状态</th>
                <th className="py-2.5 pr-4 font-medium">结果 / 错误原因</th>
                <th className="py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 text-xs">
              {filtered.map((task) => {
                const st = STATUS_LABELS[task.status] || {
                  label: task.status,
                  colorClass: 'text-white/70',
                };
                const title = task.sourceTrackTitle || task.trackTitle;
                return (
                  <tr key={task.id} className="hover:bg-white/[0.03]">
                    <td className="py-3 pr-4 text-white font-medium max-w-[220px]">
                      <div className="truncate">{task.taskName}</div>
                      {title && (
                        <div className="text-[11px] text-white/45 truncate mt-0.5">
                          曲目：{title}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-white/75 whitespace-nowrap font-mono-tabular">
                      {task.providerName} · {task.modelName}
                    </td>
                    <td className="py-3 pr-4 text-white/60 whitespace-nowrap font-mono-tabular">
                      {new Date(task.createdAt || task.startedAt).toLocaleTimeString(
                        'zh-CN',
                        { hour12: false }
                      )}
                    </td>
                    <td className={`py-3 pr-4 whitespace-nowrap font-medium ${st.colorClass}`}>
                      {st.label}
                    </td>
                    <td className="py-3 pr-4 text-white/70 max-w-md">
                      <p className="line-clamp-2 leading-relaxed">
                        {task.errorMessage || task.resultSummary || task.stageLabel || '—'}
                      </p>
                    </td>
                    <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(task.id);
                          setActivePage('tasks');
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-[11px] text-white/85 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>详情</span>
                      </button>
                      {task.replayPayload?.prompt && (
                        <button
                          type="button"
                          onClick={() => onReplayTask(task)}
                          className="px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-[11px] text-white/85 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>重放</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
