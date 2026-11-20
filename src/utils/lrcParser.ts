import { LyricLine, LyricWord } from '../types/music';

const LINE_TIME_REGEX = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME_REGEX = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function parseTimestamp(minStr: string, secStr: string, msStr?: string): number {
  const min = parseInt(minStr, 10) || 0;
  const sec = parseInt(secStr, 10) || 0;
  let ms = 0;
  if (msStr) {
    if (msStr.length === 1) ms = parseInt(msStr, 10) * 100;
    else if (msStr.length === 2) ms = parseInt(msStr, 10) * 10;
    else ms = parseInt(msStr.slice(0, 3), 10);
  }
  return min * 60 + sec + ms / 1000;
}

/**
 * Splits a single lyric line into primary text & secondary translation if formatted
 * with explicit bilingual delimiters (`//`, `|`, `／`, or trailing `【译文】`).
 */
export function splitInlineBilingual(rawText: string): {
  primary: string;
  translation?: string;
} {
  const trimmed = rawText.trim();

  // Pattern 1: "Original // Translation" or "Original | Translation" or "Original ／ Translation"
  const sepMatch = trimmed.split(/\s+\/\/\s+|\s+\|\s+|\s+／\s+/);
  if (sepMatch.length === 2 && sepMatch[0].trim() && sepMatch[1].trim()) {
    return {
      primary: sepMatch[0].trim(),
      translation: sepMatch[1].trim(),
    };
  }

  // Pattern 2: "Original text【中文翻译】"
  const bracketMatch = trimmed.match(/^(.+?)\s*【([^】]+)】$/);
  if (bracketMatch && bracketMatch[1].trim() && bracketMatch[2].trim()) {
    return {
      primary: bracketMatch[1].trim(),
      translation: bracketMatch[2].trim(),
    };
  }

  return { primary: trimmed };
}

/**
 * Parses standard LRC, multi-source bilingual LRC (dual-line matching timestamps,
 * slight offset alignment <= 0.12s, or inline separators), and enhanced word-level LRC (`<mm:ss.xx>word`).
 * Strictly NEVER fabricates word-level timestamps when none exist.
 */
export function parseLrc(raw?: string): {
  lines: LyricLine[];
  hasSyncedTimestamps: boolean;
  hasWordTimestamps: boolean;
  hasTranslations: boolean;
} {
  if (!raw || !raw.trim()) {
    return {
      lines: [],
      hasSyncedTimestamps: false,
      hasWordTimestamps: false,
      hasTranslations: false,
    };
  }

  const rawLines = raw.split(/\r?\n/);
  const parsedEntries: {
    time: number;
    text: string;
    words?: LyricWord[];
  }[] = [];

  let anyWordTimestamps = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata tags like [ti:...], [ar:...], [al:...], [offset:...]
    if (/^\[(ti|ar|al|by|offset|re|ve):/i.test(trimmed)) continue;

    const times: number[] = [];
    let match: RegExpExecArray | null;
    LINE_TIME_REGEX.lastIndex = 0;
    while ((match = LINE_TIME_REGEX.exec(trimmed)) !== null) {
      times.push(parseTimestamp(match[1], match[2], match[3]));
    }

    if (times.length === 0) continue;

    const content = trimmed.replace(LINE_TIME_REGEX, '').trim();
    if (!content) continue;

    // Check for genuine enhanced LRC word timestamps: <mm:ss.xx>
    let words: LyricWord[] | undefined;
    WORD_TIME_REGEX.lastIndex = 0;
    const wordMatches = [...content.matchAll(WORD_TIME_REGEX)];
    if (wordMatches.length > 0) {
      anyWordTimestamps = true;
      words = [];
      for (let i = 0; i < wordMatches.length; i++) {
        const wm = wordMatches[i];
        const wTime = parseTimestamp(wm[1], wm[2], wm[3]);
        const startIdx = (wm.index ?? 0) + wm[0].length;
        const endIdx =
          i + 1 < wordMatches.length
            ? (wordMatches[i + 1].index ?? content.length)
            : content.length;
        const wText = content.slice(startIdx, endIdx);
        if (wText.length > 0) {
          words.push({ time: wTime, text: wText });
        }
      }
    }

    const cleanText = content.replace(WORD_TIME_REGEX, '').trim();
    for (const t of times) {
      parsedEntries.push({
        time: t,
        text: cleanText,
        words: words && words.length > 0 ? words : undefined,
      });
    }
  }

  // If no LRC timestamps were found, treat as plain unsynced text lines
  if (parsedEntries.length === 0) {
    const plainLines = rawLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
    let anyPlainTrans = false;
    const mapped = plainLines.map((line, idx) => {
      const { primary, translation } = splitInlineBilingual(line);
      if (translation) anyPlainTrans = true;
      return {
        id: `plain-${idx}`,
        time: -1,
        text: primary,
        translation,
      };
    });
    return {
      lines: mapped,
      hasSyncedTimestamps: false,
      hasWordTimestamps: false,
      hasTranslations: anyPlainTrans,
    };
  }

  // Sort chronologically (preserving original line order on equal timestamps)
  parsedEntries.sort((a, b) => a.time - b.time);

  // Merge same-timestamp or closely aligned (<= 0.12s) dual lines into primary + translation
  const merged: LyricLine[] = [];
  let anyTranslations = false;

  for (const entry of parsedEntries) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.time - entry.time) <= 0.12 &&
      !prev.translation &&
      entry.text !== prev.text
    ) {
      prev.translation = entry.text;
      anyTranslations = true;
      continue;
    }

    if (!entry.words) {
      const { primary, translation } = splitInlineBilingual(entry.text);
      if (translation) anyTranslations = true;
      merged.push({
        id: `lrc-${merged.length}-${entry.time.toFixed(3)}`,
        time: entry.time,
        text: primary,
        translation,
      });
    } else {
      // Preserve word-level timestamps on primary text; check if inline ` // ` split exists
      const splitIdx = entry.text.indexOf(' // ');
      if (splitIdx !== -1) {
        anyTranslations = true;
        merged.push({
          id: `lrc-${merged.length}-${entry.time.toFixed(3)}`,
          time: entry.time,
          text: entry.text.slice(0, splitIdx).trim(),
          translation: entry.text.slice(splitIdx + 4).trim(),
          words: entry.words,
        });
      } else {
        merged.push({
          id: `lrc-${merged.length}-${entry.time.toFixed(3)}`,
          time: entry.time,
          text: entry.text,
          words: entry.words,
        });
      }
    }
  }

  return {
    lines: merged,
    hasSyncedTimestamps: true,
    hasWordTimestamps: anyWordTimestamps,
    hasTranslations: anyTranslations,
  };
}

