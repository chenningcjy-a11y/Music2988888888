import React, { useEffect, useRef, useState } from 'react';
import { Disc3, ImagePlus } from 'lucide-react';
import { audioEngine } from '../../audio/AudioEngine';
import { AnimationIntensity, TrackColorPalette } from '../../types/music';

interface AlbumVinylStageProps {
  coverUrl?: string;
  title: string;
  trackId?: string;
  isPlaying: boolean;
  palette: TrackColorPalette;
  animationIntensity: AnimationIntensity;
  onChangeCover?: (file: File) => void;
  compact?: boolean;
  fullscreen?: boolean;
}

export const AlbumVinylStage: React.FC<AlbumVinylStageProps> = ({
  coverUrl,
  title,
  trackId,
  isPlaying,
  palette,
  animationIntensity,
  onChangeCover,
  compact = false,
  fullscreen = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const discRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Smooth fade when switching tracks
  const [displayedCover, setDisplayedCover] = useState<string | undefined>(coverUrl);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (coverUrl === displayedCover) return;
    setFading(true);
    const t = window.setTimeout(() => {
      setDisplayedCover(coverUrl);
      setFading(false);
    }, 180);
    return () => window.clearTimeout(t);
  }, [coverUrl, displayedCover, trackId]);

  const propsRef = useRef({
    isPlaying,
    palette,
    animationIntensity,
  });
  propsRef.current = { isPlaying, palette, animationIntensity };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let rotationDeg = 0;
    let angularVelocity = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothHigh = 0;
    let smoothVol = 0;
    let timeAcc = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = () => {
      const { isPlaying: playing, palette: pal, animationIntensity: intensity } =
        propsRef.current;

      // Smooth rotational inertia for vinyl record
      const targetVel = playing ? 0.36 : 0; // ~21.6 deg/sec at 60fps
      angularVelocity += (targetVel - angularVelocity) * (playing ? 0.045 : 0.025);
      if (Math.abs(angularVelocity) > 0.0005) {
        rotationDeg = (rotationDeg + angularVelocity) % 360;
        if (discRef.current) {
          discRef.current.style.transform = `rotate(${rotationDeg.toFixed(3)}deg)`;
        }
      }

      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.clearRect(0, 0, w, h);

      // Real-time Web Audio API analysis
      const frame = audioEngine.getAnalysisFrame();
      const targetBass = playing ? frame.bass : 0;
      const targetMid = playing ? frame.mid : 0;
      const targetHigh = playing ? frame.high : 0;
      const targetVol = playing ? frame.volume : 0;

      // Smooth decay when paused/quiet
      smoothBass += (targetBass - smoothBass) * (playing ? 0.24 : 0.06);
      smoothMid += (targetMid - smoothMid) * (playing ? 0.2 : 0.06);
      smoothHigh += (targetHigh - smoothHigh) * (playing ? 0.28 : 0.07);
      smoothVol += (targetVol - smoothVol) * (playing ? 0.22 : 0.05);

      timeAcc += 0.016 + smoothMid * 0.028;

      const cx = w / 2;
      const cy = h / 2;
      // Vinyl disc occupies ~65% of stage width
      const discRadius = Math.min(w, h) * 0.325;
      const [r1, g1, b1] = pal.rgbPrimary;
      const [r2, g2, b2] = pal.rgbSecondary;

      // 1. Multi-layer dynamic aura rings driven by bass & volume
      const auraScale = intensity === 'low' ? 0.6 : intensity === 'high' ? 1.25 : 1.0;
      const pulseRadius = discRadius * (1.06 + smoothBass * 0.22 * auraScale);

      const radialGlow = ctx.createRadialGradient(
        cx,
        cy,
        discRadius * 0.85,
        cx,
        cy,
        discRadius * (1.58 + smoothVol * 0.3 * auraScale)
      );
      radialGlow.addColorStop(0, `rgba(${r1}, ${g1}, ${b1}, ${0.14 + smoothBass * 0.34})`);
      radialGlow.addColorStop(0.55, `rgba(${r2}, ${g2}, ${b2}, ${0.07 + smoothMid * 0.18})`);
      radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, discRadius * 1.9, 0, Math.PI * 2);
      ctx.fill();

      // Inner & outer pulsing orbital light rings
      for (let ring = 0; ring < 2; ring++) {
        const ringRad =
          pulseRadius + ring * (12 * dpr) + (ring === 0 ? smoothBass : smoothMid) * 10 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRad, 0, Math.PI * 2);
        const alpha =
          (ring === 0 ? 0.24 + smoothBass * 0.45 : 0.14 + smoothMid * 0.3) *
          (playing ? 1 : 0.45);
        ctx.strokeStyle =
          ring === 0
            ? `rgba(${r1}, ${g1}, ${b1}, ${alpha})`
            : `rgba(${r2}, ${g2}, ${b2}, ${alpha})`;
        ctx.lineWidth = (ring === 0 ? 1.8 : 1.1) * dpr;
        ctx.stroke();
      }

      // 2. Fine circular frequency contour around vinyl perimeter
      const arcBins = 72;
      const freqs = frame.frequencies;
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= arcBins; i++) {
        const idx = i % arcBins;
        const angle = (idx / arcBins) * Math.PI * 2 - Math.PI / 2 + timeAcc * 0.12;
        const binIdx = Math.floor((idx / arcBins) * 140);
        const mag = playing ? (freqs[binIdx] || 0) / 255 : 0;
        const r =
          discRadius * 1.045 +
          mag * (18 * dpr) * auraScale +
          Math.sin(angle * 4 + timeAcc) * 1.5 * dpr;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, ${0.28 + smoothVol * 0.48})`;
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();
      ctx.restore();

      // 3. Orbiting glowing arc segments
      for (let arcIdx = 0; arcIdx < 2; arcIdx++) {
        const startA =
          timeAcc * (arcIdx === 0 ? 0.55 : -0.38) + arcIdx * Math.PI;
        const span = 0.75 + smoothMid * 0.7;
        const rArc = discRadius * (1.22 + arcIdx * 0.08 + smoothVol * 0.08);
        ctx.beginPath();
        ctx.arc(cx, cy, rArc, startA, startA + span);
        ctx.strokeStyle =
          arcIdx === 0
            ? `rgba(255, 210, 228, ${0.22 + smoothHigh * 0.48})`
            : `rgba(${r2}, ${g2}, ${b2}, ${0.22 + smoothMid * 0.42})`;
        ctx.lineWidth = 1.8 * dpr;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [animationIntensity]);

  const stageSizeClass = compact
    ? 'w-[250px] h-[250px] sm:w-[290px] sm:h-[290px]'
    : fullscreen
    ? 'w-[270px] h-[270px] sm:w-[340px] sm:h-[340px] md:w-[360px] md:h-[360px] xl:w-[440px] xl:h-[440px] 2xl:w-[480px] 2xl:h-[480px]'
    : 'w-[280px] h-[280px] sm:w-[340px] sm:h-[340px] xl:w-[390px] xl:h-[390px]';

  return (
    <div className={`relative flex items-center justify-center select-none ${stageSizeClass}`}>
      {/* Real-time Web Audio aura canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Ambient halo behind vinyl in fullscreen */}
      {fullscreen && (
        <div
          className="absolute w-[74%] h-[74%] rounded-full blur-3xl opacity-35 pointer-events-none transition-colors duration-700"
          style={{
            background: `radial-gradient(circle, ${palette.primary}66 0%, ${palette.secondary}33 55%, transparent 75%)`,
          }}
        />
      )}

      {/* Vinyl Disc Frame */}
      <div
        ref={discRef}
        className={`relative w-[65%] h-[65%] rounded-full p-[6px] will-change-transform group ${
          fullscreen
            ? 'shadow-[0_28px_84px_rgba(0,0,0,0.78)] ring-1 ring-white/20'
            : 'shadow-[0_20px_60px_rgba(0,0,0,0.65)]'
        }`}
        style={{
          background:
            'radial-gradient(circle at center, rgba(255,255,255,0.18) 0%, rgba(20,7,14,0.94) 66%, rgba(255,255,255,0.26) 100%)',
        }}
      >
        {/* Subtle vinyl grooves */}
        <div
          className="w-full h-full rounded-full overflow-hidden relative border border-white/15"
          style={{
            backgroundColor: '#16060d',
          }}
        >
          {displayedCover ? (
            <img
              src={displayedCover}
              alt={title}
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                fading ? 'opacity-0' : 'opacity-100'
              }`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-rose-950 to-purple-950">
              <Disc3 className="w-16 h-16 text-rose-200/50" />
            </div>
          )}

          {/* Vinyl concentric sheen overlay */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                'repeating-radial-gradient(circle at center, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 5px)',
            }}
          />

          {/* Center vinyl spindle hole */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-inner">
              <div
                className="w-3 h-3 rounded-full border border-white/35 transition-colors duration-500"
                style={{
                  backgroundColor: '#12040a',
                  boxShadow: isPlaying ? `0 0 10px ${palette.primary}88` : undefined,
                }}
              />
            </div>
          </div>
        </div>

        {/* Cover edit action on hover/tap */}
        {onChangeCover && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onChangeCover(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="更换专辑封面"
              aria-label="更换专辑封面"
              className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-black/65 hover:bg-black/85 border border-white/20 text-white/85 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity backdrop-blur-md cursor-pointer"
            >
              <ImagePlus className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Fixed Studio Light Reflection over Spinning Vinyl */}
      <div
        aria-hidden="true"
        className="absolute w-[65%] h-[65%] rounded-full pointer-events-none"
        style={{
          background:
            'conic-gradient(from 35deg, rgba(255,255,255,0.14) 0deg, transparent 48deg, transparent 175deg, rgba(255,255,255,0.08) 215deg, transparent 265deg, rgba(255,255,255,0.14) 360deg)',
          maskImage: 'radial-gradient(circle, transparent 19%, black 22%, black 100%)',
          WebkitMaskImage:
            'radial-gradient(circle, transparent 19%, black 22%, black 100%)',
        }}
      />

      {/* Precision Articulated Tonearm in Fullscreen Mode */}
      {fullscreen && (
        <div
          aria-hidden="true"
          className="hidden sm:block absolute top-[12%] right-[11%] w-[34%] h-[44%] pointer-events-none origin-[78%_16%] transition-transform duration-700 ease-out"
          style={{
            transform: isPlaying ? 'rotate(14deg)' : 'rotate(-10deg)',
          }}
        >
          {/* Pivot gimbal */}
          <div className="absolute top-[6%] right-[10%] w-7 h-7 rounded-full bg-gradient-to-br from-white/40 via-white/15 to-black/75 border border-white/30 shadow-lg flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#16060d] border border-white/40" />
          </div>
          {/* Tonearm shaft */}
          <div
            className="absolute top-[16%] right-[21%] w-[3px] h-[68%] rounded-full origin-top rotate-[18deg] shadow-md"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(215,205,212,0.5) 65%, rgba(255,255,255,0.85) 100%)',
            }}
          >
            {/* Cartridge headshell */}
            <div className="absolute -bottom-2.5 -left-[4px] w-[11px] h-4 rounded-sm bg-gradient-to-b from-zinc-200 to-zinc-600 border border-white/35 shadow-lg">
              <div
                className="w-1.5 h-1.5 rounded-full mx-auto mt-1 transition-all duration-500"
                style={{
                  backgroundColor: isPlaying ? palette.primary : 'rgba(255,255,255,0.35)',
                  boxShadow: isPlaying ? `0 0 8px ${palette.primary}` : undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
