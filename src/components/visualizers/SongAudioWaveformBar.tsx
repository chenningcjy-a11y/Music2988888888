import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Music2, Pause, Play, Sparkles } from 'lucide-react';
import {
  MvMidBreakRange,
  TrackColorPalette,
  TrackMvTimelineConfig,
} from '../../types/music';
import { formatTime } from '../../utils/constants';
import {
  extractTrackAudioWaveform,
  MvWaveformResult,
} from '../../utils/mvAudioWaveform';

interface SongAudioWaveformBarProps {
  trackId: string;
  trackTitle: string;
  durationSec: number;
  currentTime: number;
  isPlaying: boolean;
  timeline: TrackMvTimelineConfig;
  palette: TrackColorPalette;
  guideTime: number;
  mvPreviewTime: number;
  onSeekAudio: (timeSec: number) => void;
  onGuideChange: (timeSec: number) => void;
  onPlayFromGuide: (timeSec: number) => void;
  onTogglePlay: () => void;
  onAlignToMvFrame?: (guideTimeSec: number) => void;
}

export const SongAudioWaveformBar: React.FC<SongAudioWaveformBarProps> = ({
  trackId,
  trackTitle,
  durationSec,
  currentTime,
  isPlaying,
  timeline,
  palette,
  guideTime,
  mvPreviewTime,
  onSeekAudio,
  onGuideChange,
  onPlayFromGuide,
  onTogglePlay,
  onAlignToMvFrame,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [waveform, setWaveform] = useState<MvWaveformResult | null>(null);
  const [waveformDragMode, setWaveformDragMode] = useState<'audio' | 'guide'>(
    'audio'
  );
  const [scrubAudioTime, setScrubAudioTime] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScrubAudioTime(null);
    extractTrackAudioWaveform({
      trackId,
      buckets: 260,
    }).then((res) => {
      if (!cancelled) {
        setWaveform(res);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const effectiveDuration = Math.max(
    1,
    durationSec || waveform?.durationSec || 1
  );
  const displayedAudioTime = Math.max(
    0,
    Math.min(effectiveDuration, scrubAudioTime ?? currentTime)
  );
  const audioPct = Math.min(
    100,
    Math.max(0, (displayedAudioTime / effectiveDuration) * 100)
  );
  const clampedGuide = Math.max(0, Math.min(effectiveDuration, guideTime));
  const guidePct = Math.min(
    100,
    Math.max(0, (clampedGuide / effectiveDuration) * 100)
  );

  // Draw music track amplitude waveform + mid-break trigger markers + live playhead + alignment guide bar
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(200, Math.round(rect.width));
      const height = Math.max(68, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const safeDur = Math.max(0.1, effectiveDuration);
      const timeToX = (t: number) =>
        Math.max(0, Math.min(width, (t / safeDur) * width));

      // 1. Mid-break audio trigger vertical markers
      const breaks: MvMidBreakRange[] = timeline.midBreaks || [];
      for (const brk of breaks) {
        if (brk.audioTriggerSec >= 0 && brk.audioTriggerSec <= safeDur) {
          const bx = timeToX(brk.audioTriggerSec);
          ctx.fillStyle = 'rgba(192, 132, 252, 0.72)';
          ctx.fillRect(Math.max(0, bx - 1), 0, 2, height);
        }
      }

      // Center axis
      const midY = height / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      // 2. Music amplitude bars
      const peaks = waveform?.peaks || [];
      const playX = timeToX(displayedAudioTime);
      const guideX = timeToX(clampedGuide);

      if (peaks.length > 0) {
        const count = peaks.length;
        const step = width / count;
        const barW = Math.max(1.2, step * 0.68);
        const maxHalfH = height * 0.44;

        for (let i = 0; i < count; i++) {
          const amp = peaks[i];
          const x = i * step + (step - barW) / 2;
          const halfH = Math.max(1.5, amp * maxHalfH);
          const isPlayed = x <= playX;

          if (isPlayed) {
            ctx.fillStyle = amp > 0.55 ? palette.secondary : palette.primary;
            ctx.globalAlpha = 0.52 + amp * 0.45;
          } else {
            ctx.fillStyle = '#e2e8f0';
            ctx.globalAlpha = 0.18 + amp * 0.42;
          }

          ctx.fillRect(x, midY - halfH, barW, halfH * 2);
        }
        ctx.globalAlpha = 1;
      }

      // 3. Draggable Alignment Guide Bar (bright emerald crosshair line + handle cap)
      ctx.fillStyle = '#34d399';
      ctx.fillRect(Math.max(0, guideX - 1), 0, 2, height);
      ctx.beginPath();
      ctx.arc(guideX, 7, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
      ctx.strokeStyle = '#064e3b';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 4. Live Music Playhead (white vertical line + dot)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(Math.max(0, playX - 1), 0, 2.2, height);
      ctx.beginPath();
      ctx.arc(playX, height - 6, 3.8, 0, Math.PI * 2);
      ctx.fillStyle = palette.primary;
      ctx.fill();

      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [
    waveform,
    effectiveDuration,
    displayedAudioTime,
    clampedGuide,
    timeline,
    palette,
  ]);

  const clientXToTime = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))
    );
    return ratio * effectiveDuration;
  };

  return (
    <div className="pt-3 border-t border-white/10 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/70">
        <span className="flex items-center gap-1.5 font-semibold text-white/85 min-w-0">
          <Music2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">音乐音频读谱 · {trackTitle}</span>
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded-lg bg-black/45 border border-white/12 p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setWaveformDragMode('audio')}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                waveformDragMode === 'audio'
                  ? 'bg-white/18 text-white font-medium'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              拖波形调音频
            </button>
            <button
              type="button"
              onClick={() => setWaveformDragMode('guide')}
              className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                waveformDragMode === 'guide'
                  ? 'bg-emerald-500/30 text-emerald-100 font-medium'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              拖波形调辅助条
            </button>
          </div>
          <span className="font-mono-tabular text-white/75">
            {loading
              ? '读谱中...'
              : waveform?.error
              ? waveform.error
              : `${formatTime(displayedAudioTime)} / ${formatTime(effectiveDuration)}`}
          </span>
        </div>
      </div>

      {/* Music Audio Score / Waveform Canvas */}
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          const t = clientXToTime(e.clientX);
          if (waveformDragMode === 'audio') {
            setScrubAudioTime(t);
            onSeekAudio(t);
          } else {
            onGuideChange(t);
          }
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const t = clientXToTime(e.clientX);
          if (waveformDragMode === 'audio') {
            setScrubAudioTime(t);
            onSeekAudio(t);
          } else {
            onGuideChange(t);
          }
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          const t = clientXToTime(e.clientX);
          if (waveformDragMode === 'audio') {
            setScrubAudioTime(null);
            onSeekAudio(t);
          } else {
            onGuideChange(t);
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setScrubAudioTime(null);
        }}
        style={{ touchAction: 'none' }}
        className="relative h-[74px] w-full rounded-xl bg-black/60 border border-white/12 overflow-hidden cursor-ew-resize select-none"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full block pointer-events-none"
        />

        {/* Guide marker timestamp floating tag */}
        <div
          className="pointer-events-none absolute top-1.5 px-1.5 py-0.5 rounded bg-emerald-500/85 text-[10px] font-mono-tabular font-semibold text-black shadow"
          style={{
            left: `clamp(6px, calc(${guidePct}% - 26px), calc(100% - 62px))`,
          }}
        >
          辅助 {clampedGuide.toFixed(1)}s
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white/75 pointer-events-none">
            正在解码音乐音频读谱...
          </div>
        )}
      </div>

      {/* Real Song Audio Position Scrubber Bar (可直接拖动调节音乐当前播放位置) */}
      <div className="rounded-xl bg-white/[0.04] border border-white/12 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-white/85">
            音频播放位置（拖动滑块自由调节音乐进度）
          </span>
          <span className="font-mono-tabular text-white/80">
            {displayedAudioTime.toFixed(1)}s ({formatTime(displayedAudioTime)})
          </span>
        </div>

        <div className="relative flex items-center h-6">
          <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
          <div
            className="absolute left-0 h-1.5 rounded-full pointer-events-none"
            style={{
              width: `${audioPct}%`,
              background: `linear-gradient(90deg, ${palette.primary}, ${palette.secondary})`,
            }}
          />
          <input
            type="range"
            min={0}
            max={effectiveDuration}
            step={0.1}
            value={displayedAudioTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setScrubAudioTime(val);
              onSeekAudio(val);
            }}
            onPointerUp={(e) => {
              onSeekAudio(parseFloat(e.currentTarget.value));
              setScrubAudioTime(null);
            }}
            onTouchEnd={(e) => {
              onSeekAudio(parseFloat(e.currentTarget.value));
              setScrubAudioTime(null);
            }}
            onBlur={() => setScrubAudioTime(null)}
            aria-label="音频播放位置进度条"
            className="lumina-range w-full relative z-10"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            {[-5, -1, 1, 5].map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() =>
                  onSeekAudio(
                    Math.max(0, Math.min(effectiveDuration, displayedAudioTime + delta))
                  )
                }
                className="min-h-[30px] px-2 rounded-lg bg-black/35 hover:bg-white/15 border border-white/10 text-[11px] font-mono-tabular text-white/85 cursor-pointer"
              >
                {delta > 0 ? `+${delta}s` : `${delta}s`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onTogglePlay}
            className="min-h-[32px] px-3 rounded-lg bg-white/12 hover:bg-white/20 border border-white/15 text-[11px] font-medium text-white flex items-center gap-1.5 cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>暂停音乐</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>播放音乐</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Dedicated Alignment Guide Bar (辅助条) */}
      <div className="rounded-xl bg-emerald-500/[0.07] border border-emerald-400/20 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-emerald-200">
            <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
            <span>对齐辅助条（绿色标尺定位对准点）</span>
          </span>
          <span className="font-mono-tabular font-semibold text-emerald-300">
            {clampedGuide.toFixed(2)}s ({formatTime(clampedGuide)})
          </span>
        </div>

        <div className="relative flex items-center h-6">
          <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/12 pointer-events-none" />
          <div
            className="absolute left-0 h-1.5 rounded-full pointer-events-none bg-gradient-to-r from-emerald-500 to-teal-300"
            style={{ width: `${guidePct}%` }}
          />
          <input
            type="range"
            min={0}
            max={effectiveDuration}
            step={0.05}
            value={clampedGuide}
            onChange={(e) => onGuideChange(parseFloat(e.target.value))}
            aria-label="音乐对齐辅助条"
            className="lumina-range w-full relative z-10"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            {[-1, -0.1, 0.1, 1].map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() =>
                  onGuideChange(
                    Math.max(0, Math.min(effectiveDuration, clampedGuide + delta))
                  )
                }
                className="min-h-[30px] px-2 rounded-lg bg-black/35 hover:bg-white/12 border border-white/10 text-[11px] font-mono-tabular text-white/85 cursor-pointer"
              >
                {delta > 0 ? `+${delta}s` : `${delta}s`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onGuideChange(displayedAudioTime)}
              className="min-h-[30px] px-2 rounded-lg bg-black/35 hover:bg-white/12 border border-white/10 text-[11px] text-emerald-200 cursor-pointer"
            >
              吸到播放点
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPlayFromGuide(clampedGuide)}
              className="min-h-[32px] px-2.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/38 border border-emerald-400/35 text-[11px] font-medium text-emerald-100 flex items-center gap-1 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>从辅助位置播放</span>
            </button>

            {onAlignToMvFrame && (
              <button
                type="button"
                onClick={() => onAlignToMvFrame(clampedGuide)}
                title="计算并对齐前瞻终点，使音乐播放到此辅助位置时与当前预览 MV 帧完全同步"
                className="min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium text-white flex items-center gap-1 cursor-pointer"
                style={{ backgroundColor: palette.primary }}
              >
                <Sparkles className="w-3 h-3" />
                <span>对齐 MV 当前帧 ({mvPreviewTime.toFixed(1)}s)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

