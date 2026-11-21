import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Database,
  Download,
  KeyRound,
  Palette,
  RefreshCw,
  Trash2,
  Type,
  Upload,
  Waves,
} from 'lucide-react';
import { useAi } from '../context/AiContext';
import { useMusic } from '../context/MusicContext';
import { useTaskCenter } from '../context/TaskCenterContext';
import {
  BackupLocalInventory,
  DEFAULT_BACKUP_EXPORT_OPTIONS,
  ExportedBackupVolume,
  exportLuminaBackup,
  ExportVolumeMode,
  FileSystemFileHandleLike,
  getBackupLocalInventory,
  importLuminaBackupFiles,
  InspectedBackupBatch,
  inspectLuminaBackupFiles,
  LIGHTWEIGHT_BACKUP_OPTIONS,
  MV_TIMELINE_ONLY_BACKUP_OPTIONS,
  SAFE_BROWSER_VOLUME_BYTES,
} from '../services/backupService';
import { getStorageEstimate } from '../services/storage';
import {
  AnimationIntensity,
  BackupSelectionOptions,
  FontPresetId,
  ThemePresetId,
} from '../types/music';
import { formatFileSize } from '../utils/constants';

const THEME_OPTIONS: {
  id: ThemePresetId;
  name: string;
  desc: string;
  swatch: string;
}[] = [
  {
    id: 'adaptive',
    name: '智能封面流彩',
    desc: '自动提取当前专辑封面主色，同步液态波浪与动态光环',
    swatch: 'linear-gradient(135deg, #e8437f, #8b3dff)',
  },
  {
    id: 'burgundy',
    name: '深酒红绯色',
    desc: '经典沉浸式酒红、玫瑰粉与暗紫罗兰氛围',
    swatch: 'linear-gradient(135deg, #e8437f, #58122f)',
  },
  {
    id: 'violet',
    name: '暗夜紫罗兰',
    desc: '高雅深紫与霓虹洋红视觉层次',
    swatch: 'linear-gradient(135deg, #a855f7, #ec4899)',
  },
  {
    id: 'emerald',
    name: '翡翠极光',
    desc: '静谧青绿与深海微光渐层',
    swatch: 'linear-gradient(135deg, #10b981, #06b6d4)',
  },
];

const FONT_OPTIONS: {
  id: FontPresetId;
  name: string;
  sample: string;
  desc: string;
  fontClass: string;
}[] = [
  {
    id: 'modern',
    name: '现代极简 (Plus Jakarta Sans)',
    sample: 'Lumina Music Experience 01234',
    desc: '线条优雅、几何感强、极具科技感与现代流线美感',
    fontClass: 'font-sans-modern',
  },
  {
    id: 'editorial',
    name: '典雅衬线 (Fraunces & Lora)',
    sample: 'Serif Masterpiece 艺术典藏',
    desc: '具有高级音乐杂志与黑胶艺术封面质感的经典衬线字体',
    fontClass: 'font-serif-editorial',
  },
  {
    id: 'rounded',
    name: '圆润亲和 (Outfit & DM Sans)',
    sample: 'Smooth Harmonic Vibe 柔和律动',
    desc: '温暖柔和、无压力的圆润现代无衬线风格',
    fontClass: 'font-sans-rounded',
  },
  {
    id: 'mono',
    name: '科技数码 (JetBrains Mono)',
    sample: 'Digital Hi-Fi Audio 24-bit/96kHz',
    desc: '专业录音室与高保真发烧友风格的沉浸数码等宽字体',
    fontClass: 'font-mono-audiophile',
  },
  {
    id: 'classic',
    name: '系统经典 (System Sans-Serif)',
    sample: 'Standard Native Pro 标准中文',
    desc: '原生高可读性系统无衬线字体，兼顾全语系极致渲染',
    fontClass: 'font-sans-classic',
  },
];

