import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../../audio/AudioEngine';
import { AnimationIntensity, TrackColorPalette } from '../../types/music';
import {
  deriveFluidBackgroundColors,
  FluidBackgroundColors,
} from '../../utils/colorExtractor';

interface DynamicBackgroundProps {
  palette: TrackColorPalette;
  isPlaying: boolean;
  dynamicGlow: boolean;
  glowIntensity: number;
  animationIntensity?: AnimationIntensity;
  reducedMotion?: boolean;
  isFullscreen?: boolean;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function formatRgbStr(rgb: [number, number, number]): string {
  return `${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}`;
}

function cloneColors(c: FluidBackgroundColors): FluidBackgroundColors {
  return {
    primaryRgb: [...c.primaryRgb],
    abyssRgb: [...c.abyssRgb],
    deepRgb: [...c.deepRgb],
    silkRgb: [...c.silkRgb],
    secondaryRgb: [...c.secondaryRgb],
    mistRgb: [...c.mistRgb],
  };
}

export const DynamicBackground: React.FC<DynamicBackgroundProps> = ({
  palette,
  isPlaying,
  dynamicGlow,
  glowIntensity,
  animationIntensity = 'balanced',
  reducedMotion = false,
  isFullscreen = false,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const blob0Ref = useRef<HTMLDivElement | null>(null);
  const blob1Ref = useRef<HTMLDivElement | null>(null);
  const blob2Ref = useRef<HTMLDivElement | null>(null);
  const blob3Ref = useRef<HTMLDivElement | null>(null);
  const rippleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const propsRef = useRef({
    palette,
    isPlaying,
    dynamicGlow,
    glowIntensity,
    animationIntensity,
    reducedMotion,
    isFullscreen,
  });
  propsRef.current = {
    palette,
    isPlaying,
    dynamicGlow,
    glowIntensity,
    animationIntensity,
    reducedMotion,
    isFullscreen,
  };

  // Track current interpolated colors across palette updates (1.5s smooth transition)
  const colorTransitionRef = useRef<{
    start: FluidBackgroundColors;
    current: FluidBackgroundColors;
    target: FluidBackgroundColors;
    startTime: number;
    durationMs: number;
    active: boolean;
  }>({
    start: deriveFluidBackgroundColors(palette),
    current: deriveFluidBackgroundColors(palette),
    target: deriveFluidBackgroundColors(palette),
    startTime: 0,
    durationMs: 1500,
    active: false,
  });

  const wakeLoopRef = useRef<(() => void) | null>(null);
  const resizeCanvasRef = useRef<(() => void) | null>(null);

  // Trigger smooth 1.5s color transition whenever palette changes without resetting fluid phase
  useEffect(() => {
    const nextTarget = deriveFluidBackgroundColors(palette);
    const tr = colorTransitionRef.current;
    tr.start = cloneColors(tr.current);
    tr.target = nextTarget;
    tr.startTime = performance.now();
    tr.durationMs = 1500;
    tr.active = true;
    wakeLoopRef.current?.();
  }, [palette]);

  useEffect(() => {
    resizeCanvasRef.current?.();
    wakeLoopRef.current?.();
  }, [animationIntensity, reducedMotion]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = rippleCanvasRef.current;
    if (!root) return;
    const ctx = canvas ? canvas.getContext('2d') : null;

    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let systemReducedMotion = mq?.matches ?? false;
    const handleMqChange = (e: MediaQueryListEvent) => {
      systemReducedMotion = e.matches;
    };
    mq?.addEventListener?.('change', handleMqChange);

    // Resize Layer 3 ripple canvas with low internal resolution for optical softness & tablet performance
    let canvasW = 280;
    let canvasH = 180;
    const updateCanvasSize = () => {
      if (!canvas) return;
      const rect = root.getBoundingClientRect();
      const vw = Math.max(320, rect.width || window.innerWidth);
      const vh = Math.max(240, rect.height || window.innerHeight);
      const maxDim =
        propsRef.current.animationIntensity === 'low'
          ? 200
          : propsRef.current.animationIntensity === 'high'
          ? 400
          : 280;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      canvasW = Math.max(160, Math.round(vw * scale));
      canvasH = Math.max(100, Math.round(vh * scale));
      if (canvas.width !== canvasW || canvas.height !== canvasH) {
        canvas.width = canvasW;
        canvas.height = canvasH;
      }
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(root);

    const applyColorVars = (c: FluidBackgroundColors) => {
      root.style.setProperty('--fluid-primary-rgb', formatRgbStr(c.primaryRgb));
      root.style.setProperty('--fluid-abyss-rgb', formatRgbStr(c.abyssRgb));
      root.style.setProperty('--fluid-deep-rgb', formatRgbStr(c.deepRgb));
      root.style.setProperty('--fluid-silk-rgb', formatRgbStr(c.silkRgb));
      root.style.setProperty('--fluid-secondary-rgb', formatRgbStr(c.secondaryRgb));
      root.style.setProperty('--fluid-mist-rgb', formatRgbStr(c.mistRgb));
    };

    applyColorVars(colorTransitionRef.current.current);

    let flowPhase = 0; // advances steadily in seconds for 20-40s seamless periods
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothVol = 0;
    let lastNow = performance.now();
    let lastDrawNow = 0;
    let rafId = 0;
    let isHidden = typeof document !== 'undefined' ? document.hidden : false;

    const applyStaticRestingPose = (intensityScale: number) => {
      const b0 = blob0Ref.current;
      const b1 = blob1Ref.current;
      const b2 = blob2Ref.current;
      const b3 = blob3Ref.current;
      if (b0) {
        b0.style.transform = 'translate3d(-12%, -10%, 0) scale(1.04, 0.98) rotate(-4deg)';
        b0.style.opacity = String((0.44 * intensityScale).toFixed(3));
      }
      if (b1) {
        b1.style.transform = 'translate3d(14%, 12%, 0) scale(1.02, 1.05) rotate(6deg)';
        b1.style.opacity = String((0.4 * intensityScale).toFixed(3));
      }
      if (b2) {
        b2.style.transform = 'translate3d(4%, -4%, 0) scale(1.06, 0.96) rotate(2deg)';
        b2.style.opacity = String((0.3 * intensityScale).toFixed(3));
      }
      if (b3) {
        b3.style.transform = 'translate3d(-6%, 8%, 0) scale(1.0, 1.0)';
        b3.style.opacity = String((0.18 * intensityScale).toFixed(3));
      }
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvasW, canvasH);
      }
    };

    const drawWaterRipples = (
      t: number,
      bass: number,
      mid: number,
      vol: number,
      colors: FluidBackgroundColors,
      intensityScale: number,
      fullscreenBoost: number
    ) => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvasW, canvasH);

      const mR = Math.round(colors.mistRgb[0]);
      const mG = Math.round(colors.mistRgb[1]);
      const mB = Math.round(colors.mistRgb[2]);
      const sR = Math.round(colors.secondaryRgb[0]);
      const sG = Math.round(colors.secondaryRgb[1]);
      const sB = Math.round(colors.secondaryRgb[2]);

      // Gentle amplitude expansion driven softly by low-frequency bass & volume
      const swellAmp = 1 + bass * 0.42 + vol * 0.22;
      const shimmerAlpha =
        (0.055 + vol * 0.048 + bass * 0.032) * intensityScale * fullscreenBoost;

      const ribbons = [
        {
          yBase: canvasH * 0.34,
          freq1: 2.1,
          freq2: 3.4,
          speed1: (Math.PI * 2) / 31,
          speed2: (Math.PI * 2) / 23,
          amp: canvasH * 0.075 * swellAmp,
          thick: canvasH * 0.28,
          rgb: [sR, sG, sB],
          alpha: shimmerAlpha * 1.05,
        },
        {
          yBase: canvasH * 0.56,
          freq1: 1.7,
          freq2: 2.9,
          speed1: -(Math.PI * 2) / 36,
          speed2: (Math.PI * 2) / 26,
          amp: canvasH * 0.085 * swellAmp,
          thick: canvasH * 0.3,
          rgb: [mR, mG, mB],
          alpha: shimmerAlpha * 0.85,
        },
        {
          yBase: canvasH * 0.72,
          freq1: 2.4,
          freq2: 1.5,
          speed1: (Math.PI * 2) / 28,
          speed2: -(Math.PI * 2) / 39,
          amp: canvasH * 0.065 * (1 + mid * 0.25 + bass * 0.3),
          thick: canvasH * 0.24,
          rgb: [sR, sG, sB],
          alpha: shimmerAlpha * 0.75,
        },
      ];

      const steps = 28;
      for (let i = 0; i < ribbons.length; i++) {
        const rb = ribbons[i];
        const yCenter =
          rb.yBase + Math.sin(t * ((Math.PI * 2) / 34) + i * 1.9) * (canvasH * 0.045);

        const grad = ctx.createLinearGradient(
          0,
          yCenter - rb.thick * 0.65,
          0,
          yCenter + rb.thick * 0.65
        );
        grad.addColorStop(0, `rgba(${rb.rgb[0]}, ${rb.rgb[1]}, ${rb.rgb[2]}, 0)`);
        grad.addColorStop(
          0.48,
          `rgba(${rb.rgb[0]}, ${rb.rgb[1]}, ${rb.rgb[2]}, ${rb.alpha.toFixed(4)})`
        );
        grad.addColorStop(1, `rgba(${rb.rgb[0]}, ${rb.rgb[1]}, ${rb.rgb[2]}, 0)`);

        ctx.beginPath();
        const topPoints: [number, number][] = [];
        const botPoints: [number, number][] = [];

        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = u * canvasW;
          const wave =
            Math.sin(u * Math.PI * rb.freq1 + t * rb.speed1 + i * 1.3) * 0.62 +
            Math.cos(u * Math.PI * rb.freq2 + t * rb.speed2 - i * 0.8) * 0.38;
          const yOff = wave * rb.amp;
          const localHalfThick =
            rb.thick *
            0.5 *
            (0.84 + 0.16 * Math.sin(u * Math.PI * 2 + t * ((Math.PI * 2) / 25) + i));
          topPoints.push([x, yCenter + yOff - localHalfThick]);
          botPoints.push([x, yCenter + yOff + localHalfThick]);
        }

        ctx.moveTo(topPoints[0][0], topPoints[0][1]);
        for (let s = 1; s < topPoints.length; s++) {
          ctx.lineTo(topPoints[s][0], topPoints[s][1]);
        }
        for (let s = botPoints.length - 1; s >= 0; s--) {
          ctx.lineTo(botPoints[s][0], botPoints[s][1]);
        }
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
    };

