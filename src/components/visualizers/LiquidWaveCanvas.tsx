import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../../audio/AudioEngine';
import { AnimationIntensity, TrackColorPalette } from '../../types/music';

interface LiquidWaveCanvasProps {
  isPlaying: boolean;
  palette: TrackColorPalette;
  intensity: AnimationIntensity;
  visible?: boolean;
}

export const LiquidWaveCanvas: React.FC<LiquidWaveCanvasProps> = ({
  isPlaying,
  palette,
  intensity,
  visible = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ isPlaying, palette, intensity, visible });
  stateRef.current = { isPlaying, palette, intensity, visible };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let phase = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothHigh = 0;
    let smoothVol = 0;

    // Smooth color interpolation for seamless album transitions
    let curR1 = palette.rgbPrimary[0];
    let curG1 = palette.rgbPrimary[1];
    let curB1 = palette.rgbPrimary[2];
    let curR2 = palette.rgbSecondary[0];
    let curG2 = palette.rgbSecondary[1];
    let curB2 = palette.rgbSecondary[2];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const drawLayer = (
      w: number,
      h: number,
      dpr: number,
      layerIdx: number,
      baseYRatio: number,
      ampBase: number,
      freqScale: number,
      speedMult: number,
      freqs: Uint8Array,
      waveform: Uint8Array,
      r: number,
      g: number,
      b: number,
      fillAlpha: number,
      strokeAlpha: number
    ) => {
      const segments = 64;
      const points: { x: number; y: number }[] = [];
      const baseY = h * baseYRatio;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = t * w;

        // Real spectrum lookup per horizontal segment (low -> mid -> high distributed cleanly)
        const specIdx = Math.min(
          freqs.length - 1,
          Math.floor(Math.pow(t, 1.35) * 160) + layerIdx * 8
        );
        const specEnergy = (freqs[specIdx] || 0) / 255;

        // Real time-domain subtle displacement
        const waveIdx = Math.floor(t * (waveform.length - 1));
        const timeDisp = ((waveform[waveIdx] || 128) - 128) / 128;

        // Edge taper so waves meet bottom corners smoothly
        const edgeWindow = Math.sin(t * Math.PI);

        // Low freq drives large swells, high freq drives fine ripples
        const swell =
          Math.sin(t * Math.PI * (2.2 + layerIdx * 0.7) * freqScale + phase * speedMult + layerIdx * 1.4) *
          (ampBase * (0.35 + smoothBass * 1.45));

        const midUndulation =
          Math.cos(t * Math.PI * 5.2 - phase * speedMult * 1.35 + layerIdx) *
          (ampBase * 0.35 * (0.2 + smoothMid));

        const highRipple =
          Math.sin(t * Math.PI * 14.5 + phase * speedMult * 2.4) *
          (6 * dpr * smoothHigh);

        const audioDisp =
          (specEnergy * ampBase * 0.9 + timeDisp * ampBase * 0.28 * smoothVol) *
          (0.35 + 0.65 * edgeWindow);

        const y =
          baseY -
          (swell + midUndulation + highRipple + audioDisp) *
            (0.22 + smoothVol * 0.95);

        points.push({ x, y: Math.max(4 * dpr, Math.min(h - 2, y)) });
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(points[0].x, points[0].y);

      for (let i = 0; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(w, points[points.length - 1].y);
      ctx.lineTo(w, h);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, baseY - ampBase * 1.4, 0, h);
      grad.addColorStop(0, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${fillAlpha})`);
      grad.addColorStop(
        1,
        `rgba(${Math.round(r * 0.45)}, ${Math.round(g * 0.45)}, ${Math.round(b * 0.45)}, ${
          fillAlpha * 0.18
        })`
      );
      ctx.fillStyle = grad;
      ctx.fill();

      // Luminous liquid surface rim
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(w, points[points.length - 1].y);
      ctx.strokeStyle = `rgba(${Math.min(255, Math.round(r + 45))}, ${Math.min(
        255,
        Math.round(g + 45)
      )}, ${Math.min(255, Math.round(b + 45))}, ${strokeAlpha})`;
      ctx.lineWidth = (layerIdx === 2 ? 2.1 : 1.35) * dpr;
      ctx.shadowColor = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.75)`;
      ctx.shadowBlur = (layerIdx === 2 ? 12 : 6) * dpr;
      ctx.stroke();
      ctx.restore();
    };

    const render = () => {
      const { isPlaying: playing, palette: pal, intensity: mode, visible: vis } =
        stateRef.current;

      const w = canvas.width;
      const h = canvas.height;

      if (!vis || w === 0 || h === 0) {
        if (w > 0 && h > 0) ctx.clearRect(0, 0, w, h);
        rafId = requestAnimationFrame(render);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.clearRect(0, 0, w, h);

      // Lerp palette colors
      curR1 += (pal.rgbPrimary[0] - curR1) * 0.04;
      curG1 += (pal.rgbPrimary[1] - curG1) * 0.04;
      curB1 += (pal.rgbPrimary[2] - curB1) * 0.04;
      curR2 += (pal.rgbSecondary[0] - curR2) * 0.04;
      curG2 += (pal.rgbSecondary[1] - curG2) * 0.04;
      curB2 += (pal.rgbSecondary[2] - curB2) * 0.04;

      const frame = audioEngine.getAnalysisFrame();
      const targetBass = playing ? frame.bass : 0;
      const targetMid = playing ? frame.mid : 0;
      const targetHigh = playing ? frame.high : 0;
      const targetVol = playing ? frame.volume : 0;

      smoothBass += (targetBass - smoothBass) * (playing ? 0.2 : 0.05);
      smoothMid += (targetMid - smoothMid) * (playing ? 0.2 : 0.05);
      smoothHigh += (targetHigh - smoothHigh) * (playing ? 0.25 : 0.06);
      smoothVol += (targetVol - smoothVol) * (playing ? 0.18 : 0.045);

      const mult = mode === 'low' ? 0.65 : mode === 'high' ? 1.25 : 1.0;
      phase += (playing ? 0.028 + smoothMid * 0.04 : 0.008) * mult;

      const maxAmp = h * 0.36 * mult;

      // Back secondary wave
      drawLayer(
        w,
        h,
        dpr,
        0,
        0.56,
        maxAmp * 0.95,
        0.95,
        0.8,
        frame.frequencies,
        frame.waveform,
        curR2,
        curG2,
        curB2,
        0.22,
        0.38
      );

      // Mid blended wave
      drawLayer(
        w,
        h,
        dpr,
        1,
        0.66,
        maxAmp * 0.85,
        1.15,
        1.15,
        frame.frequencies,
        frame.waveform,
        (curR1 + curR2) * 0.5,
        (curG1 + curG2) * 0.5,
        (curB1 + curB2) * 0.5,
        0.28,
        0.52
      );

      // Front primary luminous wave
      drawLayer(
        w,
        h,
        dpr,
        2,
        0.76,
        maxAmp * 0.78,
        1.35,
        1.45,
        frame.frequencies,
        frame.waveform,
        curR1,
        curG1,
        curB1,
        0.36,
        0.78
      );

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="w-full h-full pointer-events-none block"
    />
  );
};
