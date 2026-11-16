import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileUp,
  Languages,
  Loader2,
  PencilLine,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { LyricLine, TrackColorPalette } from '../../types/music';
import { findActiveLyricIndex, parseLrc } from '../../utils/lrcParser';

interface LyricsViewProps {
  lyricsRaw?: string;
  currentTime: number;
  offsetMs: number;
  palette: TrackColorPalette;
  showBilingual: boolean;
  showWordSync: boolean;
  onSeek: (timeSec: number) => void;
  onAdjustOffset?: (newOffsetMs: number) => void;
  onImportLrcFile?: (file: File) => void;
  onOpenSearchOnline?: () => void;
  onOpenEditor?: () => void;
  onTranslateLyrics?: () => void;
  isTranslating?: boolean;
  compact?: boolean;
  immersive?: boolean;
}

export const LyricsView: React.FC<LyricsViewProps> = ({
  lyricsRaw,
  currentTime,
  offsetMs,
  palette,
  showBilingual,
  showWordSync,
  onSeek,
  onAdjustOffset,
  onImportLrcFile,
  onOpenSearchOnline,
  onOpenEditor,
  onTranslateLyrics,
  isTranslating = false,
  compact = false,
  immersive = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const lrcFileInputRef = useRef<HTMLInputElement | null>(null);
  const [userScrolling, setUserScrolling] = useState(false);
  const userScrollTimerRef = useRef<number | null>(null);

  const parsed = useMemo(() => parseLrc(lyricsRaw), [lyricsRaw]);
  const activeIdx = useMemo(
    () => findActiveLyricIndex(parsed.lines, currentTime, offsetMs),
    [parsed.lines, currentTime, offsetMs]
  );

  // Auto-scroll active lyric smoothly to center unless user is manually scrolling
  useEffect(() => {
    if (activeIdx < 0 || userScrolling) return;
    const container = containerRef.current;
    const activeEl = lineRefs.current.get(activeIdx);
    if (!container || !activeEl) return;

    const targetTop =
      activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [activeIdx, userScrolling]);

  const handleManualScroll = () => {
    setUserScrolling(true);
    if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = window.setTimeout(() => {
      setUserScrolling(false);
    }, 3200);
  };

  const effectiveTime = currentTime + offsetMs / 1000;

  const renderLineText = (line: LyricLine, isActive: boolean) => {
    if (
      isActive &&
      showWordSync &&
      parsed.hasWordTimestamps &&
      line.words &&
      line.words.length > 0
    ) {
      return (
        <span className="inline-flex flex-wrap justify-start gap-x-[1px]">
          {line.words.map((w, wi) => {
            const nextW = line.words![wi + 1];
            const isSung = effectiveTime >= w.time;
            const isCurrentWord =
              isSung && (!nextW || effectiveTime < nextW.time);
            return (
              <span
                key={`${line.id}-w-${wi}`}
                className="transition-all duration-150"
                style={{
                  color: isSung ? '#ffffff' : 'rgba(255,255,255,0.5)',
                  textShadow: isCurrentWord
                    ? `0 0 18px ${palette.primary}`
                    : undefined,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </span>
      );
    }
    return line.text;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Subtle lyric toolbar */}
      <div
        className={`flex items-center justify-between gap-2 pb-3 shrink-0 transition-opacity duration-300 ${
          immersive
            ? 'border-b border-white/[0.06] opacity-60 hover:opacity-100 focus-within:opacity-100'
            : 'border-b border-white/10'
        }`}
      >
        <div className="flex items-center gap-2 text-xs text-white/60 truncate">
          <Languages className="w-3.5 h-3.5 text-white/70 shrink-0" />
          <span className="truncate">
            {parsed.lines.length === 0
              ? '暂无歌词'
              : parsed.hasSyncedTimestamps
              ? parsed.hasWordTimestamps && showWordSync
                ? '逐字同步歌词'
                : '实时同步歌词'
              : '纯文本歌词'}
          </span>
          {offsetMs !== 0 && (
            <span className="font-mono-tabular text-white/75">
              · 偏移 {offsetMs > 0 ? `+${(offsetMs / 1000).toFixed(1)}s` : `${(offsetMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onAdjustOffset && parsed.hasSyncedTimestamps && (
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10">
              <button
                type="button"
                onClick={() => onAdjustOffset(offsetMs - 500)}
                title="歌词延后 0.5 秒"
                className="px-2 py-1 text-[11px] font-mono-tabular text-white/75 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => onAdjustOffset(offsetMs + 500)}
                title="歌词提前 0.5 秒"
                className="px-2 py-1 text-[11px] font-mono-tabular text-white/75 hover:text-white hover:bg-white/10 rounded-md transition-colors whitespace-nowrap"
              >
                +0.5s
              </button>
            </div>
          )}

          {onTranslateLyrics && parsed.lines.length > 0 && !parsed.hasTranslations && (
            <button
              type="button"
              disabled={isTranslating}
              onClick={onTranslateLyrics}
              title="为当前歌词生成诗意双语翻译"
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 border border-white/12 text-[11px] font-medium text-white flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {isTranslating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-rose-300" />
              )}
              <span>{isTranslating ? '译制中' : '诗意翻译'}</span>
            </button>
          )}

          {onOpenSearchOnline && (
            <button
              type="button"
              onClick={onOpenSearchOnline}
              title="在线匹配歌词"
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {onImportLrcFile && (
            <>
              <input
                ref={lrcFileInputRef}
                type="file"
                accept=".lrc,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportLrcFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => lrcFileInputRef.current?.click()}
                title="导入 .lrc 歌词文件"
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <FileUp className="w-4 h-4" />
              </button>
            </>
          )}

          {onOpenEditor && (
            <button
              type="button"
              onClick={onOpenEditor}
              title="编辑歌词与时间轴"
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <PencilLine className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {parsed.lines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/8 border border-white/12 flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-white/60" />
          </div>
          <div className="space-y-1 max-w-xs">
            <p className="text-sm font-medium text-white/90">当前曲目尚未匹配歌词</p>
            <p className="text-xs text-white/55 leading-relaxed">
              支持自动在线搜索 LRC 时间轴歌词、导入本地 .lrc 文件或手动编辑歌词。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {onOpenSearchOnline && (
              <button
                type="button"
                onClick={onOpenSearchOnline}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white transition-transform active:scale-95 flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
                style={{
                  background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
                }}
              >
                <Search className="w-3.5 h-3.5" />
                搜索匹配歌词
              </button>
            )}
            {onImportLrcFile && (
              <button
                type="button"
                onClick={() => lrcFileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/15 border border-white/15 text-white/90 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <FileUp className="w-3.5 h-3.5" />
                导入 .lrc 文件
              </button>
            )}
            {onOpenEditor && (
              <button
                type="button"
                onClick={onOpenEditor}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-white/8 hover:bg-white/12 border border-white/10 text-white/80 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <PencilLine className="w-3.5 h-3.5" />
                手动输入
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Scrollable synced lyrics list */
        <div
          ref={containerRef}
          onWheel={handleManualScroll}
          onTouchStart={handleManualScroll}
          className={`flex-1 overflow-y-auto lumina-scroll pr-2 relative ${
            immersive
              ? 'py-14 space-y-5 sm:space-y-6'
              : 'py-8 space-y-4 sm:space-y-5'
          }`}
          style={{
            maskImage: immersive
              ? 'linear-gradient(to bottom, transparent 0%, black 15%, black 83%, transparent 100%)'
              : 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
            WebkitMaskImage: immersive
              ? 'linear-gradient(to bottom, transparent 0%, black 15%, black 83%, transparent 100%)'
              : 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          }}
        >
          {parsed.lines.map((line, idx) => {
            const isActive = idx === activeIdx;
            const isPast = activeIdx >= 0 && idx < activeIdx;
            const distance = activeIdx >= 0 ? Math.abs(idx - activeIdx) : 0;

            let opacityClass = 'opacity-65 hover:opacity-90';
            if (parsed.hasSyncedTimestamps && activeIdx >= 0) {
              if (isActive) opacityClass = 'opacity-100';
              else if (isPast) {
                opacityClass =
                  distance === 1
                    ? immersive
                      ? 'opacity-48 hover:opacity-85'
                      : 'opacity-42'
                    : immersive
                    ? 'opacity-24 blur-[0.45px] hover:opacity-75 hover:blur-none'
                    : 'opacity-28';
              } else {
                opacityClass =
                  distance === 1
                    ? immersive
                      ? 'opacity-68 hover:opacity-95'
                      : 'opacity-62'
                    : distance === 2
                    ? immersive
                      ? 'opacity-40 hover:opacity-80'
                      : 'opacity-44'
                    : immersive
                    ? 'opacity-22 blur-[0.55px] hover:opacity-75 hover:blur-none'
                    : 'opacity-30';
              }
            }

            return (
              <button
                key={line.id}
                type="button"
                ref={(el) => {
                  if (el) lineRefs.current.set(idx, el);
                  else lineRefs.current.delete(idx);
                }}
                onClick={() => {
                  if (line.time >= 0) {
                    onSeek(Math.max(0, line.time - offsetMs / 1000));
                    setUserScrolling(false);
                  }
                }}
                className={`w-full text-left rounded-2xl transition-all duration-300 ease-out block cursor-pointer ${
                  immersive ? 'px-4 py-2.5' : 'px-3 py-2'
                } ${opacityClass} ${
                  isActive
                    ? immersive
                      ? ''
                      : 'bg-white/[0.06] backdrop-blur-sm'
                    : 'hover:bg-white/[0.03]'
                }`}
                style={
                  isActive && immersive
                    ? {
                        background: `radial-gradient(ellipse at 18% 50%, ${palette.primary}1e 0%, rgba(255,255,255,0.035) 55%, transparent 100%)`,
                      }
                    : undefined
                }
              >
                <p
                  className={`font-display leading-snug transition-all duration-300 origin-left ${
                    isActive
                      ? immersive
                        ? 'text-2xl sm:text-3xl xl:text-[34px] font-semibold tracking-tight text-white scale-[1.02]'
                        : compact
                        ? 'text-xl sm:text-2xl font-semibold text-white scale-[1.02]'
                        : 'text-2xl sm:text-3xl font-semibold text-white scale-[1.02]'
                      : immersive
                      ? 'text-lg sm:text-xl xl:text-[21px] font-medium text-white/85'
                      : compact
                      ? 'text-base sm:text-lg font-medium text-white/85'
                      : 'text-lg sm:text-xl font-medium text-white/85'
                  }`}
                  style={
                    isActive
                      ? {
                          textShadow: immersive
                            ? `0 0 28px ${palette.primary}bf, 0 4px 18px rgba(0,0,0,0.55)`
                            : `0 0 22px ${palette.primary}aa, 0 2px 10px rgba(0,0,0,0.45)`,
                        }
                      : undefined
                  }
                >
                  {renderLineText(line, isActive)}
                </p>

                {showBilingual && line.translation && (
                  <p
                    className={`transition-all duration-300 ${
                      isActive
                        ? immersive
                          ? 'mt-2 text-base sm:text-[17px] text-rose-50/82 font-light tracking-wide'
                          : 'mt-1 text-sm sm:text-base text-white/85 font-normal'
                        : immersive
                        ? 'mt-1 text-sm text-white/48 font-light'
                        : 'mt-1 text-xs sm:text-sm text-white/55'
                    }`}
                  >
                    {line.translation}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
