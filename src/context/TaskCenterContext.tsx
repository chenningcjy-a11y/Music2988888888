import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MDX_MODEL_CONFIG } from '../audio/mdxDsp';
import {
  cancelServerStemJobApi,
  checkStemSeparationPreflight,
  decodeAudioBlobTo44kStereo,
  deleteServerStemJobApi,
  downloadServerStemsAndSave,
  executeRemoteDemucsSeparation,
  fetchServerStemJobStatus,
  pauseServerStemJobApi,
  resolveEffectiveSeparationBackend,
  resumeServerStemJobApi,
  ServerStemJobDto,
  submitServerStemJob,
} from '../services/ai/musicSeparationService';
import {
  clearAiTasks,
  deleteAiTaskById,
  getAllAiTasks,
  getAudioBlob,
  saveAiTask,
  saveTrackStems,
} from '../services/storage';
import {
  AiTaskCategory,
  AiTaskRecord,
  AiTaskStageLog,
  AiTaskStatus,
} from '../types/ai';
import { SeparationEngineMode, TrackMetadata, TrackStemsRecord } from '../types/music';
import type { WorkerInMessage, WorkerOutMessage } from '../workers/stemSeparatorWorker';
import { useMusic } from './MusicContext';

export function isActiveTaskStatus(status: AiTaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'paused' ||
    status === 'awaiting_confirmation'
  );
}

