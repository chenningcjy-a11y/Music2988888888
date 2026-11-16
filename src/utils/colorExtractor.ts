import { TrackColorPalette } from '../types/music';
import { DEFAULT_PALETTE } from './constants';

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function boostVibrancy(rgb: [number, number, number]): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const boostedS = Math.max(0.55, Math.min(0.92, s * 1.25));
  const clampedL = Math.max(0.45, Math.min(0.66, l));
  return hslToRgb(h, boostedS, clampedL);
}

/**
 * Extracts dominant and complementary accent colors from a cover image DataURL.
 * Ensures vibrant, dark-UI-friendly colors for the liquid wave & dynamic aura.
 */
export async function extractPaletteFromImage(
  imageUrl?: string
): Promise<TrackColorPalette> {
  if (!imageUrl) return DEFAULT_PALETTE;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(DEFAULT_PALETTE);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets: Map<
          string,
          { count: number; rSum: number; gSum: number; bSum: number; score: number }
        > = new Map();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const [, s, l] = rgbToHsl(r, g, b);
          // Skip extreme dark/white pixels unless nothing else exists
          if (l < 0.08 || l > 0.92) continue;

          const qr = Math.floor(r / 32);
          const qg = Math.floor(g / 32);
          const qb = Math.floor(b / 32);
          const key = `${qr}-${qg}-${qb}`;
          const vibrancyWeight = 1 + s * 3.5;

          const existing = buckets.get(key);
          if (existing) {
            existing.count += 1;
            existing.rSum += r;
            existing.gSum += g;
            existing.bSum += b;
            existing.score += vibrancyWeight;
          } else {
            buckets.set(key, {
              count: 1,
              rSum: r,
              gSum: g,
              bSum: b,
              score: vibrancyWeight,
            });
          }
        }

        if (buckets.size === 0) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        const sorted = Array.from(buckets.values()).sort((a, b) => b.score - a.score);
        const top = sorted[0];
        const rawPrimary: [number, number, number] = [
          top.rSum / top.count,
          top.gSum / top.count,
          top.bSum / top.count,
        ];
        const primaryRgb = boostVibrancy(rawPrimary);

        // Pick a secondary color with distinct hue if available
        let secondaryRgb: [number, number, number] | null = null;
        const [pHue] = rgbToHsl(...primaryRgb);
        for (let i = 1; i < sorted.length; i++) {
          const cand = sorted[i];
          const cRgb: [number, number, number] = [
            cand.rSum / cand.count,
            cand.gSum / cand.count,
            cand.bSum / cand.count,
          ];
          const [cHue] = rgbToHsl(...cRgb);
          const hueDiff = Math.min(Math.abs(cHue - pHue), 1 - Math.abs(cHue - pHue));
          if (hueDiff > 0.09) {
            secondaryRgb = boostVibrancy(cRgb);
            break;
          }
        }

        if (!secondaryRgb) {
          // Shift hue analogously (+38 deg)
          const [h, s, l] = rgbToHsl(...primaryRgb);
          secondaryRgb = hslToRgb((h + 0.11) % 1, s, Math.max(0.48, l - 0.05));
        }

        // Deep background tint derived from primary hue
        const [dh, ds] = rgbToHsl(...primaryRgb);
        const deepRgb = hslToRgb(dh, Math.min(0.65, ds), 0.075);

        resolve({
          primary: rgbToHex(...primaryRgb),
          secondary: rgbToHex(...secondaryRgb),
          deep: rgbToHex(...deepRgb),
          rgbPrimary: primaryRgb,
          rgbSecondary: secondaryRgb,
        });
      } catch {
        resolve(DEFAULT_PALETTE);
      }
    };
    img.onerror = () => resolve(DEFAULT_PALETTE);
    img.src = imageUrl;
  });
}

export interface FluidBackgroundColors {
  primaryRgb: [number, number, number];
  abyssRgb: [number, number, number];
  deepRgb: [number, number, number];
  silkRgb: [number, number, number];
  secondaryRgb: [number, number, number];
  mistRgb: [number, number, number];
}

/**
 * Derives a coordinated, deep-luxury dark liquid color set from any track or preset palette.
 * Keeps saturation and luminance restrained so fluid layers resemble deep tinted water and silk
 * rather than garish neon.
 */
