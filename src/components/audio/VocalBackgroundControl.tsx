import React from 'react';
import { Mic2, Music2, RotateCcw } from 'lucide-react';
import { TrackColorPalette } from '../../types/music';

interface VocalBackgroundControlProps {
  balance: number; // -100 .. 0 .. +100
  palette: TrackColorPalette;
  onChange: (value: number) => void;
  compact?: boolean;
}

export const VocalBackgroundControl: React.FC<VocalBackgroundControlProps> = ({
  balance,
  palette,
  onChange,
  compact = false,
}) => {
  const clamped = Math.max(-100, Math.min(100, Math.round(balance)));
  // Center (0): Vocal 100%, Background 100%
  // Slide left (0 -> -100): Vocal 100 -> 0%, Background stays 100%
  // Slide right (0 -> +100): Background 100 -> 0%, Vocal stays 100%
  const vocalPct = clamped < 0 ? 100 + clamped : 100;
  const bgPct = clamped > 0 ? 100 - clamped : 100;

  const fillLeftPct = clamped < 0 ? 50 - (Math.abs(clamped) / 100) * 50 : 50;
  const fillWidthPct = (Math.abs(clamped) / 100) * 50;

  return (
    <div className="space-y-3.5">
      {/* Live Dual Readout */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Mic2
              className="w-4 h-4 shrink-0"
              style={{
                color: clamped < 0 ? 'rgba(255,255,255,0.4)' : palette.primary,
              }}
            />
            <span className="text-xs text-white/80 truncate">人声 (Vocal)</span>
          </div>
          <span className="font-mono-tabular text-sm font-semibold text-white">
            {vocalPct}%
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Music2
              className="w-4 h-4 shrink-0"
              style={{
                color: clamped > 0 ? 'rgba(255,255,255,0.4)' : palette.secondary,
              }}
            />
            <span className="text-xs text-white/80 truncate">背景音 / 环境</span>
          </div>
          <span className="font-mono-tabular text-sm font-semibold text-white">
            {bgPct}%
          </span>
        </div>
      </div>

      {/* Bidirectional Slider (-100 <- 0 -> +100) */}
      <div className="space-y-1.5">
        <div className="relative h-7 flex items-center">
          {/* Base track */}
          <div className="absolute inset-x-0 h-2 rounded-full bg-white/10 pointer-events-none" />
          {/* Center detent tick */}
          <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-3.5 bg-white/40 rounded-full pointer-events-none z-0" />
          {/* Active center-outward bar */}
          <div
            className="absolute h-2 rounded-full pointer-events-none transition-all duration-75"
            style={{
              left: `${fillLeftPct}%`,
              width: `${fillWidthPct}%`,
              background:
                clamped < 0
                  ? `linear-gradient(90deg, ${palette.secondary}, rgba(255,255,255,0.45))`
                  : `linear-gradient(90deg, rgba(255,255,255,0.45), ${palette.primary})`,
            }}
          />
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={clamped}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="人声与背景音平衡滑块"
            className="lumina-range w-full relative z-10"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-white/55">
          <span>← 减弱人声 (100→0)</span>
          <button
            type="button"
            onClick={() => onChange(0)}
            className="text-white/75 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {clamped !== 0 && <RotateCcw className="w-3 h-3" />}
            <span>中心原声</span>
          </button>
          <span>减弱背景音 (100→0) →</span>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onChange(-100)}
          className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer truncate ${
            clamped <= -85
              ? 'bg-white/16 border-white/30 text-white'
              : 'bg-white/[0.04] border-white/10 text-white/70 hover:text-white'
          }`}
        >
          {compact ? '纯伴奏' : '纯背景音 (人声 0%)'}
        </button>

        <button
          type="button"
          onClick={() => onChange(0)}
          className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer truncate ${
            clamped === 0
              ? 'bg-white/16 border-white/30 text-white'
              : 'bg-white/[0.04] border-white/10 text-white/70 hover:text-white'
          }`}
        >
          {compact ? '原声均衡' : '原声均衡 (100%)'}
        </button>

        <button
          type="button"
          onClick={() => onChange(100)}
          className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer truncate ${
            clamped >= 85
              ? 'bg-white/16 border-white/30 text-white'
              : 'bg-white/[0.04] border-white/10 text-white/70 hover:text-white'
          }`}
        >
          {compact ? '纯人声' : '纯人声 (背景 0%)'}
        </button>
      </div>
    </div>
  );
};