export function isRunningOrQueuedStatus(status: AiTaskStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

interface TaskRunnerHandle {
  kind: 'server-stem' | 'local-worker-stem' | 'abort-controller';
  abortController?: AbortController;
  worker?: Worker;
  paused?: boolean;
  cancelled?: boolean;
}

interface BeginAdHocTaskParams {
  taskName: string;
  category: AiTaskCategory;
  providerName: string;
  modelName: string;
  track?: TrackMetadata | null;
  trackTitle?: string;
  replayPayload?: AiTaskRecord['replayPayload'];
}

interface TaskCenterContextValue {
  tasks: AiTaskRecord[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  hasLocalBackgroundTask: boolean;
  runningCount: number;
  queuedCount: number;
  completedCount: number;
  failedCount: number;

  enqueueStemSeparationTask: (
    track: TrackMetadata,
    options?: { engineMode?: SeparationEngineMode }
  ) => Promise<string>;
  getActiveStemTaskForTrack: (trackId: string) => AiTaskRecord | undefined;
  getLatestStemTaskForTrack: (trackId: string) => AiTaskRecord | undefined;

  beginAdHocTask: (params: BeginAdHocTaskParams) => {
    task: AiTaskRecord;
    signal: AbortSignal;
  };
  updateTask: (taskId: string, patch: Partial<AiTaskRecord>, logStage?: string) => void;
  finishTask: (
    taskId: string,
    status: AiTaskStatus,
    extra?: Partial<AiTaskRecord>
  ) => void;

  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  deleteTaskRecord: (taskId: string) => Promise<void>;
  deleteTaskStemResult: (taskId: string) => Promise<void>;
  clearCompletedOrAllTasks: () => Promise<void>;
  reloadTasksFromStorage: () => Promise<void>;
}

const TaskCenterContext = createContext<TaskCenterContextValue | null>(null);

function makeTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `task-${crypto.randomUUID()}`;
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendStageLog(
  existing: AiTaskStageLog[] | undefined,
  stage: string,
  detail?: string
): AiTaskStageLog[] {
  const logs = existing ? [...existing] : [];
  const last = logs[logs.length - 1];
  if (last && last.stage === stage && last.detail === detail) {
    return logs;
  }
  logs.push({ timestamp: Date.now(), stage, detail });
  return logs.slice(-40);
}

function mapServerStatusToTaskStatus(status: ServerStemJobDto['status']): AiTaskStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
}

export const TaskCenterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    tracks,
    separationEngineMode,
    refreshStemMetas,
    removeTrackStems,
    showToast,
  } = useMusic();

  const [tasks, setTasks] = useState<AiTaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const tasksRef = useRef<AiTaskRecord[]>([]);
  tasksRef.current = tasks;

  const tracksRef = useRef<TrackMetadata[]>(tracks);
  tracksRef.current = tracks;

  const runnersRef = useRef<Map<string, TaskRunnerHandle>>(new Map());
  const localQueueRef = useRef<Array<() => Promise<void>>>([]);
  const localWorkerBusyRef = useRef(false);
  const hydratedRef = useRef(false);

  const upsertTaskState = useCallback(
    (
      taskId: string,
      updater: (prev: AiTaskRecord) => AiTaskRecord,
      persist = true
    ) => {
      setTasks((prev) =>
        prev.map((item) => {
          if (item.id !== taskId) return item;
          const next = updater(item);
          if (persist) {
            void saveAiTask(next);
          }
          return next;
        })
      );
    },
    []
  );

  const updateTask = useCallback(
    (taskId: string, patch: Partial<AiTaskRecord>, logStage?: string) => {
      upsertTaskState(taskId, (item) => ({
        ...item,
        ...patch,
        stageLogs: logStage
          ? appendStageLog(
              item.stageLogs,
              logStage,
              patch.resultSummary || patch.stageLabel
            )
          : item.stageLogs,
      }));
    },
    [upsertTaskState]
  );

  const finishTask = useCallback(
    (taskId: string, status: AiTaskStatus, extra?: Partial<AiTaskRecord>) => {
      runnersRef.current.delete(taskId);
      upsertTaskState(taskId, (item) => {
        const nextStage =
          extra?.stageLabel ||
          (status === 'completed'
            ? '任务已完成'
            : status === 'cancelled'
            ? '任务已取消'
            : status === 'interrupted'
            ? '任务已中断'
            : '任务执行失败');
        return {
          ...item,
          ...extra,
          status,
          finishedAt: extra?.finishedAt ?? Date.now(),
          progress: status === 'completed' ? 100 : extra?.progress ?? item.progress,
          estimatedRemainingSec: status === 'completed' ? 0 : null,
          stageLogs: appendStageLog(
            item.stageLogs,
            nextStage,
            extra?.errorMessage || extra?.resultSummary
          ),
        };
      });
    },
    [upsertTaskState]
  );

  const pollServerJobUntilTerminal = useCallback(
    async (
      taskId: string,
      jobId: string,
      sourceTrackId: string,
      sourceTrackTitle: string,
      durationSec: number
    ) => {
      const ctrl = new AbortController();
      runnersRef.current.set(taskId, {
        kind: 'server-stem',
        abortController: ctrl,
      });

      let consecutiveErrors = 0;

      try {
        while (!ctrl.signal.aborted) {
          const res = await fetchServerStemJobStatus(jobId, ctrl.signal);
          if (ctrl.signal.aborted) return;

          if (res.statusCode === 404 || !res.job) {
            finishTask(taskId, 'interrupted', {
              stageLabel: '服务端任务记录不存在或已过期',
              errorMessage:
                res.error || '服务端任务已过期或服务重启导致中断，可点击重试重新执行。',
            });
            return;
          }

          consecutiveErrors = 0;
          const job = res.job;
          const mappedStatus = mapServerStatusToTaskStatus(job.status);

          if (job.status === 'paused') {
            runnersRef.current.delete(taskId);
            updateTask(
              taskId,
              {
                status: 'paused',
                progress: job.progress,
                stageLabel: job.stageLabel,
                stepLabel: job.stepLabel,
                currentChunk: job.currentChunk,
                totalChunks: job.totalChunks,
                estimatedRemainingSec: null,
              },
              job.stageLabel
            );
            return;
          }

          if (job.status === 'cancelled') {
            finishTask(taskId, 'cancelled', {
              stageLabel: job.stageLabel || '任务已取消',
              errorMessage: '用户取消任务',
            });
            return;
          }

          if (job.status === 'interrupted') {
            finishTask(taskId, 'interrupted', {
              stageLabel: job.stageLabel || '服务端处理中断',
              errorMessage: job.error || '服务端进程中断，请点击重试继续分离',
            });
            return;
          }

          if (job.status === 'error') {
            finishTask(taskId, 'error', {
              stageLabel: job.stageLabel || '服务端音源分离失败',
              errorMessage: job.error || '服务端音源分离失败',
            });
            return;
          }

          if (job.status === 'completed') {
            updateTask(taskId, {
              status: 'running',
              progress: 97,
              stageLabel: '正在同步人声与伴奏音轨至本地曲库缓存',
              stepLabel: job.stepLabel,
              currentChunk: job.currentChunk,
              totalChunks: job.totalChunks,
              estimatedRemainingSec: 1,
            });

            const record = await downloadServerStemsAndSave({
              jobId,
              trackId: sourceTrackId,
              duration: durationSec,
              signal: ctrl.signal,
            });

            await refreshStemMetas(sourceTrackId, true);

            const stemMeta = {
              trackId: sourceTrackId,
              modelId: record.modelId,
              modelName: record.modelName,
              engineUsed: record.engineUsed,
              duration: record.duration,
              createdAt: record.createdAt,
              vocalSizeBytes: record.vocalBlob.size,
              instrumentalSizeBytes: record.instrumentalBlob.size,
            };

            finishTask(taskId, 'completed', {
              stageLabel: '人声与伴奏分离完成',
              resultSummary: `已生成「${sourceTrackTitle}」的独立人声与伴奏音轨 (${record.modelName})`,
              stemMeta,
            });
            showToast(`「${sourceTrackTitle}」人声与伴奏分离完成`);
            return;
          }

          updateTask(taskId, {
            status: mappedStatus,
            progress: Math.min(96, Math.max(0, job.progress)),
            stageLabel: job.stageLabel,
            stepLabel: job.stepLabel,
            currentChunk: job.currentChunk,
            totalChunks: job.totalChunks,
            estimatedRemainingSec: job.estimatedRemainingSec,
          });

          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        consecutiveErrors++;
        if (consecutiveErrors >= 4) {
          finishTask(taskId, 'interrupted', {
            stageLabel: '无法连接服务端任务状态接口',
            errorMessage: err instanceof Error ? err.message : '网络中断，请稍后重试',
          });
        }
      }
    },
    [finishTask, refreshStemMetas, showToast, updateTask]
  );

  const pumpLocalWorkerQueue = useCallback(() => {
    if (localWorkerBusyRef.current) return;
    const nextJob = localQueueRef.current.shift();
    if (!nextJob) return;
    localWorkerBusyRef.current = true;
    void nextJob().finally(() => {
      localWorkerBusyRef.current = false;
      pumpLocalWorkerQueue();
    });
  }, []);

  const launchServerStemExecution = useCallback(
    async (taskId: string, track: TrackMetadata) => {
      const ctrl = new AbortController();
      runnersRef.current.set(taskId, {
        kind: 'server-stem',
        abortController: ctrl,
      });

      try {
        updateTask(
          taskId,
          {
            status: 'running',
            progress: 2,
            stageLabel: '正在读取曲目音频并上传至服务端后台队列',
            engineLabel: '服务端 ONNX Runtime (后台持久化队列)',
          },
          '提交服务端后台队列'
        );

        const audioBlob = await getAudioBlob(track.id);
        if (!audioBlob) {
          throw new Error('本地曲库中未找到该曲目的音频数据');
        }

        const job = await submitServerStemJob({
          taskId,
          track,
          audioBlob,
          signal: ctrl.signal,
        });

        // Respect if user cancelled right during upload
        const runner = runnersRef.current.get(taskId);
        if (!runner || runner.cancelled) {
          await cancelServerStemJobApi(job.id);
          return;
        }

        updateTask(
          taskId,
          {
            backendJobId: job.id,
            status: mapServerStatusToTaskStatus(job.status),
            progress: job.progress,
            stageLabel: job.stageLabel,
            estimatedRemainingSec: job.estimatedRemainingSec,
          },
          `服务端已接收任务 (Job: ${job.id.slice(0, 8)})`
        );

        await pollServerJobUntilTerminal(
          taskId,
          job.id,
          track.id,
          track.title,
          track.duration
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          finishTask(taskId, 'cancelled', {
            stageLabel: '任务已取消',
            errorMessage: '用户取消任务',
          });
        } else {
          finishTask(taskId, 'error', {
            stageLabel: '服务端音源分离失败',
            errorMessage: err instanceof Error ? err.message : '提交或执行分离失败',
          });
        }
      }
    },
    [finishTask, pollServerJobUntilTerminal, updateTask]
  );

  const launchLocalWorkerStemExecution = useCallback(
    (taskId: string, track: TrackMetadata, allowServerFallback: boolean) => {
      const runnerHandle: TaskRunnerHandle = {
        kind: 'local-worker-stem',
        paused: false,
        cancelled: false,
      };
      runnersRef.current.set(taskId, runnerHandle);

      const run = async () => {
        if (runnerHandle.cancelled) return;

        try {
          updateTask(
            taskId,
            {
              status: 'running',
              progress: 4,
              stageLabel: '正在解码音频为 44.1kHz 立体声波形',
              engineLabel: '本地 Web Worker (独立线程)',
            },
            '本地解码音频'
          );

          const audioBlob = await getAudioBlob(track.id);
          if (!audioBlob) {
            throw new Error('本地曲库中未找到该曲目的音频数据');
          }

          const decoded = await decodeAudioBlobTo44kStereo(audioBlob);
          if (runnerHandle.cancelled) return;

          const worker = new Worker(
            new URL('../workers/stemSeparatorWorker.ts', import.meta.url),
            { type: 'module' }
          );
          runnerHandle.worker = worker;

          await new Promise<void>((resolve, reject) => {
            worker.onmessage = async (ev: MessageEvent<WorkerOutMessage>) => {
              const data = ev.data;
              if (data.type === 'progress') {
                updateTask(taskId, {
                  status: data.status === 'paused' ? 'paused' : 'running',
                  progress: data.progress,
                  stageLabel: data.stageLabel,
                  stepLabel: data.stepLabel,
                  currentChunk: data.currentChunk,
                  totalChunks: data.totalChunks,
                  estimatedRemainingSec: data.estimatedRemainingSec ?? null,
                  engineLabel: data.engineLabel,
                });
                return;
              }

              if (data.type === 'cancelled') {
                worker.terminate();
                finishTask(taskId, 'cancelled', {
                  stageLabel: '任务已取消',
                  errorMessage: '用户取消任务',
                });
                resolve();
                return;
              }

              if (data.type === 'error') {
                worker.terminate();
                reject(new Error(data.error));
                return;
              }

              if (data.type === 'completed') {
                worker.terminate();
                const vocalBlob = new Blob([data.vocalWavBuffer], { type: 'audio/wav' });
                const instrumentalBlob = new Blob([data.instrumentalWavBuffer], {
                  type: 'audio/wav',
                });
                const record: TrackStemsRecord = {
                  trackId: track.id,
                  vocalBlob,
                  instrumentalBlob,
                  modelId: MDX_MODEL_CONFIG.id,
                  modelName: MDX_MODEL_CONFIG.name,
                  engineUsed: data.engineUsed,
                  duration: data.duration,
                  createdAt: Date.now(),
                };
                await saveTrackStems(record);
                await refreshStemMetas(track.id, true);

                finishTask(taskId, 'completed', {
                  stageLabel: '本地 AI 音源分离完成',
                  resultSummary: `已生成「${track.title}」的独立人声与伴奏音轨`,
                  stemMeta: {
                    trackId: track.id,
                    modelId: record.modelId,
                    modelName: record.modelName,
                    engineUsed: record.engineUsed,
                    duration: record.duration,
                    createdAt: record.createdAt,
                    vocalSizeBytes: vocalBlob.size,
                    instrumentalSizeBytes: instrumentalBlob.size,
                  },
                });
                showToast(`「${track.title}」人声与伴奏分离完成`);
                resolve();
              }
            };

            worker.onerror = (err) => {
              worker.terminate();
              reject(new Error(err.message || '本地 Web Worker 执行异常'));
            };

            const leftBuf = decoded.left.buffer.slice(0) as ArrayBuffer;
            const rightBuf = decoded.right.buffer.slice(0) as ArrayBuffer;
            const startMsg: WorkerInMessage = {
              type: 'start',
              taskId,
              trackId: track.id,
              leftBuffer: leftBuf,
              rightBuffer: rightBuf,
              duration: decoded.duration,
            };
            worker.postMessage(startMsg, [leftBuf, rightBuf]);
          });
        } catch (err) {
          if (runnerHandle.cancelled) {
            finishTask(taskId, 'cancelled', {
              stageLabel: '任务已取消',
              errorMessage: '用户取消任务',
            });
            return;
          }
          if (allowServerFallback) {
            updateTask(
              taskId,
              {
                stageLabel: '本地浏览器推理受限，已自动转入服务端后台队列',
                engineLabel: '服务端 ONNX Runtime',
              },
              '自动回退至服务端分离队列'
            );
            await launchServerStemExecution(taskId, track);
          } else {
            finishTask(taskId, 'error', {
              stageLabel: '本地浏览器音源分离失败',
              errorMessage:
                err instanceof Error ? err.message : '本地推理失败，建议改用服务端队列',
            });
          }
        }
      };

      localQueueRef.current.push(run);
      pumpLocalWorkerQueue();
    },
    [
      finishTask,
      launchServerStemExecution,
      pumpLocalWorkerQueue,
      refreshStemMetas,
      showToast,
      updateTask,
    ]
  );

  const launchRemoteDemucsExecution = useCallback(
    async (taskId: string, track: TrackMetadata, serviceName: string) => {
      const ctrl = new AbortController();
      runnersRef.current.set(taskId, {
        kind: 'abort-controller',
        abortController: ctrl,
      });

      try {
        updateTask(
          taskId,
          {
            status: 'running',
            progress: 18,
            stageLabel: `正在上传音频至外部服务 (${serviceName})`,
            engineLabel: serviceName,
          },
          `上传至 ${serviceName}`
        );

        const record = await executeRemoteDemucsSeparation({
          track,
          serviceName,
          signal: ctrl.signal,
        });

        await refreshStemMetas(track.id, true);
        finishTask(taskId, 'completed', {
          stageLabel: '外部 AI 音源分离完成',
          resultSummary: `已生成「${track.title}」的独立人声与伴奏音轨`,
          stemMeta: {
            trackId: track.id,
            modelId: record.modelId,
            modelName: record.modelName,
            engineUsed: record.engineUsed,
            duration: record.duration,
            createdAt: record.createdAt,
            vocalSizeBytes: record.vocalBlob.size,
            instrumentalSizeBytes: record.instrumentalBlob.size,
          },
        });
        showToast(`「${track.title}」人声与伴奏分离完成`);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          finishTask(taskId, 'cancelled', {
            stageLabel: '任务已取消',
            errorMessage: '用户取消任务',
          });
        } else {
          finishTask(taskId, 'error', {
            stageLabel: '外部音源分离失败',
            errorMessage: err instanceof Error ? err.message : '外部分离服务失败',
          });
        }
      }
    },
    [finishTask, refreshStemMetas, showToast, updateTask]
  );

  const enqueueStemSeparationTask = useCallback(
    async (
      track: TrackMetadata,
      options?: { engineMode?: SeparationEngineMode }
    ): Promise<string> => {
      const effectiveMode = options?.engineMode || separationEngineMode;
      const preflight = await checkStemSeparationPreflight(track);
      if (!preflight.ok) {
        const msg = preflight.error || '音源分离前置检查未通过';
        showToast(msg);
        throw new Error(msg);
      }

      const resolvedBackend = await resolveEffectiveSeparationBackend(
        effectiveMode,
        preflight.serviceKind
      );

      const now = Date.now();
      const taskId = makeTaskId();
      const initialTask: AiTaskRecord = {
        id: taskId,
        taskName: `人声与伴奏分离 · ${track.title}`,
        category: 'stem_separation',
        providerName: preflight.serviceName,
        modelName:
          preflight.serviceKind === 'builtin-mdx'
            ? MDX_MODEL_CONFIG.name
            : preflight.serviceName,
        sourceTrackId: track.id,
        sourceTrackTitle: track.title,
        sourceTrackArtist: track.artist,
        sourceTrackAlbum: track.album,
        sourceTrackCoverUrl: track.coverDataUrl,
        trackTitle: track.title,
        sourceFileInfo: {
          format: track.format,
          fileSizeBytes: track.fileSize,
          durationSec: track.duration,
          sampleRate: track.sampleRate,
          bitrate: track.bitrate,
          fileIdentifier: `${track.id}.${(track.format || 'audio').toLowerCase()}`,
        },
        engineMode:
          preflight.serviceKind === 'remote-demucs-http'
            ? 'remote-demucs-http'
            : effectiveMode,
        engineLabel:
          resolvedBackend === 'server'
            ? '服务端 ONNX Runtime'
            : resolvedBackend === 'local-worker'
            ? '本地 Web Worker'
            : preflight.serviceName,
        createdAt: now,
        startedAt: now,
        status: 'queued',
        progress: 0,
        stageLabel: '已加入独立后台任务队列',
        estimatedRemainingSec: null,
        stageLogs: [
          {
            timestamp: now,
            stage: '创建独立音源分离任务',
            detail: `${track.title} — ${track.artist} (${preflight.format})`,
          },
        ],
        replayPayload: {
          category: 'stem_separation',
          targetTrackId: track.id,
          engineMode: effectiveMode,
        },
      };

      setTasks((prev) => [initialTask, ...prev].slice(0, 200));
      await saveAiTask(initialTask);

      if (resolvedBackend === 'remote-demucs-http') {
        void launchRemoteDemucsExecution(taskId, track, preflight.serviceName);
      } else if (resolvedBackend === 'local-worker') {
        launchLocalWorkerStemExecution(taskId, track, effectiveMode === 'auto');
      } else {
        void launchServerStemExecution(taskId, track);
      }

      showToast(`已为「${track.title}」创建独立分离任务`);
      return taskId;
    },
    [
      launchLocalWorkerStemExecution,
      launchRemoteDemucsExecution,
      launchServerStemExecution,
      separationEngineMode,
      showToast,
    ]
  );

  const beginAdHocTask = useCallback((params: BeginAdHocTaskParams) => {
    const ctrl = new AbortController();
    const now = Date.now();
    const taskId = makeTaskId();
    const snapTrack = params.track || null;
    const task: AiTaskRecord = {
      id: taskId,
      taskName: params.taskName,
      category: params.category,
      providerName: params.providerName,
      modelName: params.modelName,
      sourceTrackId: snapTrack?.id,
      sourceTrackTitle: snapTrack?.title || params.trackTitle,
      sourceTrackArtist: snapTrack?.artist,
      sourceTrackAlbum: snapTrack?.album,
      sourceTrackCoverUrl: snapTrack?.coverDataUrl,
      sourceFileInfo: snapTrack
        ? {
            format: snapTrack.format,
            fileSizeBytes: snapTrack.fileSize,
            durationSec: snapTrack.duration,
            sampleRate: snapTrack.sampleRate,
            bitrate: snapTrack.bitrate,
          }
        : undefined,
      trackTitle: snapTrack?.title || params.trackTitle,
      createdAt: now,
      startedAt: now,
      status: 'running',
      progress: 10,
      stageLabel: '正在向 AI 服务发起推理请求',
      estimatedRemainingSec: null,
      stageLogs: [
        {
          timestamp: now,
          stage: '创建 AI 任务',
          detail: `${params.providerName} · ${params.modelName}`,
        },
      ],
      replayPayload: params.replayPayload,
    };

    runnersRef.current.set(taskId, {
      kind: 'abort-controller',
      abortController: ctrl,
    });
    setTasks((prev) => [task, ...prev].slice(0, 200));
    void saveAiTask(task);
    return { task, signal: ctrl.signal };
  }, []);

  const pauseTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      if (task.backendJobId) {
        try {
          const job = await pauseServerStemJobApi(task.backendJobId);
          // Stop active poll loop gently without cancelling on server
          const runner = runnersRef.current.get(taskId);
          if (runner?.abortController) {
            runner.abortController.abort();
            runnersRef.current.delete(taskId);
          }
          updateTask(
            taskId,
            {
              status: 'paused',
              stageLabel: job.stageLabel || '已暂停分离',
              estimatedRemainingSec: null,
            },
            '暂停服务端任务'
          );
          showToast(`已暂停「${task.sourceTrackTitle || task.taskName}」`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : '暂停任务失败');
        }
        return;
      }

      const runner = runnersRef.current.get(taskId);
      if (runner?.kind === 'local-worker-stem' && runner.worker) {
        runner.paused = true;
        runner.worker.postMessage({ type: 'pause' } satisfies WorkerInMessage);
        updateTask(
          taskId,
          { status: 'paused', stageLabel: '正在当前分段结束后暂停…' },
          '请求暂停本地推理'
        );
      }
    },
    [showToast, updateTask]
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      if (task.backendJobId && task.sourceTrackId) {
        try {
          const job = await resumeServerStemJobApi(task.backendJobId);
          updateTask(
            taskId,
            {
              status: mapServerStatusToTaskStatus(job.status),
              stageLabel: job.stageLabel || '已恢复，等待继续执行',
              errorMessage: undefined,
            },
            '恢复服务端分离任务'
          );
          void pollServerJobUntilTerminal(
            taskId,
            task.backendJobId,
            task.sourceTrackId,
            task.sourceTrackTitle || task.taskName,
            task.sourceFileInfo?.durationSec || 0
          );
          showToast(`已恢复「${task.sourceTrackTitle || task.taskName}」`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : '恢复任务失败');
        }
        return;
      }

      const runner = runnersRef.current.get(taskId);
      if (runner?.kind === 'local-worker-stem' && runner.worker) {
        runner.paused = false;
        runner.worker.postMessage({ type: 'resume' } satisfies WorkerInMessage);
        updateTask(taskId, { status: 'running', stageLabel: '继续本地分离…' }, '恢复本地推理');
      }
    },
    [pollServerJobUntilTerminal, showToast, updateTask]
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      const runner = runnersRef.current.get(taskId);
      if (runner) {
        runner.cancelled = true;
        if (runner.worker) {
          runner.worker.postMessage({ type: 'cancel' } satisfies WorkerInMessage);
        }
        runner.abortController?.abort();
        runnersRef.current.delete(taskId);
      }

      if (task.backendJobId) {
        await cancelServerStemJobApi(task.backendJobId);
      }

      finishTask(taskId, 'cancelled', {
        stageLabel: '已取消任务',
        errorMessage: '用户手动取消任务',
      });
      showToast(`已取消任务「${task.sourceTrackTitle || task.taskName}」`);
    },
    [finishTask, showToast]
  );

  const retryTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      if (task.category === 'stem_separation') {
        const targetTrackId = task.sourceTrackId || task.replayPayload?.targetTrackId;
        const targetTrack = tracksRef.current.find((t) => t.id === targetTrackId);
        if (!targetTrack) {
          showToast('曲库中已找不到该任务关联的原始歌曲，无法重新分离');
          return;
        }
        // Reset the existing task entry cleanly in place OR start a fresh run in place
        const preflight = await checkStemSeparationPreflight(targetTrack);
        if (!preflight.ok) {
          showToast(preflight.error || '音源分离前置检查未通过');
          return;
        }

        const effectiveMode =
          task.replayPayload?.engineMode ||
          (task.engineMode === 'local' || task.engineMode === 'server'
            ? task.engineMode
            : separationEngineMode);
        const resolvedBackend = await resolveEffectiveSeparationBackend(
          effectiveMode,
          preflight.serviceKind
        );

        updateTask(
          taskId,
          {
            status: 'queued',
            progress: 0,
            startedAt: Date.now(),
            finishedAt: undefined,
            backendJobId: undefined,
            errorMessage: undefined,
            stepLabel: undefined,
            currentChunk: undefined,
            totalChunks: undefined,
            estimatedRemainingSec: null,
            stageLabel: '正在重新提交独立分离任务',
          },
          '用户发起重试'
        );

        if (resolvedBackend === 'remote-demucs-http') {
          void launchRemoteDemucsExecution(taskId, targetTrack, preflight.serviceName);
        } else if (resolvedBackend === 'local-worker') {
          launchLocalWorkerStemExecution(
            taskId,
            targetTrack,
            effectiveMode === 'auto'
          );
        } else {
          void launchServerStemExecution(taskId, targetTrack);
        }
        return;
      }

      showToast('请在 AI 智能中心重新发起此指令');
    },
    [
      launchLocalWorkerStemExecution,
      launchRemoteDemucsExecution,
      launchServerStemExecution,
      separationEngineMode,
      showToast,
      updateTask,
    ]
  );

  const deleteTaskRecord = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (task && isRunningOrQueuedStatus(task.status)) {
        await cancelTask(taskId);
      }
      if (task?.backendJobId) {
        void deleteServerStemJobApi(task.backendJobId);
      }
      await deleteAiTaskById(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSelectedTaskId((prev) => (prev === taskId ? null : prev));
      showToast('已删除任务记录（曲库中的原始歌曲已保留）');
    },
    [cancelTask, showToast]
  );

  const deleteTaskStemResult = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task?.sourceTrackId) return;
      await removeTrackStems(task.sourceTrackId);
      if (task.backendJobId) {
        void deleteServerStemJobApi(task.backendJobId);
      }
      updateTask(
        taskId,
        {
          stemMeta: undefined,
          resultSummary: '分离音轨缓存已被用户清理（原始歌曲保留）',
        },
        '清理分离结果音轨'
      );
    },
    [removeTrackStems, updateTask]
  );

  const clearCompletedOrAllTasks = useCallback(async () => {
    const active = tasksRef.current.filter((t) => isRunningOrQueuedStatus(t.status));
    if (active.length === 0) {
      await clearAiTasks();
      setTasks([]);
      setSelectedTaskId(null);
      showToast('已清空任务记录');
      return;
    }
    const inactiveIds = tasksRef.current
      .filter((t) => !isRunningOrQueuedStatus(t.status))
      .map((t) => t.id);
    for (const id of inactiveIds) {
      await deleteAiTaskById(id);
    }
    setTasks(active);
    showToast('已清空已结束的任务记录，进行中的任务继续保留');
  }, [showToast]);

  const reconcileAndHydrateTasks = useCallback(async () => {
    try {
      const stored = await getAllAiTasks();
      setTasks(stored);

      for (const task of stored) {
        if (!isRunningOrQueuedStatus(task.status)) continue;

        if (task.backendJobId && task.sourceTrackId) {
          const res = await fetchServerStemJobStatus(task.backendJobId).catch(() => ({
            statusCode: 0,
            job: null,
            error: '无法连接服务端',
          }));

          if (res.statusCode === 404 || !res.job) {
            finishTask(task.id, 'interrupted', {
              stageLabel: '服务端任务已中断或过期',
              errorMessage:
                '页面恢复时未能找到对应的服务端分离任务（可能服务已重启或已过期），可点击重试重新执行。',
            });
            continue;
          }

          const job = res.job;
          if (job.status === 'completed') {
            try {
              const record = await downloadServerStemsAndSave({
                jobId: task.backendJobId,
                trackId: task.sourceTrackId,
                duration: task.sourceFileInfo?.durationSec || 0,
              });
              await refreshStemMetas(task.sourceTrackId, false);
              finishTask(task.id, 'completed', {
                stageLabel: '人声与伴奏分离完成（后台已完成并恢复结果）',
                resultSummary: `已生成「${task.sourceTrackTitle || task.taskName}」的独立音轨`,
                stemMeta: {
                  trackId: task.sourceTrackId,
                  modelId: record.modelId,
                  modelName: record.modelName,
                  engineUsed: record.engineUsed,
                  duration: record.duration,
                  createdAt: record.createdAt,
                  vocalSizeBytes: record.vocalBlob.size,
                  instrumentalSizeBytes: record.instrumentalBlob.size,
                },
              });
            } catch (err) {
              finishTask(task.id, 'error', {
                stageLabel: '恢复下载分离结果失败',
                errorMessage: err instanceof Error ? err.message : '下载音轨失败',
              });
            }
            continue;
          }

          if (job.status === 'paused') {
            updateTask(task.id, {
              status: 'paused',
              progress: job.progress,
              stageLabel: job.stageLabel,
              stepLabel: job.stepLabel,
              currentChunk: job.currentChunk,
              totalChunks: job.totalChunks,
              estimatedRemainingSec: null,
            });
            continue;
          }

          if (
            job.status === 'cancelled' ||
            job.status === 'error' ||
            job.status === 'interrupted'
          ) {
            finishTask(task.id, mapServerStatusToTaskStatus(job.status), {
              stageLabel: job.stageLabel,
              errorMessage: job.error,
            });
            continue;
          }

          // Still actively queued or running on server -> resume live polling cleanly
          updateTask(task.id, {
            status: mapServerStatusToTaskStatus(job.status),
            progress: job.progress,
            stageLabel: job.stageLabel,
            stepLabel: job.stepLabel,
            currentChunk: job.currentChunk,
            totalChunks: job.totalChunks,
            estimatedRemainingSec: job.estimatedRemainingSec,
          });

          void pollServerJobUntilTerminal(
            task.id,
            task.backendJobId,
            task.sourceTrackId,
            task.sourceTrackTitle || task.taskName,
            task.sourceFileInfo?.durationSec || 0
          );
        } else {
          // Browser-local worker or non-persisted fetch was interrupted by page reload
          finishTask(task.id, 'interrupted', {
            stageLabel: '页面刷新或关闭导致本地任务中断',
            errorMessage:
              '浏览器本地执行任务无法跨越页面刷新继续运行；如需后台持久化处理，推荐使用服务端引擎或点击重试。',
          });
        }
      }
    } catch (err) {
      console.warn('Task center hydration warning:', err);
    }
  }, [finishTask, pollServerJobUntilTerminal, refreshStemMetas, updateTask]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void reconcileAndHydrateTasks();
  }, [reconcileAndHydrateTasks]);

  const reloadTasksFromStorage = useCallback(async () => {
    const stored = await getAllAiTasks();
    setTasks(stored);
  }, []);

  // Warn before unloading tab ONLY when a browser-local Web Worker separation is running
  const hasLocalBackgroundTask = useMemo(
    () =>
      tasks.some(
        (t) =>
          (t.status === 'running' || t.status === 'queued') &&
          !t.backendJobId &&
          t.category === 'stem_separation'
      ),
    [tasks]
  );

  useEffect(() => {
    if (!hasLocalBackgroundTask) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasLocalBackgroundTask]);

  const getActiveStemTaskForTrack = useCallback(
    (trackId: string) =>
      tasks.find(
        (t) =>
          t.category === 'stem_separation' &&
          t.sourceTrackId === trackId &&
          isRunningOrQueuedStatus(t.status)
      ),
    [tasks]
  );

  const getLatestStemTaskForTrack = useCallback(
    (trackId: string) =>
      tasks.find(
        (t) => t.category === 'stem_separation' && t.sourceTrackId === trackId
      ),
    [tasks]
  );

  const runningCount = useMemo(
    () => tasks.filter((t) => t.status === 'running').length,
    [tasks]
  );
  const queuedCount = useMemo(
    () => tasks.filter((t) => t.status === 'queued' || t.status === 'paused').length,
    [tasks]
  );
  const completedCount = useMemo(
    () => tasks.filter((t) => t.status === 'completed').length,
    [tasks]
  );
  const failedCount = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === 'error' ||
          t.status === 'interrupted' ||
          t.status === 'needs_resubmit'
      ).length,
    [tasks]
  );

  const value: TaskCenterContextValue = {
    tasks,
    selectedTaskId,
    setSelectedTaskId,
    hasLocalBackgroundTask,
    runningCount,
    queuedCount,
    completedCount,
    failedCount,
    enqueueStemSeparationTask,
    getActiveStemTaskForTrack,
    getLatestStemTaskForTrack,
    beginAdHocTask,
    updateTask,
    finishTask,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    deleteTaskRecord,
    deleteTaskStemResult,
    clearCompletedOrAllTasks,
    reloadTasksFromStorage,
  };

  return (
    <TaskCenterContext.Provider value={value}>
      {children}
    </TaskCenterContext.Provider>
  );
};

export function useTaskCenter(): TaskCenterContextValue {
  const ctx = useContext(TaskCenterContext);
  if (!ctx) throw new Error('useTaskCenter must be used within TaskCenterProvider');
  return ctx;
}