export function deriveFluidBackgroundColors(
  palette: TrackColorPalette
): FluidBackgroundColors {
  const primaryRgb: [number, number, number] = [
    palette.rgbPrimary[0],
    palette.rgbPrimary[1],
    palette.rgbPrimary[2],
  ];
  const [pH, pS] = rgbToHsl(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  const [sH, sS] = rgbToHsl(
    palette.rgbSecondary[0],
    palette.rgbSecondary[1],
    palette.rgbSecondary[2]
  );

  const isNearGray = pS < 0.08 && sS < 0.08;
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  if (isNearGray) {
    return {
      primaryRgb: [232, 67, 127],
      abyssRgb: [10, 12, 16],
      deepRgb: [20, 24, 32],
      silkRgb: [52, 60, 74],
      secondaryRgb: [66, 76, 92],
      mistRgb: [110, 122, 140],
    };
  }

  // Deep base layer (abyss & deep water tint)
  const abyssRgb = hslToRgb(pH, clamp(pS * 0.58, 0.28, 0.52), 0.048);
  const deepRgb = hslToRgb(pH, clamp(pS * 0.65, 0.34, 0.58), 0.105);

  // Mid flowing silk layers (restrained richness, never neon)
  const silkRgb = hslToRgb(pH, clamp(pS * 0.68, 0.34, 0.58), 0.27);

  // If primary and secondary hues are nearly identical, shift gently (+22 deg) for organic water depth
  const hueDiff = Math.min(Math.abs(pH - sH), 1 - Math.abs(pH - sH));
  const resolvedSecondaryH = hueDiff < 0.04 ? (pH + 0.065) % 1 : sH;
  const secondaryRgb = hslToRgb(
    resolvedSecondaryH,
    clamp(sS * 0.64, 0.30, 0.54),
    0.31
  );

  // Soft mist highlight (pale harmonious tint used at low opacity for water light play)
  let dH = resolvedSecondaryH - pH;
  if (dH > 0.5) dH -= 1;
  if (dH < -0.5) dH += 1;
  const mistH = (pH + dH * 0.55 + 1) % 1;
  const mistRgb = hslToRgb(mistH, clamp((pS + sS) * 0.28, 0.24, 0.44), 0.49);

  return {
    primaryRgb,
    abyssRgb,
    deepRgb,
    silkRgb,
    secondaryRgb,
    mistRgb,
  };
}

/**
 * Generates a high-resolution, artistic vinyl cover DataURL when an audio file
 * has no embedded artwork. Deterministic from track title + artist.
 */
export function generateProceduralCover(
  title: string,
  artist: string,
  hueOverride?: number
): string {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Hash string deterministically
  let hash = 0;
  const seed = `${title}-${artist}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const baseHue = hueOverride !== undefined ? hueOverride : (325 + (hash % 75)) % 360;
  const accentHue = (baseHue + 38) % 360;

  // Deep atmospheric gradient background
  const bgGrad = ctx.createLinearGradient(0, 0, size, size);
  bgGrad.addColorStop(0, `hsl(${baseHue}, 68%, 14%)`);
  bgGrad.addColorStop(0.5, `hsl(${(baseHue + 18) % 360}, 60%, 22%)`);
  bgGrad.addColorStop(1, `hsl(${accentHue}, 65%, 12%)`);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Luminous abstract orbs
  const orb1 = ctx.createRadialGradient(
    size * 0.35,
    size * 0.35,
    10,
    size * 0.35,
    size * 0.35,
    size * 0.55
  );
  orb1.addColorStop(0, `hsla(${baseHue}, 92%, 62%, 0.72)`);
  orb1.addColorStop(0.5, `hsla(${baseHue}, 85%, 42%, 0.25)`);
  orb1.addColorStop(1, 'transparent');
  ctx.fillStyle = orb1;
  ctx.fillRect(0, 0, size, size);

  const orb2 = ctx.createRadialGradient(
    size * 0.72,
    size * 0.68,
    10,
    size * 0.72,
    size * 0.68,
    size * 0.5
  );
  orb2.addColorStop(0, `hsla(${accentHue}, 88%, 60%, 0.65)`);
  orb2.addColorStop(1, 'transparent');
  ctx.fillStyle = orb2;
  ctx.fillRect(0, 0, size, size);

  // Concentric fine acoustic rings
  ctx.save();
  ctx.translate(size / 2, size / 2);
  for (let r = 64; r <= 220; r += 26) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + ((220 - r) / 220) * 0.08})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  // Stylized wave ribbon
  ctx.beginPath();
  for (let x = -size / 2; x <= size / 2; x += 4) {
    const y =
      Math.sin((x / size) * Math.PI * 4 + (hash % 6)) * 28 +
      Math.cos((x / size) * Math.PI * 7) * 12;
    if (x === -size / 2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(255, 235, 245, 0.32)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // Initial glyph in center
  const glyph = (title.trim()[0] || 'L').toUpperCase();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '600 96px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2);

  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Compresses an arbitrary image File or Uint8Array to a clean square/fitted JPEG DataURL
 * so IndexedDB stays fast and compact.
 */
export async function resizeCoverToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode cover image'));
    };
    img.src = url;
  });
}
