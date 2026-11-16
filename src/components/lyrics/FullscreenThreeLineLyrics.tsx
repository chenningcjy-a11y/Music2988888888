import React, { useMemo } from 'react';
import { LyricLine } from '../../types/music';
import { findActiveLyricIndex, parseLrc } from '../../utils/lrcParser';

interface FullscreenThreeLineLyricsProps {
  lyricsRaw?: string;
  currentTime: number;
  offsetMs?: number;
}

interface LyricSlotProps {
  line: LyricLine | null;
  role: 'prev' | 'current' | 'next';
  introWaiting?: boolean;
}

const LyricSlot: React.FC<LyricSlotProps> = ({ line, role, introWaiting }) => {
  if (!line) {
    return (
      <div
        aria-hidden={!introWaiting}
        className="min-h-[68px] sm:min-h-[76px] flex flex-col items-start justify-center"
      >
        {introWaiting && role === 'current' && (
          <span className="font-display text-xl tracking-[0.38em] text-white/35">
            ···
          </span>
        )}
      </div>
    );
  }

  const isCurrent = role === 'current';

  return (
    <div
      className={`min-h-[68px] sm:min-h-[76px] flex flex-col justify-center transition-all duration-300 ease-out ${
        isCurrent
          ? 'opacity-100 scale-100'
          : role === 'prev'
          ? 'opacity-38 scale-[0.97] origin-left'
          : 'opacity-44 scale-[0.97] origin-left'
      }`}
    >
      <p
        className={`font-display leading-[1.35] tracking-[-0.01em] break-words transition-colors duration-500 ${
          isCurrent
            ? 'text-2xl sm:text-[28px] lg:text-[34px] font-semibold text-white'
            : 'text-base sm:text-lg lg:text-xl font-normal text-white/85'
        }`}
        style={{
          textShadow: isCurrent
            ? '0 0 28px rgba(var(--fs-primary-rgb, 232, 67, 127), 0.55), 0 2px 14px rgba(0, 0, 0, 0.85)'
            : '0 2px 12px rgba(0, 0, 0, 0.8)',
        }}
      >
        {line.text}
      </p>

      {line.translation && (
        <p
          className={`mt-1.5 leading-relaxed break-words transition-colors duration-500 ${
            isCurrent
              ? 'text-sm sm:text-base lg:text-lg font-normal text-white/85'
              : 'text-xs sm:text-sm lg:text-[15px] font-light text-white/70'
          }`}
          style={{ textShadow: '0 2px 10px rgba(0, 0, 0, 0.8)' }}
        >
          {line.translation}
        </p>
      )}
    </div>
  );
};

export const FullscreenThreeLineLyrics: React.FC<FullscreenThreeLineLyricsProps> = ({
  lyricsRaw,
  currentTime,
  offsetMs = 0,
}) => {
  const parsed = useMemo(() => parseLrc(lyricsRaw), [lyricsRaw]);

  const activeIdx = useMemo(() => {
    if (!parsed.lines.length) return -1;
    if (!parsed.hasSyncedTimestamps) return 0;
    return findActiveLyricIndex(parsed.lines, currentTime, offsetMs);
  }, [parsed.lines, parsed.hasSyncedTimestamps, currentTime, offsetMs]);

  if (parsed.lines.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-start md:justify-center">
        <p className="font-display text-lg sm:text-xl text-white/40 tracking-wide">
          暂无歌词
        </p>
      </div>
    );
  }

  const isIntroWaiting = parsed.hasSyncedTimestamps && activeIdx < 0;

  const prevLine: LyricLine | null =
    !isIntroWaiting && activeIdx > 0 ? parsed.lines[activeIdx - 1] : null;
  const currentLine: LyricLine | null =
    !isIntroWaiting && activeIdx >= 0 ? parsed.lines[activeIdx] : null;
  const nextLine: LyricLine | null = isIntroWaiting
    ? parsed.lines[0] || null
    : activeIdx + 1 < parsed.lines.length
    ? parsed.lines[activeIdx + 1]
    : null;

  return (
    <div
      className="w-full h-full flex flex-col justify-center select-none overflow-hidden"
      aria-live="polite"
    >
      <div
        key={`lyric-window-${activeIdx}`}
        className="w-full max-w-xl mx-auto flex flex-col justify-center gap-6 sm:gap-8 animate-[luminaLyricSlide_360ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        <LyricSlot line={prevLine} role="prev" />
        <LyricSlot line={currentLine} role="current" introWaiting={isIntroWaiting} />
        <LyricSlot line={nextLine} role="next" />
      </div>
    </div>
  );
};
