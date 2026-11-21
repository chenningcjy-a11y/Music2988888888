import React, { useEffect, useRef, useState } from 'react';
import { AudioWaveform } from 'lucide-react';
import { MvMidBreakRange, TrackColorPalette, TrackMvTimelineConfig } from '../../types/music';
import { formatTime } from '../../utils/constants';
import { extractMvAudioWaveform, MvWaveformResult } from '../../utils/mvAudioWaveform';

interface MvAudioWaveformBarProps {
  mvId: string;
  sourceType: 'local' | 'url';
  externalUrl?: string;
  durationSec: number;
  currentTime: number;
  timeline: TrackMvTimelineConfig;
  palette: TrackColorPalette;
  alignMarkerTime?: number | null;
  aiSuggestedMarkers?: {
    introEndSec?: number;
    midBreaks?: { mvStartSec: number; mvEndSec: number }[];
    outroStartSec?: number;
    outroEndSec?: number;
  } | null;
  onScrubStart?: () => void;
  onScrubMove: (timeSec: number) => void;
  onScrubCommit: (timeSec: number) => void;
}

export const MvAudioWaveformBar: React.FC<MvAudioWaveformBarProps> = ({
  mvId,
  sourceType,
  externalUrl,
  durationSec,
  currentTime,
  timeline,
  palette,
  alignMarkerTime = null,
  aiSuggestedMarkers = null,
  onScrubStart,
  onScrubMove,
  onScrubCommit,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [waveform, setWaveform] = useState<MvWaveformResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    extractMvAudioWaveform({
      mvId,
      sourceType,
      externalUrl,
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
  }, [mvId, sourceType, externalUrl]);

  // Draw waveform + timeline phase regions + playhead on canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(200, Math.round(rect.width));
      const height = Math.max(64, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const safeDur = Math.max(0.1, durationSec || waveform?.durationSec || 1);
      const timeToX = (t: number) =>
        Math.max(0, Math.min(width, (t / safeDur) * width));

      // 1. Highlight configured Intro region
      if (timeline.introEnabled && (timeline.introEndSec || 0) > 0) {
        const endX = timeToX(timeline.introEndSec);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(0, 0, endX, height);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.78)';
        ctx.fillRect(Math.max(0, endX - 1), 0, 2, height);
      }

      // 2. Highlight configured Mid-Breaks
      const breaks: MvMidBreakRange[] = timeline.midBreaks || [];
      for (const brk of breaks) {
        if (brk.mvEndSec > brk.mvStartSec) {
          const sx = timeToX(brk.mvStartSec);
          const ex = timeToX(brk.mvEndSec);
          ctx.fillStyle = 'rgba(168, 85, 247, 0.18)';
          ctx.fillRect(sx, 0, Math.max(2, ex - sx), height);
          ctx.fillStyle = 'rgba(192, 132, 252, 0.75)';
          ctx.fillRect(sx, 0, 1.5, height);
          ctx.fillRect(Math.max(0, ex - 1.5), 0, 1.5, height);
        }
      }

      // 3. Highlight Outro end marker if configured
      if (timeline.outroEnabled && timeline.outroEndSec && timeline.outroEndSec > 0) {
        const ox = timeToX(timeline.outroEndSec);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.75)';
        ctx.fillRect(Math.max(0, ox - 1), 0, 2, height);
      }

      // Center baseline
      const midY = height / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      // 4. Amplitude bars
      const peaks = waveform?.peaks || [];
      const playX = timeToX(currentTime);

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
            ctx.fillStyle = amp > 0.55 ? palette.primary : palette.secondary;
            ctx.globalAlpha = 0.55 + amp * 0.45;
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.16 + amp * 0.36;
          }

          ctx.fillRect(x, midY - halfH, barW, halfH * 2);
        }
        ctx.globalAlpha = 1;
      }

      // 5. Optional mapped music alignment crosshair line
      if (
        alignMarkerTime !== null &&
        Number.isFinite(alignMarkerTime) &&
        alignMarkerTime >= 0 &&
        alignMarkerTime <= safeDur
      ) {
        const mx = timeToX(alignMarkerTime);
        ctx.save();
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, height);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Optional AI suggested markers (awaiting user confirmation)
      if (aiSuggestedMarkers) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        if (
          typeof aiSuggestedMarkers.introEndSec === 'number' &&
          aiSuggestedMarkers.introEndSec > 0
        ) {
          const ax = timeToX(aiSuggestedMarkers.introEndSec);
          ctx.strokeStyle = '#38bdf8';
          ctx.beginPath();
          ctx.moveTo(ax, 0);
          ctx.lineTo(ax, height);
          ctx.stroke();
        }
        if (Array.isArray(aiSuggestedMarkers.midBreaks)) {
          for (const brk of aiSuggestedMarkers.midBreaks) {
            if (brk.mvEndSec > brk.mvStartSec) {
              const bsx = timeToX(brk.mvStartSec);
              const bex = timeToX(brk.mvEndSec);
              ctx.fillStyle = 'rgba(192, 132, 252, 0.14)';
              ctx.fillRect(bsx, 0, Math.max(2, bex - bsx), height);
              ctx.strokeStyle = '#c084fc';
              ctx.beginPath();
              ctx.moveTo(bsx, 0);
              ctx.lineTo(bsx, height);
              ctx.moveTo(bex, 0);
              ctx.lineTo(bex, height);
              ctx.stroke();
            }
          }
        }
        if (
          typeof aiSuggestedMarkers.outroStartSec === 'number' &&
          aiSuggestedMarkers.outroStartSec >= 0 &&
          aiSuggestedMarkers.outroStartSec < safeDur
        ) {
          const sx = timeToX(aiSuggestedMarkers.outroStartSec);
          ctx.strokeStyle = '#fbbf24';
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, height);
          ctx.stroke();
        }
        if (
          typeof aiSuggestedMarkers.outroEndSec === 'number' &&
          aiSuggestedMarkers.outroEndSec > 0
        ) {
          const ex = timeToX(aiSuggestedMarkers.outroEndSec);
          ctx.strokeStyle = '#f59e0b';
          ctx.beginPath();
          ctx.moveTo(ex, 0);
          ctx.lineTo(ex, height);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. Playhead vertical needle
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.max(0, playX - 1), 0, 2, height);
      ctx.beginPath();
      ctx.arc(playX, 6, 3.5, 0, Math.PI * 2);
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
    durationSec,
    currentTime,
    timeline,
    palette,
    alignMarkerTime,
    aiSuggestedMarkers,
  ]);

  const clientXToTime = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const safeDur = Math.max(1, durationSec || waveform?.durationSec || 1);
    return ratio * safeDur;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-white/65">
        <span className="flex items-center gap-1.5 font-medium text-white/80">
          <AudioWaveform className="w-3.5 h-3.5" style={{ color: palette.primary }} />
          <span>MV 原声音频图谱（点击或拖动波形快速定位声音起止）</span>
        </span>
        <span className="font-mono-tabular text-white/75">
          {loading
            ? '正在提取音轨图谱...'
            : waveform?.error
            ? waveform.error
            : `当前 ${formatTime(currentTime)}`}
        </span>
      </div>

      <div
        ref={containerRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          onScrubStart?.();
          onScrubMove(clientXToTime(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          onScrubMove(clientXToTime(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          onScrubCommit(clientXToTime(e.clientX));
        }}
        onPointerCancel={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          onScrubCommit(clientXToTime(e.clientX));
        }}
        style={{ touchAction: 'none' }}
        className="relative h-[74px] w-full rounded-xl bg-black/55 border border-white/12 overflow-hidden cursor-ew-resize select-none"
      >
        <canvas ref={canvasRef} className="w-full h-full block pointer-events-none" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-xs text-white/75 pointer-events-none">
            正在解析 MV 音频波形图谱...
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-white/50">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-sky-400/75" />
          前瞻段
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-purple-400/75" />
          中段剧情
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-400/75" />
          后段终点
        </span>
        <span className="text-white/45">· 波峰越高代表音量越大</span>
      </div>
    </div>
  );
};