    const tick = (now: number) => {
      if (isHidden) {
        rafId = 0;
        return;
      }

      const {
        isPlaying: playing,
        dynamicGlow: dynEnabled,
        glowIntensity: glowPct,
        animationIntensity: animMode,
        reducedMotion: userReducedMotion,
        isFullscreen: fullscreenMode,
      } = propsRef.current;

      const reduceMotion = Boolean(userReducedMotion || systemReducedMotion);

      // Handle smooth 1.5s palette morphing even if motion is reduced
      const tr = colorTransitionRef.current;
      if (tr.active) {
        const rawT = Math.min(1, (now - tr.startTime) / tr.durationMs);
        const eased =
          rawT < 0.5
            ? 4 * rawT * rawT * rawT
            : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
        tr.current = {
          primaryRgb: lerpRgb(tr.start.primaryRgb, tr.target.primaryRgb, eased),
          abyssRgb: lerpRgb(tr.start.abyssRgb, tr.target.abyssRgb, eased),
          deepRgb: lerpRgb(tr.start.deepRgb, tr.target.deepRgb, eased),
          silkRgb: lerpRgb(tr.start.silkRgb, tr.target.silkRgb, eased),
          secondaryRgb: lerpRgb(tr.start.secondaryRgb, tr.target.secondaryRgb, eased),
          mistRgb: lerpRgb(tr.start.mistRgb, tr.target.mistRgb, eased),
        };
        applyColorVars(tr.current);
        if (rawT >= 1) {
          tr.active = false;
        }
      }

      const intensityScale = Math.max(0.22, Math.min(1.15, (glowPct / 100) * 1.05));
      const fullscreenBoost = fullscreenMode ? 1.1 : 1.0;

      if (reduceMotion) {
        applyStaticRestingPose(intensityScale);
        if (tr.active) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = 0;
        }
        return;
      }