export function findActiveLyricIndex(
  lines: LyricLine[],
  currentTimeSec: number,
  offsetMs: number
): number {
  if (lines.length === 0 || lines[0].time < 0) return -1;
  const effectiveTime = currentTimeSec + offsetMs / 1000;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= effectiveTime + 0.02) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export interface OnlineLyricResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  hasNativeTranslation?: boolean;
  source?: string;
}

export type LyricTargetLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja';

/**
 * Searches multi-source online LRC lyrics (Native bilingual NetEase tlyric + LRCLIB).
 */
export async function searchOnlineLyrics(
  title: string,
  artist: string
): Promise<OnlineLyricResult[]> {
  const cleanTitle = title.replace(/\.[^.]+$/, '').trim();
  const cleanArtist =
    artist && artist !== '未知艺术家' && artist !== 'Unknown Artist' ? artist.trim() : '';

  const query = [cleanTitle, cleanArtist].filter(Boolean).join(' ');
  if (!query) return [];

  let data: OnlineLyricResult[];
  const apiRes = await fetch(`/api/lyrics/search?q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
  });

  if (apiRes.ok) {
    data = (await apiRes.json()) as OnlineLyricResult[];
  } else {
    // Fallback to direct LRCLIB endpoint if backend route unavailable
    const directRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!directRes.ok) {
      throw new Error(`歌词检索请求失败 (${directRes.status})`);
    }
    data = (await directRes.json()) as OnlineLyricResult[];
  }

  return data.sort((a, b) => {
    if (a.hasNativeTranslation && !b.hasNativeTranslation) return -1;
    if (!a.hasNativeTranslation && b.hasNativeTranslation) return 1;
    if (a.syncedLyrics && !b.syncedLyrics) return -1;
    if (!a.syncedLyrics && b.syncedLyrics) return 1;
    return 0;
  });
}

export async function translateLyricsToBilingual(
  rawLyrics: string,
  trackTitle?: string,
  artistName?: string,
  targetLanguage: LyricTargetLanguage = 'zh-CN',
  style: string = 'poetic',
  providerId?: string,
  modelName?: string
): Promise<{
  bilingualLyrics: string;
  translatedCount: number;
  skippedReason?: string;
  providerName?: string;
  modelUsed?: string;
}> {
  const res = await fetch('/api/lyrics/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawLyrics,
      trackTitle,
      artistName,
      targetLanguage,
      style,
      providerId,
      modelName,
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload?.error || `歌词翻译失败 (${res.status})`);
  }

  return payload as {
    bilingualLyrics: string;
    translatedCount: number;
    skippedReason?: string;
    providerName?: string;
    modelUsed?: string;
  };
}