export const SettingsPage: React.FC = () => {
  const {
    personalization,
    updatePersonalization,
    activePalette,
    tracks,
    pendingMvTimelines,
    removePendingMvTimeline,
    resetLibrary,
    reloadAllLibraryData,
    showToast,
  } = useMusic();
  const {
    activeProvider,
    activeStemService,
    openAiCenter,
    refreshProviders,
    refreshStemServices,
  } = useAi();
  const { reloadTasksFromStorage } = useTaskCenter();

  const [storageInfo, setStorageInfo] = useState<{
    usageBytes: number;
    quotaBytes: number;
  }>({ usageBytes: 0, quotaBytes: 0 });
  const [inventory, setInventory] = useState<BackupLocalInventory | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [activeBackupPanel, setActiveBackupPanel] = useState<'none' | 'export' | 'import'>('none');
  const [exportOptions, setExportOptions] = useState<BackupSelectionOptions>({
    ...DEFAULT_BACKUP_EXPORT_OPTIONS,
  });
  const [exportVolumeMode, setExportVolumeMode] = useState<ExportVolumeMode>('auto');
  const [readyVolumes, setReadyVolumes] = useState<
    Array<ExportedBackupVolume & { downloaded: boolean }>
  >([]);
  const [inspectedBatch, setInspectedBatch] = useState<InspectedBackupBatch | null>(null);
  const [importOptions, setImportOptions] = useState<BackupSelectionOptions>({
    ...DEFAULT_BACKUP_EXPORT_OPTIONS,
  });
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [showPendingMvList, setShowPendingMvList] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const activeExportUrlsRef = useRef<string[]>([]);

  const revokeActiveExportUrls = useCallback(() => {
    for (const url of activeExportUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    activeExportUrlsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      revokeActiveExportUrls();
    };
  }, [revokeActiveExportUrls]);

  const refreshStorage = useCallback(async () => {
    const [est, inv] = await Promise.all([
      getStorageEstimate(),
      getBackupLocalInventory().catch(() => null),
    ]);
    setStorageInfo(est);
    if (inv) setInventory(inv);
  }, []);

  useEffect(() => {
    void refreshStorage();
  }, [tracks.length, pendingMvTimelines.length, refreshStorage]);

  const estimatedExportBytes = useMemo(() => {
    if (!inventory) return 0;
    let total = 0;
    if (exportOptions.includeTrackAudio) total += inventory.tracksAudioBytes;
    if (exportOptions.includeMvVideos) total += inventory.mvVideosBytes;
    if (exportOptions.includeStems) total += inventory.stemsBytes;
    // >= 20 MiB uses zero-copy .lumina binary archive (1.0x size, NO +34% Base64 overhead)
    if (total >= 20 * 1024 * 1024) {
      return total + 256 * 1024;
    }
    return Math.round(total * 1.34) + 120 * 1024;
  }, [inventory, exportOptions]);

  const supportsFileSystemPicker =
    typeof window !== 'undefined' &&
    typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

  const hasAnyExportSelected = useMemo(
    () => Object.values(exportOptions).some(Boolean),
    [exportOptions]
  );

  const hasAnyImportSelected = useMemo(
    () => Object.values(importOptions).some(Boolean),
    [importOptions]
  );

  const triggerDownloadVolume = useCallback(
    (vol: ExportedBackupVolume) => {
      if (!vol.blob) return;
      const url = URL.createObjectURL(vol.blob);
      activeExportUrlsRef.current.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = vol.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setReadyVolumes((prev) =>
        prev.map((item) =>
          item.index === vol.index ? { ...item, downloaded: true } : item
        )
      );
    },
    []
  );

  const handleConfirmExportBackup = async () => {
    if (!hasAnyExportSelected) {
      showToast('请至少勾选一项要导出的数据');
      return;
    }

    // Call showSaveFilePicker synchronously inside the click gesture before any IndexedDB awaits!
    let pickedHandle: FileSystemFileHandleLike | null = null;
    let effectiveMode: ExportVolumeMode = exportVolumeMode;
    if (exportVolumeMode === 'single-stream' && supportsFileSystemPicker) {
      try {
        const stamp = new Date().toISOString().slice(0, 10);
        const pickerFn = (
          window as unknown as {
            showSaveFilePicker: (opts?: unknown) => Promise<FileSystemFileHandleLike>;
          }
        ).showSaveFilePicker;
        pickedHandle = await pickerFn({
          suggestedName: `lumina-music-backup-${stamp}.lumina`,
          types: [
            {
              description: 'Lumina Music Backup Archive',
              accept: { 'application/octet-stream': ['.lumina'] },
            },
          ],
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return; // User closed file picker
        }
        // Inside cross-origin iframe / mobile WebView -> seamlessly fall back to safe sharded export
        pickedHandle = null;
        effectiveMode = 'sharded';
        showToast('当前环境限制直接写入磁盘，已自动切换为安全分卷零拷贝导出');
      }
    }

    revokeActiveExportUrls();
    setReadyVolumes([]);
    setBackupBusy(true);
    setBackupNotice(null);
    setBackupProgress('正在初始化零拷贝流式打包...');
    try {
      const result = await exportLuminaBackup(
        exportOptions,
        {
          mode: effectiveMode,
          maxVolumeBytes: SAFE_BROWSER_VOLUME_BYTES,
          diskFileHandle: pickedHandle,
        },
        (msg) => setBackupProgress(msg)
      );

      if (result.usedFileSystemStream) {
        const msg = `已通过流式通道完整直写到本地文件（${formatFileSize(
          result.totalBytes
        )}）：${result.manifest.tracksMetaCount} 首曲目（含 ${
          result.manifest.tracksAudioCount
        } 份音频）、${result.manifest.mvTimelinesCount} 条 MV 配置（含 ${
          result.manifest.mvVideosCount
        } 个视频）、${result.manifest.stemsCount} 组分离音轨。`;
        setBackupNotice(msg);
        showToast('单文件流式导出完成');
        return;
      }

      const itemsWithState = result.volumes.map((v) => ({
        ...v,
        downloaded: false,
      }));
      setReadyVolumes(itemsWithState);

      if (result.volumes.length === 1 && result.volumes[0].blob) {
        const single = result.volumes[0];
        triggerDownloadVolume(single);
        const msg = `已导出数据包（${formatFileSize(
          result.totalBytes
        )} · ${
          result.formatUsed === 'lumina-binary' ? '.lumina 零拷贝档案' : '.json 轻量包'
        }）：${result.manifest.tracksMetaCount} 首曲目（含 ${
          result.manifest.tracksAudioCount
        } 份音频）、${result.manifest.playlistsCount} 个歌单、${
          result.manifest.mvTimelinesCount
        } 条 MV 配置（含 ${result.manifest.mvVideosCount} 个视频）、${
          result.manifest.stemsCount
        } 组分离音轨。`;
        setBackupNotice(msg);
        showToast('数据已成功导出');
      } else {
        // Trigger part 1 automatically; remaining parts appear as instant click cards (avoids Chrome multi-download blocking & memory spikes)
        if (result.volumes[0]?.blob) {
          triggerDownloadVolume(result.volumes[0]);
        }
        const msg = `为防止浏览器在导出 ${formatFileSize(
          result.totalBytes
        )} 大数据时内存崩溃，已安全拆分为 ${
          result.volumes.length
        } 个零拷贝分卷（每卷约 ≤350 MB）。第 1 卷已开始下载，请在下方依次点击保存其余分卷；导入时多选全部 .lumina 分卷即可一键自动还原。`;
        setBackupNotice(msg);
        showToast(`已生成 ${result.volumes.length} 个安全分卷，请依次下载`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出备份失败';
      setBackupNotice(msg);
      showToast(msg);
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };

  const handleSelectImportFiles = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;
    setBackupBusy(true);
    setBackupNotice(null);
    setBackupProgress(`正在读取 ${fileList.length} 个备份文件清单...`);
    try {
      const inspected = await inspectLuminaBackupFiles(fileList);
      setInspectedBatch(inspected);
      setImportOptions({ ...inspected.availableOptions });
      setActiveBackupPanel('import');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析备份文件失败';
      setBackupNotice(msg);
      showToast(msg);
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };

  const handleConfirmImportBackup = async () => {
    if (!inspectedBatch) return;
    if (!hasAnyImportSelected) {
      showToast('请至少勾选一项要导入的数据');
      return;
    }
    setBackupBusy(true);
    setBackupNotice(null);
    setBackupProgress('正在零拷贝导入并自动保存...');
    try {
      const summary = await importLuminaBackupFiles(
        inspectedBatch,
        importOptions,
        importMode,
        (msg) => setBackupProgress(msg)
      );
      await reloadAllLibraryData();
      await reloadTasksFromStorage();
      await Promise.all([
        refreshProviders().catch(() => {}),
        refreshStemServices().catch(() => {}),
        refreshStorage(),
      ]);

      const parts: string[] = [];
      if (summary.tracksRestored > 0) {
        parts.push(
          `${summary.tracksRestored} 首曲目${
            summary.trackAudioRestored > 0
              ? `（含 ${summary.trackAudioRestored} 份音频）`
              : '（仅信息/歌词与偏移）'
          }`
        );
      }
      if (summary.playlistsRestored > 0) parts.push(`${summary.playlistsRestored} 个歌单`);
      if (summary.stemsRestored > 0) parts.push(`${summary.stemsRestored} 组分离音轨`);
      if (summary.mvsRestored > 0) {
        parts.push(
          `${summary.mvsRestored} 条 MV 配置${
            summary.mvVideosRestored > 0
              ? `（含 ${summary.mvVideosRestored} 个视频）`
              : summary.mvTimelinesMatchedExisting > 0
              ? `（${summary.mvTimelinesMatchedExisting} 条已直接应用到现有 MV）`
              : ''
          }`
        );
      }
      if (summary.pendingMvsStored > 0) {
        parts.push(
          `${summary.pendingMvsStored} 条未上传视频的 MV 前瞻/后端时间已自动暂存（导入对应 MV 时自动匹配生效）`
        );
      }
      if (summary.audioSettingsRestored) parts.push('音效与 DSP 调音参数');
      if (summary.personalizationRestored) parts.push('个性化外观与播放偏好');
      if (summary.tasksRestored > 0) {
        parts.push(
          `${summary.tasksRestored} 条任务记录${
            summary.tasksNormalizedToResubmit > 0
              ? `（${summary.tasksNormalizedToResubmit} 个原进行中任务已标记重新提交）`
              : ''
          }`
        );
      }
      if (summary.aiProvidersSynced > 0) {
        parts.push(`${summary.aiProvidersSynced} 项 AI 服务配置`);
      }

      const msg =
        parts.length > 0
          ? `已自动保存并恢复：${parts.join('、')}。`
          : '所选数据类别在备份文件中均为空，已完成检查。';
      setBackupNotice(msg);
      setInspectedBatch(null);
      setActiveBackupPanel('none');
      showToast('导入完成并已自动保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入备份失败';
      setBackupNotice(msg);
      showToast(msg);
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };

  const usagePct =
    storageInfo.quotaBytes > 0
      ? Math.min(100, (storageInfo.usageBytes / storageInfo.quotaBytes) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
          个性化与系统设置
        </h1>
        <p className="text-sm text-white/60 mt-1">
          自定义色彩氛围、界面字体、动态光效、AI 智能中心 API 密钥管理与本地存储配置
        </p>
      </div>

      {/* Settings -> AI Smart Center -> API Service Management */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border border-white/15"
            style={{
              background: `linear-gradient(135deg, ${activePalette.primary}40, ${activePalette.secondary}40)`,
            }}
          >
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              AI 智能中心与第三方 API 服务管理
            </h2>
            <p className="text-xs text-white/65 mt-1">
              {activeProvider
                ? `默认服务：${activeProvider.name} (${activeProvider.model || '未选模型'}) · ${
                    activeProvider.hasKey ? '已加密保存密钥' : '未配置密钥'
                  }`
                : '尚未配置第三方 AI 服务'}
              {' · '}
              {activeStemService && activeStemService.enabled
                ? `分离引擎：${activeStemService.name}`
                : '分离引擎未启用'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => openAiCenter('providers')}
            className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
            style={{
              background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
            }}
          >
            <KeyRound className="w-4 h-4" />
            <span>API 服务管理</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => openAiCenter('assistant')}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white cursor-pointer"
          >
            打开 AI 助手
          </button>
        </div>
      </section>

      {/* Typography Presets */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Type className="w-5 h-5" style={{ color: activePalette.primary }} />
          <h2 className="text-base font-semibold text-white">界面优美字体选择</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {FONT_OPTIONS.map((f) => {
            const active = (personalization.fontPreset || 'modern') === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => updatePersonalization({ fontPreset: f.id })}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-white/[0.12] border-white/35 shadow-lg'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <p className="text-xs font-medium text-white/60 mb-1.5 flex items-center justify-between">
                  <span>{f.name}</span>
                  {active && (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: activePalette.primary }}
                    />
                  )}
                </p>
                <p
                  className={`text-lg sm:text-xl font-bold text-white mb-2 truncate ${f.fontClass}`}
                >
                  {f.sample}
                </p>
                <p className="text-xs text-white/55 leading-relaxed">{f.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Theme & Color Sync */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Palette className="w-5 h-5" style={{ color: activePalette.primary }} />
          <h2 className="text-base font-semibold text-white">主题与配色方案</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {THEME_OPTIONS.map((t) => {
            const active = personalization.themePreset === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  updatePersonalization({
                    themePreset: t.id,
                    followCoverColor: t.id === 'adaptive',
                  })
                }
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-white/[0.12] border-white/30'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <div
                  className="w-full h-10 rounded-xl mb-3 shadow-inner"
                  style={{ background: t.swatch }}
                />
                <p className="text-sm font-medium text-white">{t.name}</p>
                <p className="text-xs text-white/55 mt-1 leading-relaxed">{t.desc}</p>
              </button>
            );
          })}
        </div>

        <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
          <div>
            <span className="text-sm font-medium text-white block">
              液态波浪与光效自动跟随专辑封面主色
            </span>
            <span className="text-xs text-white/55 block mt-0.5">
              切换不同歌曲时，播放器将读取封面色彩并平滑过渡视觉色调
            </span>
          </div>
          <input
            type="checkbox"
            checked={personalization.followCoverColor}
            onChange={(e) =>
              updatePersonalization({
                followCoverColor: e.target.checked,
                ...(e.target.checked ? { themePreset: 'adaptive' } : {}),
              })
            }
            className="accent-rose-500 w-4 h-4 shrink-0"
          />
        </label>
      </section>

      {/* Visualizers & Animation Intensity */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Waves className="w-5 h-5" style={{ color: activePalette.secondary }} />
          <h2 className="text-base font-semibold text-white">可视化与动画性能</h2>
        </div>

        <div>
          <span className="text-xs text-white/70 block mb-2.5">
            光环与波浪渲染强度（性能较低的平板可选「低功耗」以保持流畅）
          </span>
          <div className="grid grid-cols-3 gap-2.5 max-w-md">
            {(
              [
                { id: 'low', label: '低功耗' },
                { id: 'balanced', label: '均衡流畅' },
                { id: 'high', label: '高帧绚丽' },
              ] as { id: AnimationIntensity; label: string }[]
            ).map((opt) => {
              const active = personalization.animationIntensity === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    updatePersonalization({ animationIntensity: opt.id })
                  }
                  className={`py-2.5 px-3 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/15 border-white/30 text-white'
                      : 'bg-white/[0.03] border-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-white block">
                底部多层液态音频波浪
              </span>
              <span className="text-xs text-white/55 block mt-0.5">
                随音频频谱起伏流动的半透明发光液态波浪
              </span>
            </div>
            <input
              type="checkbox"
              checked={personalization.showLiquidWave}
              onChange={(e) =>
                updatePersonalization({ showLiquidWave: e.target.checked })
              }
              className="accent-rose-500 w-4 h-4 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-white block">
                背景液态流体随音乐响应
              </span>
              <span className="text-xs text-white/55 block mt-0.5">
                保持缓慢优雅水流节奏，随低频与音量轻微呼吸起伏
              </span>
            </div>
            <input
              type="checkbox"
              checked={personalization.dynamicBackgroundGlow}
              onChange={(e) =>
                updatePersonalization({ dynamicBackgroundGlow: e.target.checked })
              }
              className="accent-rose-500 w-4 h-4 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-white block">
                减少动态效果
              </span>
              <span className="text-xs text-white/55 block mt-0.5">
                开启后暂停连续背景流动，并自动兼容系统减弱动态效果选项
              </span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(personalization.reducedMotion)}
              onChange={(e) =>
                updatePersonalization({ reducedMotion: e.target.checked })
              }
              className="accent-rose-500 w-4 h-4 shrink-0"
            />
          </label>

          <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 md:col-span-2">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-white/85">液态光影明度</span>
              <span className="font-mono-tabular text-white/75">
                {personalization.glowIntensity}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={personalization.glowIntensity}
              disabled={!personalization.dynamicBackgroundGlow}
              onChange={(e) =>
                updatePersonalization({ glowIntensity: Number(e.target.value) })
              }
              className="lumina-range w-full"
            />
          </div>
        </div>
      </section>

      {/* IndexedDB Storage Diagnostics & Management */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5" style={{ color: activePalette.primary }} />
            <h2 className="text-base font-semibold text-white">本地存储管理 (IndexedDB)</h2>
          </div>

          <button
            type="button"
            onClick={refreshStorage}
            className="p-2 rounded-xl bg-white/8 hover:bg-white/14 text-white/70 hover:text-white transition-colors cursor-pointer"
            title="刷新存储空间统计"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-white/75 font-mono-tabular">
            <span>已保存 {tracks.length} 首曲目 · 已用 {formatFileSize(storageInfo.usageBytes)}</span>
            <span>
              可用配额{' '}
              {storageInfo.quotaBytes > 0
                ? `${(storageInfo.quotaBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
                : '未知'}
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${usagePct}%`,
                background: `linear-gradient(90deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            />
          </div>
        </div>

        {backupProgress && (
          <div className="p-3 rounded-xl bg-white/[0.08] border border-white/20 text-xs text-white flex items-center gap-2.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>{backupProgress}</span>
          </div>
        )}

        {backupNotice && (
          <div className="p-3.5 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white/90 leading-relaxed flex items-start gap-2">
            <CheckCircle2
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: activePalette.primary }}
            />
            <span>{backupNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <input
            ref={importInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleSelectImportFiles}
          />
          <button
            type="button"
            disabled={backupBusy}
            onClick={() => importInputRef.current?.click()}
            className={`px-4 py-2.5 rounded-xl border text-xs font-medium text-white flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors ${
              activeBackupPanel === 'import'
                ? 'bg-white/20 border-white/35'
                : 'bg-white/10 hover:bg-white/16 border-white/15'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>导入数据 (支持 .lumina 分卷 / .json)</span>
          </button>

          <button
            type="button"
            disabled={backupBusy}
            onClick={() =>
              setActiveBackupPanel((prev) => (prev === 'export' ? 'none' : 'export'))
            }
            className={`px-4 py-2.5 rounded-xl border text-xs font-medium text-white flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors ${
              activeBackupPanel === 'export'
                ? 'bg-white/20 border-white/35'
                : 'bg-white/10 hover:bg-white/16 border-white/15'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>选择数据导出 (.lumina / JSON)</span>
            {activeBackupPanel === 'export' ? (
              <ChevronUp className="w-3.5 h-3.5 opacity-80" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 opacity-80" />
            )}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-medium text-rose-200 flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>清空或重置曲库</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-rose-500/20 border border-rose-500/35 p-1.5 rounded-xl">
                <span className="text-xs text-rose-100 px-2 font-medium">确认清空所有数据？</span>
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmReset(false);
                    await resetLibrary();
                    await refreshStorage();
                    showToast('已清空本地曲库');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white cursor-pointer"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-xs font-medium text-white cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Selectable Export Options Drawer */}
        {activeBackupPanel === 'export' && (
          <div className="rounded-2xl bg-black/30 border border-white/15 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  选择要导出的数据与调整项
                </h3>
                <p className="text-xs text-white/55 mt-0.5">
                  支持分块流式打包大体积音视频；若需快速同步设置、歌词与 MV 前瞻/后端时间，可选用「轻量同步」
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setExportOptions({ ...DEFAULT_BACKUP_EXPORT_OPTIONS })}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-[11px] text-white cursor-pointer"
                >
                  全选完整数据
                </button>
                <button
                  type="button"
                  onClick={() => setExportOptions({ ...LIGHTWEIGHT_BACKUP_OPTIONS })}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-[11px] text-white cursor-pointer"
                >
                  轻量同步 (不含音视频大文件)
                </button>
                <button
                  type="button"
                  onClick={() => setExportOptions({ ...MV_TIMELINE_ONLY_BACKUP_OPTIONS })}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-[11px] text-white cursor-pointer"
                >
                  仅 MV 前瞻/后端时间
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {(
                [
                  {
                    key: 'includeTracksMeta',
                    title: '新增曲目信息与歌词微调',
                    desc: `${inventory?.tracksMetaCount ?? tracks.length} 首（曲目信息、封面、收藏、编辑/翻译歌词、歌词时间偏移）`,
                  },
                  {
                    key: 'includeTrackAudio',
                    title: '歌曲音频文件本体',
                    desc: `${inventory?.tracksAudioCount ?? 0} 份 · ${formatFileSize(
                      inventory?.tracksAudioBytes ?? 0
                    )}（MP3 / FLAC / WAV 等原始音频）`,
                  },
                  {
                    key: 'includePlaylists',
                    title: '自建播放列表与歌单排序',
                    desc: `${inventory?.playlistsCount ?? 0} 个歌单`,
                  },
                  {
                    key: 'includeMvTimelines',
                    title: 'MV 前瞻时间、后段时间与剧场调整',
                    desc: `${inventory?.mvTimelinesCount ?? 0} 项（前瞻起点、后段尾声、中段断点、模糊/透明度、外链与待匹配预设）`,
                  },
                  {
                    key: 'includeMvVideos',
                    title: 'MV 本地视频文件本体',
                    desc: `${inventory?.mvVideosCount ?? 0} 个视频 · ${formatFileSize(
                      inventory?.mvVideosBytes ?? 0
                    )}`,
                  },
                  {
                    key: 'includeStems',
                    title: 'AI 分离人声/伴奏缓存音轨',
                    desc: `${inventory?.stemsCount ?? 0} 组 · ${formatFileSize(
                      inventory?.stemsBytes ?? 0
                    )}`,
                  },
                  {
                    key: 'includeAudioSettings',
                    title: '音质与 DSP 音效调整',
                    desc: '7 段均衡器 EQ、3D 环绕、耳机优化、混响、低高音与人声平衡比例',
                  },
                  {
                    key: 'includePersonalization',
                    title: '界面个性化与播放偏好',
                    desc: '主题色彩、界面字体、动态光效、液态波浪、MV UI 淡入淡出与循环模式',
                  },
                  {
                    key: 'includeAiData',
                    title: 'AI 服务商配置与任务中心记录',
                    desc: `${inventory?.aiProvidersCount ?? 0} 个 AI 服务、${
                      inventory?.aiTasksCount ?? 0
                    } 条任务记录（不含 API 密钥）`,
                  },
                ] as {
                  key: keyof BackupSelectionOptions;
                  title: string;
                  desc: string;
                }[]
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer"
                >
                  <div>
                    <span className="text-xs font-medium text-white block">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-white/55 block mt-0.5 leading-relaxed">
                      {item.desc}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={exportOptions[item.key]}
                    onChange={(e) =>
                      setExportOptions((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                    className="accent-rose-500 w-4 h-4 mt-0.5 shrink-0"
                  />
                </label>
              ))}
            </div>

            {/* Multi-volume Download List when backup was safely sharded */}
            {readyVolumes.length > 1 && (
              <div className="rounded-xl bg-white/[0.05] border border-white/15 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">
                    安全分卷导出列表（共 {readyVolumes.length} 个分卷 · 零拷贝防崩溃）
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      revokeActiveExportUrls();
                      setReadyVolumes([]);
                    }}
                    className="text-[11px] text-white/60 hover:text-white cursor-pointer"
                  >
                    清除列表
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {readyVolumes.map((vol) => (
                    <div
                      key={vol.index}
                      className="flex items-center justify-between gap-2.5 p-2.5 rounded-lg bg-black/30 border border-white/10"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          分卷 {vol.index}/{vol.total} · {formatFileSize(vol.sizeBytes)}
                        </p>
                        <p className="text-[11px] text-white/55 truncate">
                          {vol.summary}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => triggerDownloadVolume(vol)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0 cursor-pointer ${
                          vol.downloaded
                            ? 'bg-emerald-500/20 border border-emerald-400/35 text-emerald-100'
                            : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        {vol.downloaded ? '再次下载' : '点击下载'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Large-data export transport mode */}
            {estimatedExportBytes >= 20 * 1024 * 1024 && (
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 space-y-2">
                <span className="text-[11px] font-medium text-white/80 block">
                  大体积导出模式（≥20 MB 自动采用 .lumina 零拷贝容器，不经过 Base64 膨胀与 JS 堆复制）
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setExportVolumeMode('auto')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] border cursor-pointer ${
                      exportVolumeMode === 'auto' || exportVolumeMode === 'sharded'
                        ? 'bg-white/20 border-white/35 text-white'
                        : 'bg-white/5 border-white/10 text-white/65 hover:text-white'
                    }`}
                  >
                    自动安全分卷 (每卷 ≤350 MB · 手机/平板 2GB+ 推荐)
                  </button>
                  {supportsFileSystemPicker && (
                    <button
                      type="button"
                      onClick={() => setExportVolumeMode('single-stream')}
                      className={`px-3 py-1.5 rounded-lg text-[11px] border cursor-pointer ${
                        exportVolumeMode === 'single-stream'
                          ? 'bg-white/20 border-white/35 text-white'
                          : 'bg-white/5 border-white/10 text-white/65 hover:text-white'
                      }`}
                    >
                      桌面单文件直写磁盘 (8MB 流式直写)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExportVolumeMode('single-blob')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] border cursor-pointer ${
                      exportVolumeMode === 'single-blob'
                        ? 'bg-white/20 border-white/35 text-white'
                        : 'bg-white/5 border-white/10 text-white/65 hover:text-white'
                    }`}
                  >
                    合并单文件下载
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
              <span className="text-xs text-white/65 font-mono-tabular">
                预计导出体积：约 {formatFileSize(estimatedExportBytes)}
                {estimatedExportBytes > SAFE_BROWSER_VOLUME_BYTES
                  ? '（2GB 级媒体将自动零拷贝分卷打包，绝不内存崩溃）'
                  : estimatedExportBytes >= 20 * 1024 * 1024
                  ? '（.lumina 零拷贝无损打包）'
                  : '（轻量 .json 文件）'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => setActiveBackupPanel('none')}
                  className="px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs text-white/80 cursor-pointer"
                >
                  收起
                </button>
                <button
                  type="button"
                  disabled={backupBusy || !hasAnyExportSelected}
                  onClick={handleConfirmExportBackup}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  style={{
                    background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>确认导出数据包</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sharded volumes download panel even after closing export drawer */}
        {activeBackupPanel !== 'export' && readyVolumes.length > 1 && (
          <div className="rounded-2xl bg-black/30 border border-white/15 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                待下载导出分卷（共 {readyVolumes.length} 卷）
              </span>
              <button
                type="button"
                onClick={() => {
                  revokeActiveExportUrls();
                  setReadyVolumes([]);
                }}
                className="text-[11px] text-white/60 hover:text-white cursor-pointer"
              >
                完成并关闭
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {readyVolumes.map((vol) => (
                <div
                  key={vol.index}
                  className="flex items-center justify-between gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      分卷 {vol.index}/{vol.total} · {formatFileSize(vol.sizeBytes)}
                    </p>
                    <p className="text-[11px] text-white/55 truncate">{vol.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerDownloadVolume(vol)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0 cursor-pointer ${
                      vol.downloaded
                        ? 'bg-emerald-500/20 border border-emerald-400/35 text-emerald-100'
                        : 'bg-white/15 hover:bg-white/25 text-white'
                    }`}
                  >
                    {vol.downloaded ? '再次下载' : '点击下载'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selectable Import Options & Auto-Save Confirmation Drawer */}
        {activeBackupPanel === 'import' && inspectedBatch && (
          <div className="rounded-2xl bg-black/30 border border-white/15 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  选择要导入并自动保存的数据项
                </h3>
                <p className="text-xs text-white/60 mt-0.5">
                  {inspectedBatch.items.length === 1
                    ? `文件：${inspectedBatch.items[0].fileName}`
                    : `已批量选中 ${inspectedBatch.items.length} 个分卷文件`}
                  （共 {formatFileSize(inspectedBatch.totalSizeBytes)}）
                  {inspectedBatch.exportedAt
                    ? ` · 导出时间：${new Date(inspectedBatch.exportedAt).toLocaleString()}`
                    : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                    importMode === 'merge'
                      ? 'bg-white/20 border-white/35 text-white'
                      : 'bg-white/5 border-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  智能合并与覆盖同项 (推荐)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border cursor-pointer ${
                    importMode === 'replace'
                      ? 'bg-rose-500/25 border-rose-400/50 text-rose-100'
                      : 'bg-white/5 border-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  清空所选类别后写入
                </button>
              </div>
            </div>

            {inspectedBatch.missingSplitChunksWarning && (
              <div className="rounded-xl bg-amber-500/15 border border-amber-400/35 px-3.5 py-2.5 text-xs text-amber-100 leading-relaxed">
                {inspectedBatch.missingSplitChunksWarning}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {(
                [
                  {
                    key: 'includeTracksMeta',
                    available: inspectedBatch.availableOptions.includeTracksMeta,
                    title: '增加的歌曲信息与歌词调整',
                    desc: `包内含 ${inspectedBatch.manifest.tracksMetaCount} 首曲目、封面、收藏与歌词/时间偏移`,
                  },
                  {
                    key: 'includeTrackAudio',
                    available: inspectedBatch.availableOptions.includeTrackAudio,
                    title: '歌曲音频文件本体',
                    desc: `包内含 ${inspectedBatch.manifest.tracksAudioCount} 份音频文件（导入即自动保存到本地曲库）`,
                  },
                  {
                    key: 'includePlaylists',
                    available: inspectedBatch.availableOptions.includePlaylists,
                    title: '增加的播放列表与歌单排序',
                    desc: `包内含 ${inspectedBatch.manifest.playlistsCount} 个歌单`,
                  },
                  {
                    key: 'includeMvTimelines',
                    available: inspectedBatch.availableOptions.includeMvTimelines,
                    title: 'MV 前瞻时间、后段时间与视效调整',
                    desc: `包内含 ${inspectedBatch.manifest.mvTimelinesCount} 条（若对应 MV 尚未导入，将自动暂存并在日后导入该 MV 时自动匹配）`,
                  },
                  {
                    key: 'includeMvVideos',
                    available: inspectedBatch.availableOptions.includeMvVideos,
                    title: 'MV 本地视频文件本体',
                    desc: `包内含 ${inspectedBatch.manifest.mvVideosCount} 个 MV 视频文件`,
                  },
                  {
                    key: 'includeStems',
                    available: inspectedBatch.availableOptions.includeStems,
                    title: 'AI 分离人声与伴奏缓存音轨',
                    desc: `包内含 ${inspectedBatch.manifest.stemsCount} 组分离音轨`,
                  },
                  {
                    key: 'includeAudioSettings',
                    available: inspectedBatch.availableOptions.includeAudioSettings,
                    title: '调整过的音质与 DSP 音效参数',
                    desc: inspectedBatch.manifest.hasAudioSettings
                      ? '包含 7 段均衡器 EQ、环绕声、混响、人声/伴奏平衡等调整'
                      : '此备份包未包含音质参数',
                  },
                  {
                    key: 'includePersonalization',
                    available: inspectedBatch.availableOptions.includePersonalization,
                    title: '调整过的个性化外观与播放偏好',
                    desc: inspectedBatch.manifest.hasPersonalization
                      ? '包含主题流彩、字体、光效波浪、MV UI 淡入淡出时长与播放偏好'
                      : '此备份包未包含个性化偏好',
                  },
                  {
                    key: 'includeAiData',
                    available: inspectedBatch.availableOptions.includeAiData,
                    title: 'AI 服务商配置与任务记录',
                    desc: `包含 ${inspectedBatch.manifest.aiProvidersCount} 个 AI 服务配置、${inspectedBatch.manifest.aiTasksCount} 条任务记录（保留本机已有密钥）`,
                  },
                ] as {
                  key: keyof BackupSelectionOptions;
                  available: boolean;
                  title: string;
                  desc: string;
                }[]
              ).map((item) => (
                <label
                  key={item.key}
                  className={`flex items-start justify-between gap-3 p-3 rounded-xl border ${
                    item.available
                      ? 'bg-white/[0.05] border-white/12 hover:bg-white/[0.08] cursor-pointer'
                      : 'bg-white/[0.02] border-white/5 opacity-45 cursor-not-allowed'
                  }`}
                >
                  <div>
                    <span className="text-xs font-medium text-white block">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-white/55 block mt-0.5 leading-relaxed">
                      {item.desc}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!item.available}
                    checked={item.available && importOptions[item.key]}
                    onChange={(e) =>
                      setImportOptions((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                    className="accent-rose-500 w-4 h-4 mt-0.5 shrink-0"
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
              <span className="text-[11px] text-white/60">
                点击确认后将自动写入本地数据库并即时刷新生效，无需再手动保存。
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => {
                    setInspectedBatch(null);
                    setActiveBackupPanel('none');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs text-white/80 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={backupBusy || !hasAnyImportSelected}
                  onClick={handleConfirmImportBackup}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  style={{
                    background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>确认导入并自动保存</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deferred / Pending MV Timelines waiting for MV video upload */}
        {pendingMvTimelines.length > 0 && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/12 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" style={{ color: activePalette.primary }} />
                <div>
                  <p className="text-xs font-semibold text-white">
                    已暂存 {pendingMvTimelines.length} 条待匹配 MV 前瞻 / 后端时间预设
                  </p>
                  <p className="text-[11px] text-white/55">
                    当您在 MV 剧场中导入对应视频时，将自动对应并恢复前瞻时间与后段尾声时间
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPendingMvList((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-xs text-white flex items-center gap-1 cursor-pointer"
              >
                <span>{showPendingMvList ? '收起列表' : '查看待匹配预设'}</span>
                {showPendingMvList ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {showPendingMvList && (
              <div className="space-y-2 max-h-60 overflow-y-auto lumina-scroll pr-1">
                {pendingMvTimelines.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/25 border border-white/10"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">
                        {p.mvTitle || p.fileName || 'MV 预设'}
                        {p.trackTitle ? ` · 对应歌曲「${p.trackTitle}」` : ''}
                      </p>
                      <p className="text-[11px] text-white/60 mt-0.5 font-mono-tabular">
                        前瞻：{p.timeline.introEnabled ? `${p.timeline.introEndSec}s` : '关闭'}
                        {' · '}
                        后段：
                        {p.timeline.outroEnabled
                          ? p.timeline.outroEndSec
                            ? `${p.timeline.outroEndSec}s`
                            : '至视频末尾'
                          : '关闭'}
                        {p.timeline.midBreaks?.length
                          ? ` · 间奏断点 ${p.timeline.midBreaks.length} 处`
                          : ''}
                        {p.fileName ? ` · 文件：${p.fileName}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePendingMvTimeline(p.id)}
                      className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-200 cursor-pointer shrink-0"
                      title="删除此暂存预设"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
