import { encodeStereoWav } from '../../audio/mdxDsp';
import { AudioAnalysisResult } from '../../types/ai';
import { TrackMetadata } from '../../types/music';
import { getAudioBlob } from '../storage';

export type MusicAnalysisType = 'comprehensive' | 'instruments' | 'rhythm-audio';

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(
      String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
    );
  }
  return btoa(parts.join(''));
}

/**
 * Decodes up to 30 seconds of a track into a compact 22.05kHz stereo WAV snippet
 * (~2.6 MB max) so multimodal audio models (such as Gemini) can analyze actual audio content.
 */
async function extractCompactAudioClipBase64(
  trackId: string
): Promise<{ base64: string; mimeType: string } | null> {
  const blob = await getAudioBlob(trackId);
  if (!blob) return null;

  // If raw file is already compact (<= 4 MB) and standard mime, pass directly
  if (
    blob.size <= 4 * 1024 * 1024 &&
    blob.type &&
    blob.type.startsWith('audio/')
  ) {
    const buf = await blob.arrayBuffer();
    return {
      base64: uint8ToBase64(new Uint8Array(buf)),
      mimeType: blob.type,
    };
  }

  const arr = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arr.slice(0));
    const clipSec = Math.min(30, decoded.duration);
    const targetRate = 22050;
    const targetSamples = Math.max(1, Math.floor(clipSec * targetRate));
    const startOffset = decoded.duration > 45 ? 15 : 0;

    const offline = new OfflineAudioContext(2, targetSamples, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0, startOffset, clipSec);
    const rendered = await offline.startRendering();

    const wavBuf = encodeStereoWav(
      rendered.getChannelData(0),
      rendered.getChannelData(1),
      targetRate
    );
    return {
      base64: uint8ToBase64(wavBuf),
      mimeType: 'audio/wav',
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function runMusicAnalysisTask(params: {
  providerId?: string;
  model?: string;
  track: TrackMetadata;
  analysisType: MusicAnalysisType;
  includeAudioSignal: boolean;
  signal?: AbortSignal;
}): Promise<{
  providerName: string;
  modelUsed: string;
  analyzedFromAudio: boolean;
  result: AudioAnalysisResult;
}> {
  let audioBase64: string | undefined;
  let audioMimeType: string | undefined;

  if (params.includeAudioSignal) {
    const clip = await extractCompactAudioClipBase64(params.track.id);
    if (clip) {
      audioBase64 = clip.base64;
      audioMimeType = clip.mimeType;
    }
  }

  const res = await fetch('/api/ai/tasks/analyze-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: params.providerId,
      model: params.model,
      analysisType: params.analysisType,
      hasAudioClip: Boolean(audioBase64),
      audioBase64,
      audioMimeType,
      trackInfo: {
        title: params.track.title,
        artist: params.track.artist,
        album: params.track.album,
        duration: params.track.duration,
        format: params.track.format,
        sampleRate: params.track.sampleRate,
        bitrate: params.track.bitrate,
        lyricsSnippet: params.track.lyricsRaw?.slice(0, 1200),
      },
    }),
    signal: params.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `AI 音乐分析失败 (${res.status})`);
  }
  return json;
}