      // Frame pacing keeps GPU cool on Android tablets while maintaining silk smoothness
      const minIntervalMs =
        animMode === 'low' ? 40 : animMode === 'high' ? 16 : 26;
      if (now - lastDrawNow < minIntervalMs) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastDrawNow = now;

      const dt = Math.min(0.08, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;

      // Constant slow baseline clock (~20-40s cycles) — never speeds up abruptly on beats
      flowPhase += dt;

      // Real audio analysis with slow ~0.9s envelope smoothing (calm water response, no strobe)
      let targetBass = 0;
      let targetMid = 0;
      let targetVol = 0;
      if (playing && dynEnabled) {
        const frame = audioEngine.getAnalysisFrame();
        targetBass = frame.bass;
        targetMid = frame.mid;
        targetVol = frame.volume;
      }

      const envLerp = 1 - Math.exp(-dt * (playing ? 1.25 : 0.7));
      smoothBass += (targetBass - smoothBass) * envLerp;
      smoothMid += (targetMid - smoothMid) * envLerp;
      smoothVol += (targetVol - smoothVol) * envLerp;

      const t = flowPhase;
      const bassLift = smoothBass * 0.085;
      const volGlow = smoothVol * 0.095;

      // Layer 2: GPU-accelerated transform3d & opacity for 4 slow-moving liquid blobs
      // Periods span 23s ~ 39s with irrational combinations for organic non-mechanical flow
      const b0 = blob0Ref.current;
      if (b0) {
        const x =
          -14 +
          Math.sin(t * ((Math.PI * 2) / 29.3)) * (11 + smoothBass * 3.5) +
          Math.cos(t * ((Math.PI * 2) / 37.9)) * 5;
        const y =
          -10 +
          Math.cos(t * ((Math.PI * 2) / 33.1)) * (10 + smoothMid * 2.5) +
          Math.sin(t * ((Math.PI * 2) / 24.7)) * 4;
        const sx =
          1.04 +
          Math.sin(t * ((Math.PI * 2) / 27.4)) * 0.08 +
          bassLift;
        const sy =
          0.98 +
          Math.cos(t * ((Math.PI * 2) / 31.8)) * 0.08 +
          bassLift * 0.7;
        const rot = -6 + Math.sin(t * ((Math.PI * 2) / 38.5)) * 12;
        const op =
          (0.42 +
            0.07 * Math.sin(t * ((Math.PI * 2) / 26.2)) +
            volGlow * 0.9) *
          intensityScale *
          fullscreenBoost;
        b0.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(
          2
        )}%, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(
          2
        )}deg)`;
        b0.style.opacity = String(Math.min(0.66, op).toFixed(3));
      }

      const b1 = blob1Ref.current;
      if (b1) {
        const x =
          14 +
          Math.cos(t * ((Math.PI * 2) / 34.7)) * (11 + smoothBass * 3.2) +
          Math.sin(t * ((Math.PI * 2) / 23.9)) * 4.5;
        const y =
          12 +
          Math.sin(t * ((Math.PI * 2) / 28.3)) * (10 + smoothMid * 2.5) +
          Math.cos(t * ((Math.PI * 2) / 39.2)) * 4;
        const sx =
          1.02 +
          Math.cos(t * ((Math.PI * 2) / 30.6)) * 0.09 +
          bassLift * 0.85;
        const sy =
          1.05 +
          Math.sin(t * ((Math.PI * 2) / 25.1)) * 0.08 +
          bassLift * 0.65;
        const rot = 8 + Math.cos(t * ((Math.PI * 2) / 36.1)) * 11;
        const op =
          (0.38 +
            0.07 * Math.cos(t * ((Math.PI * 2) / 31.4)) +
            volGlow * 0.85) *
          intensityScale *
          fullscreenBoost;
        b1.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(
          2
        )}%, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(
          2
        )}deg)`;
        b1.style.opacity = String(Math.min(0.62, op).toFixed(3));
      }

      const b2 = blob2Ref.current;
      if (b2) {
        const x =
          Math.sin(t * ((Math.PI * 2) / 38.1) + 1.1) * (15 + smoothBass * 3) +
          Math.cos(t * ((Math.PI * 2) / 22.7)) * 5;
        const y =
          Math.cos(t * ((Math.PI * 2) / 26.9) + 0.7) * (12 + smoothMid * 2.2) +
          Math.sin(t * ((Math.PI * 2) / 35.4)) * 4;
        const sx =
          1.05 +
          Math.sin(t * ((Math.PI * 2) / 34.2) + 2.0) * 0.1 +
          bassLift * 0.75;
        const sy =
          0.95 +
          Math.cos(t * ((Math.PI * 2) / 29.7) + 1.4) * 0.09 +
          bassLift * 0.9;
        const rot = Math.sin(t * ((Math.PI * 2) / 40.0)) * 15;
        const op =
          (0.28 +
            0.06 * Math.sin(t * ((Math.PI * 2) / 28.8) + 1.5) +
            volGlow * 0.7) *
          intensityScale *
          fullscreenBoost;
        b2.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(
          2
        )}%, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(
          2
        )}deg)`;
        b2.style.opacity = String(Math.min(0.48, op).toFixed(3));
      }

      const b3 = blob3Ref.current;
      if (b3) {
        const x =
          -4 +
          Math.cos(t * ((Math.PI * 2) / 24.4) + 2.3) * 14 +
          Math.sin(t * ((Math.PI * 2) / 36.8)) * 5;
        const y =
          4 +
          Math.sin(t * ((Math.PI * 2) / 31.2) + 0.9) * 11 +
          Math.cos(t * ((Math.PI * 2) / 22.3)) * 4;
        const sx =
          1.0 +
          Math.cos(t * ((Math.PI * 2) / 25.7)) * 0.07 +
          bassLift * 0.55;
        const sy =
          1.0 +
          Math.sin(t * ((Math.PI * 2) / 33.9)) * 0.07 +
          bassLift * 0.55;
        const op =
          (0.16 +
            0.05 * Math.sin(t * ((Math.PI * 2) / 23.5) + 0.5) +
            volGlow * 0.65) *
          intensityScale *
          fullscreenBoost;
        b3.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(
          2
        )}%, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        b3.style.opacity = String(Math.min(0.32, op).toFixed(3));
      }

      // Layer 3: Subtle translucent water-surface ripples & soft caustic light
      drawWaterRipples(
        t,
        smoothBass,
        smoothMid,
        smoothVol,
        tr.current,
        intensityScale,
        fullscreenBoost
      );

      rafId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (!rafId && !isHidden) {
        lastNow = performance.now();
        lastDrawNow = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    const handleVisibilityChange = () => {
      isHidden = document.hidden;
      if (isHidden) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        startLoop();
      }
    };

    resizeCanvasRef.current = updateCanvasSize;
    wakeLoopRef.current = startLoop;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startLoop();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      wakeLoopRef.current = null;
      resizeCanvasRef.current = null;
      resizeObserver.disconnect();
      mq?.removeEventListener?.('change', handleMqChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
      style={{
        backgroundColor: palette.deep || '#0b050a',
      }}
    >
      {/* Layer 1: Deep Dark Base Gradient Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 115% 88% at 18% 20%, rgba(var(--fluid-deep-rgb, 24, 10, 22), 0.94) 0%, rgba(var(--fluid-abyss-rgb, 10, 4, 10), 1) 74%),
            linear-gradient(152deg, rgb(var(--fluid-abyss-rgb, 10, 4, 10)) 0%, rgb(var(--fluid-deep-rgb, 24, 10, 22)) 52%, rgb(var(--fluid-abyss-rgb, 10, 4, 10)) 100%)
          `,
        }}
      />

      {/* Layer 2: Slow-Moving Multi-Color Liquid Silk Gradient Blobs (GPU transform3d + opacity) */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          ref={blob0Ref}
          className="absolute -top-[28%] -left-[22%] w-[115vmax] h-[115vmax] will-change-transform"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0.95) 0%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0.56) 28%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0.18) 54%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0) 74%)',
          }}
        />

        <div
          ref={blob1Ref}
          className="absolute -bottom-[30%] -right-[20%] w-[112vmax] h-[112vmax] will-change-transform"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.92) 0%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.54) 30%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.16) 56%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0) 75%)',
          }}
        />

        <div
          ref={blob2Ref}
          className="absolute top-[6%] left-[12%] w-[96vmax] h-[86vmax] will-change-transform"
          style={{
            background:
              'radial-gradient(ellipse 62% 54% at 50% 50%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0.78) 0%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.44) 34%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.12) 58%, rgba(0, 0, 0, 0) 76%)',
          }}
        />

        <div
          ref={blob3Ref}
          className="absolute top-[18%] right-[16%] w-[82vmax] h-[74vmax] will-change-transform"
          style={{
            background:
              'radial-gradient(ellipse 58% 52% at 50% 50%, rgba(var(--fluid-mist-rgb, 152, 110, 148), 0.75) 0%, rgba(var(--fluid-mist-rgb, 152, 110, 148), 0.28) 38%, rgba(var(--fluid-mist-rgb, 152, 110, 148), 0) 72%)',
          }}
        />
      </div>

      {/* Layer 2.5: Luminous Theme-Gradient Fluid Wash Overlay */}
      <div
        className="absolute inset-0 opacity-45 mix-blend-screen pointer-events-none transition-opacity duration-1000"
        style={{
          background: `
            radial-gradient(circle at 22% 28%, rgba(var(--fluid-silk-rgb, 96, 36, 68), 0.52) 0%, transparent 58%),
            radial-gradient(circle at 78% 72%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.48) 0%, transparent 62%),
            linear-gradient(125deg, rgba(var(--fluid-primary-rgb, 232, 67, 127), 0.22) 0%, rgba(var(--fluid-secondary-rgb, 72, 42, 118), 0.26) 50%, rgba(var(--fluid-mist-rgb, 152, 110, 148), 0.18) 100%)
          `,
        }}
      />

      {/* Layer 3: Subtle Translucent Water-Surface Ripples & Soft Light Play */}
      <canvas
        ref={rippleCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none"
      />

      {/* Contrast & Depth Vignette Scrim */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 92% 88% at 50% 48%, rgba(0, 0, 0, 0.04) 35%, rgba(0, 0, 0, 0.42) 100%), linear-gradient(180deg, rgba(0, 0, 0, 0.24) 0%, rgba(0, 0, 0, 0.06) 45%, rgba(0, 0, 0, 0.44) 100%)',
        }}
      />
    </div>
  );
};
