import React, { useEffect, useRef, useState } from 'react';
import { Disc3 } from 'lucide-react';
import { audioEngine } from '../../audio/AudioEngine';
import { AnimationIntensity, TrackColorPalette } from '../../types/music';

interface FullscreenCoverFluidStageProps {
  coverUrl?: string;
  title: string;
  trackId?: string;
  isPlaying: boolean;
  palette: TrackColorPalette;
  animationIntensity?: AnimationIntensity;
  reducedMotion?: boolean;
}

/**
 * Superellipse contour radius closely matching a rounded square cover edge.
 */
function roundedSquareRadius(theta: number, half: number): number {
  const ax = Math.abs(Math.cos(theta));
  const ay = Math.abs(Math.sin(theta));
  const p = 7.2;
  const denom = Math.pow(Math.pow(ax, p) + Math.pow(ay, p), 1 / p);
  return half / Math.max(0.001, denom);
}

export const FullscreenCoverFluidStage: React.FC<FullscreenCoverFluidStageProps> = ({
  coverUrl,
  title,
  trackId,
  isPlaying,
  palette,
  animationIntensity = 'balanced',
  reducedMotion = false,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgError, setImgError] = useState(false);

  const stateRef = useRef({
    isPlaying,
    palette,
    animationIntensity,
    reducedMotion,
  });
  stateRef.current = {
    isPlaying,
    palette,
    animationIntensity,
    reducedMotion,
  };

  useEffect(() => {
    setImgError(false);
  }, [coverUrl, trackId]);

  useEffect(() => {
    const stageEl = stageRef.current;
    const canvas = canvasRef.current;
    if (!stageEl || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotionQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let coverCssSize = 280;
    let padCss = 56;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const updateDimensions = () => {
      const rect = stageEl.getBoundingClientRect();
      coverCssSize = Math.max(160, rect.width || 280);
      padCss = Math.round(Math.max(40, Math.min(64, coverCssSize * 0.19)));
      const totalCss = coverCssSize + padCss * 2;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.style.width = `${totalCss}px`;
      canvas.style.height = `${totalCss}px`;
      canvas.width = Math.round(totalCss * dpr);
      canvas.height = Math.round(totalCss * dpr);
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(stageEl);

    const curPrimary: [number, number, number] = [...palette.rgbPrimary];
    const curSecondary: [number, number, number] = [...palette.rgbSecondary];

    let smoothVol = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothHigh = 0;
    let fluidPhase = 0;
    let lastTs = performance.now();
    let rafId = 0;
    let frameToggle = false;

    const drawLoop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const {
        isPlaying: playing,
        palette: targetPalette,
        animationIntensity: animMode,
        reducedMotion: userReducedMotion,
      } = stateRef.current;

      if (typeof document !== 'undefined' && document.hidden) {
        rafId = requestAnimationFrame(drawLoop);
        return;
      }

      if (animMode === 'low') {
        frameToggle = !frameToggle;
        if (frameToggle) {
          rafId = requestAnimationFrame(drawLoop);
          return;
        }
      }

      const reduceMotion = Boolean(userReducedMotion || reducedMotionQuery?.matches);
      const frame = audioEngine.getAnalysisFrame();
      const targetVol = playing ? frame.volume : 0;
      const targetBass = playing ? frame.bass : 0;
      const targetMid = playing ? frame.mid : 0;
      const targetHigh = playing ? frame.high : 0;

      // Smooth attack/release for calm, liquid movement without jitter
      const envLerp = 1 - Math.exp(-dt * (playing ? 9.5 : 4.2));
      smoothVol += (targetVol - smoothVol) * envLerp;
      smoothBass += (targetBass - smoothBass) * envLerp;
      smoothMid += (targetMid - smoothMid) * envLerp;
      smoothHigh += (targetHigh - smoothHigh) * envLerp;

      // 1~2 second smooth color morphing
      const colorLerp = 1 - Math.exp(-dt * 2.3);
      for (let i = 0; i < 3; i++) {
        curPrimary[i] += (targetPalette.rgbPrimary[i] - curPrimary[i]) * colorLerp;
        curSecondary[i] +=
          (targetPalette.rgbSecondary[i] - curSecondary[i]) * colorLerp;
      }

      if (!reduceMotion) {
        const speed = playing ? 0.52 + smoothMid * 0.95 + smoothVol * 0.55 : 0.16;
        fluidPhase += dt * speed;
      }

      const totalCss = coverCssSize + padCss * 2;
      const cx = totalCss / 2;
      const cy = totalCss / 2;
      const half = coverCssSize / 2;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, totalCss, totalCss);

      const pR = Math.round(curPrimary[0]);
      const pG = Math.round(curPrimary[1]);
      const pB = Math.round(curPrimary[2]);
      const sR = Math.round(curSecondary[0]);
      const sG = Math.round(curSecondary[1]);
      const sB = Math.round(curSecondary[2]);

      // 1. Soft edge aura tightly framing the square cover (never oversized)
      const auraRadius = half * (1.28 + smoothBass * 0.11 + smoothVol * 0.06);
      const auraAlpha = playing
        ? 0.22 + smoothBass * 0.16 + smoothVol * 0.1
        : 0.12;
      const auraGrad = ctx.createRadialGradient(
        cx - half * 0.12,
        cy - half * 0.12,
        half * 0.72,
        cx,
        cy,
        auraRadius
      );
      auraGrad.addColorStop(0, `rgba(${pR}, ${pG}, ${pB}, ${auraAlpha.toFixed(3)})`);
      auraGrad.addColorStop(
        0.55,
        `rgba(${sR}, ${sG}, ${sB}, ${(auraAlpha * 0.52).toFixed(3)})`
      );
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = auraGrad;
      ctx.fillRect(0, 0, totalCss, totalCss);

      // 2. Soft liquid contour ribbons around the square cover perimeter
      const rippleLayers = animMode === 'low' ? 2 : 3;
      const segments = 96;

      for (let layer = 0; layer < rippleLayers; layer++) {
        const layerRatio = layer / Math.max(1, rippleLayers - 1);
        const baseMargin = 6 + layer * 8.5 + smoothBass * (5 + layer * 3.5);
        const waveAmp =
          (playing ? 2.4 + smoothVol * 5.2 + smoothMid * 3.4 : 1.1) *
          (0.75 + layer * 0.25);

        ctx.beginPath();
        for (let s = 0; s <= segments; s++) {
          const theta = (s / segments) * Math.PI * 2;
          const squareBaseR = roundedSquareRadius(theta, half);
          const harmonic =
            Math.sin(theta * 3 + fluidPhase * (1.05 + layer * 0.18) + layer * 1.4) *
              0.55 +
            Math.cos(theta * 5 - fluidPhase * (0.85 - layer * 0.12) + layer * 2.1) *
              0.32 +
            Math.sin(theta * 2 + fluidPhase * 1.45 - layer) * 0.24;

          const r = squareBaseR + baseMargin + harmonic * waveAmp;
          const x = cx + Math.cos(theta) * r;
          const y = cy + Math.sin(theta) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        const useSecondary = layer % 2 === 1;
        const rC = useSecondary ? sR : pR;
        const gC = useSecondary ? sG : pG;
        const bC = useSecondary ? sB : pB;
        const strokeAlpha =
          (playing ? 0.24 + smoothVol * 0.18 + smoothHigh * 0.12 : 0.11) *
          (1 - layerRatio * 0.42);

        ctx.strokeStyle = `rgba(${rC}, ${gC}, ${bC}, ${strokeAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.6 - layer * 0.22;
        ctx.stroke();

        // Subtle inner liquid fill on the innermost wave
        if (layer === 0) {
          ctx.fillStyle = `rgba(${pR}, ${pG}, ${pB}, ${(
            (playing ? 0.08 + smoothVol * 0.07 : 0.04)
          ).toFixed(3)})`;
          ctx.fill();
        }
      }

      ctx.restore();
      rafId = requestAnimationFrame(drawLoop);
    };

    rafId = requestAnimationFrame(drawLoop);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [animationIntensity]);

  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Stationary square cover sizing container */}
      <div
        ref={stageRef}
        className="relative w-[clamp(150px,min(35vh,30vw),340px)] aspect-square shrink-0"
      >
        {/* Surrounding audio-reactive fluid ripple canvas (behind cover) */}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
        />

        {/* Square, stationary album cover */}
        <div
          className="relative z-10 w-full h-full rounded-[28px] overflow-hidden ring-1 ring-white/20 bg-[#160812]"
          style={{
            boxShadow:
              '0 28px 72px rgba(0, 0, 0, 0.72), 0 8px 24px rgba(0, 0, 0, 0.45)',
          }}
        >
          {coverUrl && !imgError ? (
            <img
              key={`${trackId || 'none'}-${coverUrl.slice(0, 48)}`}
              src={coverUrl}
              alt={title}
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover block"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(0,0,0,0.55))',
              }}
            >
              <Disc3 className="w-16 h-16 text-white/35" />
            </div>
          )}

          {/* Subtle glass sheen edge (never obscures cover artwork) */}
          <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/12" />
        </div>
      </div>
    </div>
  );
};
