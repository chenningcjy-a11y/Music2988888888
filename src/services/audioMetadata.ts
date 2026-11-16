import { parseBlob } from 'music-metadata';
import { TrackMetadata } from '../types/music';
import {
  extractPaletteFromImage,
  generateProceduralCover,
  resizeCoverToDataUrl,
} from '../utils/colorExtractor';

const EXTENSION_FORMAT_MAP: Record<string, string> = {
  mp3: 'MP3',
  flac: 'FLAC',
  wav: 'WAV',
  aac: 'AAC',
  m4a: 'M4A',
  ogg: 'OGG',
  opus: 'OPUS',
  webm: 'WEBM',
};

function inferFormat(file: File, container?: string, codec?: string): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (EXTENSION_FORMAT_MAP[ext]) return EXTENSION_FORMAT_MAP[ext];
  if (codec) {
    const c = codec.toUpperCase();
    if (c.includes('FLAC')) return 'FLAC';
    if (c.includes('OPUS')) return 'OPUS';
    if (c.includes('VORBIS')) return 'OGG';
    if (c.includes('AAC')) return 'AAC';
    if (c.includes('ALAC')) return 'ALAC';
    if (c.includes('MPEG') || c.includes('MP3')) return 'MP3';
    if (c.includes('PCM')) return 'WAV';
  }
  if (container) return container.toUpperCase();
  return ext.toUpperCase() || 'AUDIO';
}

function parseFilenameFallback(filename: string): { title: string; artist: string } {
  const clean = filename.replace(/\.[^.]+$/, '').trim();
  const parts = clean.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim(),
    };
  }
  return {
    title: clean || '未命名曲目',
    artist: '未知艺术家',
  };
}

function probeDurationViaAudioElement(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (dur: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

export async function parseAudioFileToTrack(
  file: File,
  importMode: 'lean' | 'full' = 'lean'
): Promise<TrackMetadata> {
  const fallback = parseFilenameFallback(file.name);

  let title = fallback.title;
  let artist = fallback.artist;
  let album = '本地音乐';
  let duration = 0;
  let bitrate: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let channels: number | undefined;
  let container: string | undefined;
  let codec: string | undefined;
  let coverDataUrl: string | undefined;
  let embeddedLyrics: string | undefined;

  try {
    const metadata = await parseBlob(file, { duration: true });
    const { common, format } = metadata;

    if (common.title && common.title.trim()) title = common.title.trim();
    if (common.artist && common.artist.trim()) artist = common.artist.trim();
    else if (common.albumartist && common.albumartist.trim())
      artist = common.albumartist.trim();
    if (common.album && common.album.trim()) album = common.album.trim();

    if (format.duration && Number.isFinite(format.duration)) {
      duration = format.duration;
    }
    if (format.bitrate && Number.isFinite(format.bitrate)) {
      bitrate = Math.round(format.bitrate);
    }
    if (format.sampleRate && Number.isFinite(format.sampleRate)) {
      sampleRate = format.sampleRate;
    }
    if (format.bitsPerSample && Number.isFinite(format.bitsPerSample)) {
      bitsPerSample = format.bitsPerSample;
    }
    if (format.numberOfChannels && Number.isFinite(format.numberOfChannels)) {
      channels = format.numberOfChannels;
    }
    container = format.container;
    codec = format.codec;

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const bytes = new Uint8Array(pic.data);
      const picBlob = new Blob([bytes], { type: pic.format || 'image/jpeg' });
      try {
        coverDataUrl = await resizeCoverToDataUrl(picBlob);
      } catch {
        // Fallback if resize fails
      }
    }

    if (importMode === 'full' && common.lyrics && common.lyrics.length > 0) {
      const firstLyric = common.lyrics[0] as unknown;
      if (typeof firstLyric === 'string') {
        embeddedLyrics = firstLyric;
      } else if (
        firstLyric &&
        typeof firstLyric === 'object' &&
        'text' in firstLyric &&
        typeof (firstLyric as { text?: unknown }).text === 'string'
      ) {
        embeddedLyrics = (firstLyric as { text: string }).text;
      }
    }
  } catch (err) {
    console.warn('music-metadata parse warning:', err);
  }

  if (!duration || duration <= 0) {
    duration = await probeDurationViaAudioElement(file);
  }

  // Estimate bitrate honestly only if missing and duration > 0
  if (!bitrate && duration > 0 && file.size > 0) {
    bitrate = Math.round((file.size * 8) / duration);
  }

  if (!coverDataUrl) {
    coverDataUrl = generateProceduralCover(title, artist);
  }

  const palette = await extractPaletteFromImage(coverDataUrl);
  const formatLabel = inferFormat(file, container, codec);

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `trk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    artist,
    album,
    duration,
    format: formatLabel,
    mimeType: file.type || 'audio/mpeg',
    fileSize: file.size,
    bitrate,
    sampleRate,
    bitsPerSample,
    channels,
    coverDataUrl,
    palette,
    favorite: false,
    lyricsRaw: embeddedLyrics,
    lyricsOffsetMs: 0,
    addedAt: Date.now(),
    isDemo: false,
  };
}
