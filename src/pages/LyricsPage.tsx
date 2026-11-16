import React, { useRef, useState } from 'react';
import {
  FileUp,
  Languages,
  Maximize2,
  Minimize2,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { LyricsEditorModal } from '../components/lyrics/LyricsEditorModal';
import { LyricsSearchModal } from '../components/lyrics/LyricsSearchModal';
import { LyricsView } from '../components/lyrics/LyricsView';
import { useMusic } from '../context/MusicContext';
import { formatTime } from '../utils/constants';

export const LyricsPage: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    activePalette,
    personalization,
    isFullscreen,
    toggleFullscreen,
    togglePlayPause,
    seekTo,
    updateTrackLyrics,
    translateTrackLyrics,
    isTranslatingLyrics,
    updateLyricsOffset,
    updatePersonalization,
    showToast,
  } = useMusic();

  const [searchOpen, setSearchOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const lrcInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportLrc = async (file: File) => {
    if (!currentTrack) return;
    try {
      const text = await file.text();
      await updateTrackLyrics(currentTrack.id, text);
    } catch {
      showToast('读取 .lrc 歌词文件失败');
    }
  };

  const offsetMs = currentTrack?.lyricsOffsetMs || 0;
  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;

  return (
    <div className="h-full flex flex-col px-4 sm:px-6 lg:px-10 py-5 gap-5 overflow-hidden">
      <input
        ref={lrcInputRef}
        type="file"
        accept=".lrc,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportLrc(f);
          e.target.value = '';
        }}
      />

      {/* Top Track Context + Lyrics Studio Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0 rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-4 sm:p-5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-white/10 shrink-0">
            {currentTrack?.coverDataUrl && (
              <img
                src={currentTrack.coverDataUrl}
                alt={currentTrack.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-semibold text-white truncate">
              {currentTrack ? currentTrack.title : '歌词中心'}
            </h1>
            <p className="text-xs sm:text-sm text-white/60 truncate mt-0.5">
              {currentTrack
                ? `${currentTrack.artist} · ${formatTime(currentTime)} / ${formatTime(
                    effectiveDuration
                  )}`
                : '请先选择并播放一首歌曲'}
            </p>
          </div>
        </div>

        {currentTrack && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={togglePlayPause}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" fill="currentColor" />
              ) : (
                <Play className="w-3.5 h-3.5" fill="currentColor" />
              )}
              {isPlaying ? '暂停' : '播放'}
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              在线搜索匹配
            </button>

            <button
              type="button"
              onClick={() => lrcInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs text-white flex items-center gap-1.5 cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" />
              导入 .lrc
            </button>

            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs text-white flex items-center gap-1.5 cursor-pointer"
            >
              <PencilLine className="w-3.5 h-3.5" />
              编辑歌词
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs text-white flex items-center gap-1.5 cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
              {isFullscreen ? '退出全屏' : '全屏展示'}
            </button>
          </div>
        )}
      </div>

      {/* Main Lyrics Canvas + Sync Calibration Strip */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-9 min-h-0 rounded-3xl bg-white/[0.04] backdrop-blur-2xl border border-white/10 p-5 sm:p-8 flex flex-col">
          <LyricsView
            lyricsRaw={currentTrack?.lyricsRaw}
            currentTime={currentTime}
            offsetMs={offsetMs}
            palette={activePalette}
            showBilingual={personalization.showBilingualLyrics}
            showWordSync={personalization.showWordSync}
            onSeek={seekTo}
            onAdjustOffset={
              currentTrack
                ? (ms) => updateLyricsOffset(currentTrack.id, ms)
                : undefined
            }
            onImportLrcFile={currentTrack ? handleImportLrc : undefined}
            onOpenSearchOnline={currentTrack ? () => setSearchOpen(true) : undefined}
            onOpenEditor={currentTrack ? () => setEditorOpen(true) : undefined}
            onTranslateLyrics={
              currentTrack ? () => translateTrackLyrics(currentTrack.id) : undefined
            }
            isTranslating={isTranslatingLyrics}
          />
        </div>

        {/* Right Calibration & Display Controls */}
        <aside className="lg:col-span-3 rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 space-y-6 overflow-y-auto lumina-scroll">
          <div>
            <h2 className="text-sm font-semibold text-white">时间轴微调</h2>
            <p className="text-xs text-white/55 mt-1 leading-relaxed">
              手动校准当前歌曲歌词与音频的同步偏移（正值提前显示，负值延后显示）。
            </p>

            <div className="mt-4 p-3.5 rounded-2xl bg-black/30 border border-white/10 text-center">
              <span className="text-xs text-white/50">当前偏移</span>
              <p className="font-mono-tabular text-xl font-semibold text-white mt-0.5">
                {offsetMs > 0 ? `+${(offsetMs / 1000).toFixed(1)}s` : `${(offsetMs / 1000).toFixed(1)}s`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                type="button"
                disabled={!currentTrack}
                onClick={() => currentTrack && updateLyricsOffset(currentTrack.id, offsetMs - 500)}
                className="py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-mono-tabular text-white cursor-pointer disabled:opacity-40"
              >
                延后 0.5s
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={() => currentTrack && updateLyricsOffset(currentTrack.id, offsetMs + 500)}
                className="py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-mono-tabular text-white cursor-pointer disabled:opacity-40"
              >
                提前 0.5s
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={() => currentTrack && updateLyricsOffset(currentTrack.id, offsetMs - 100)}
                className="py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-mono-tabular text-white cursor-pointer disabled:opacity-40"
              >
                延后 0.1s
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={() => currentTrack && updateLyricsOffset(currentTrack.id, offsetMs + 100)}
                className="py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-mono-tabular text-white cursor-pointer disabled:opacity-40"
              >
                提前 0.1s
              </button>
            </div>

            <button
              type="button"
              disabled={!currentTrack || offsetMs === 0}
              onClick={() => currentTrack && updateLyricsOffset(currentTrack.id, 0)}
              className="w-full mt-2 py-2 rounded-xl bg-white/6 hover:bg-white/12 text-xs text-white/75 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重置偏移归零
            </button>
          </div>

          <div className="pt-4 border-t border-white/10 space-y-3">
            <h2 className="text-sm font-semibold text-white">显示选项</h2>

            <label className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/8 cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Languages className="w-4 h-4 text-white/70" />
                <span className="text-xs text-white/90">双语歌词显示</span>
              </div>
              <input
                type="checkbox"
                checked={personalization.showBilingualLyrics}
                onChange={(e) =>
                  updatePersonalization({ showBilingualLyrics: e.target.checked })
                }
                className="accent-rose-500 w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/8 cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-white/70" />
                <div>
                  <span className="text-xs text-white/90 block">逐字同步高亮</span>
                  <span className="text-[10px] text-white/50 block">
                    仅在存在真实逐字时间戳时启用
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={personalization.showWordSync}
                onChange={(e) =>
                  updatePersonalization({ showWordSync: e.target.checked })
                }
                className="accent-rose-500 w-4 h-4"
              />
            </label>
          </div>
        </aside>
      </div>

      <LyricsSearchModal
        open={searchOpen}
        track={currentTrack}
        palette={activePalette}
        onClose={() => setSearchOpen(false)}
        onApplyLyrics={(raw) => {
          if (currentTrack) updateTrackLyrics(currentTrack.id, raw);
        }}
      />

      <LyricsEditorModal
        open={editorOpen}
        track={currentTrack}
        currentTime={currentTime}
        palette={activePalette}
        onClose={() => setEditorOpen(false)}
        onSave={(raw) => {
          if (currentTrack) updateTrackLyrics(currentTrack.id, raw);
        }}
      />
    </div>
  );
};
