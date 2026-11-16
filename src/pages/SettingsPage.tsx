import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Database,
  Download,
  KeyRound,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Waves,
} from 'lucide-react';
import { useAi } from '../context/AiContext';
import { useMusic } from '../context/MusicContext';
import { useTaskCenter } from '../context/TaskCenterContext';
import {
  exportFullLuminaBackup,
  importFullLuminaBackup,
} from '../services/backupService';
import { getStorageEstimate } from '../services/storage';
import { AnimationIntensity, FontPresetId, ThemePresetId } from '../types/music';
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
    loadDemoLibrary,
    resetLibrary,
    reloadAllLibraryData,
    showToast,
  } = useMusic();
  const { activeProvider, activeStemService, openAiCenter } = useAi();
  const { reloadTasksFromStorage } = useTaskCenter();

  const [storageInfo, setStorageInfo] = useState<{
    usageBytes: number;
    quotaBytes: number;
  }>({ usageBytes: 0, quotaBytes: 0 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStorage = async () => {
    const est = await getStorageEstimate();
    setStorageInfo(est);
  };

  useEffect(() => {
    refreshStorage();
  }, [tracks.length]);

  const handleExportBackup = async () => {
    setBackupBusy(true);
    setBackupNotice(null);
    try {
      const { bundle, filename } = await exportFullLuminaBackup();
      const json = JSON.stringify(bundle);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      const msg = `已导出完整备份：${bundle.tracks.length} 首歌曲、${bundle.stems.length} 组分离音轨、${bundle.aiTasks.length} 条任务记录（不含 API 密钥）`;
      setBackupNotice(msg);
      showToast('完整备份已导出');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出备份失败';
      setBackupNotice(msg);
      showToast(msg);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackupFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    setBackupNotice(null);
    try {
      const text = await file.text();
      const summary = await importFullLuminaBackup(text);
      await reloadAllLibraryData();
      await reloadTasksFromStorage();
      await refreshStorage();
      const msg = `已恢复 ${summary.tracksRestored} 首曲目、${summary.playlistsRestored} 个歌单、${summary.stemsRestored} 组分离音轨、${summary.tasksRestored} 条任务记录${
        summary.tasksNormalizedToResubmit > 0
          ? `（其中 ${summary.tasksNormalizedToResubmit} 个原进行中任务已标记为「等待重新提交」）`
          : ''
      }`;
      setBackupNotice(msg);
      showToast('备份恢复完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入备份失败';
      setBackupNotice(msg);
      showToast(msg);
    } finally {
      setBackupBusy(false);
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

        {backupNotice && (
          <div className="p-3 rounded-xl bg-white/[0.06] border border-white/12 text-xs text-white/85 leading-relaxed">
            {backupNotice}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportBackupFile}
          />
          <button
            type="button"
            disabled={backupBusy}
            onClick={() => importInputRef.current?.click()}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>导入备份还原</span>
          </button>

          <button
            type="button"
            disabled={backupBusy}
            onClick={handleExportBackup}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>导出完整备份 (JSON)</span>
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
      </section>
    </div>
  );
};
