import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createAiRouter } from './server/ai/taskRoutes.ts';
import { getStoredProviderWithKey } from './server/ai/keyVault.ts';
import {
  callProviderTextCompletion,
  extractJsonFromLlmText,
} from './server/ai/providerClient.ts';
import {
  cancelServerStemJob,
  deleteServerStemJob,
  enqueueServerStemJob,
  ensureServerModelCached,
  getServerModelStatus,
  getServerStemDownloadPath,
  getServerStemJob,
  initStemJobQueue,
  listServerStemJobs,
  pauseServerStemJob,
  resumeServerStemJob,
} from './server/ai/stemJobQueue.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('服务端未配置 GEMINI_API_KEY，请在 Secrets 面板配置后重试。');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ParsedSourceLine {
  raw: string;
  timestamps: string[];
  cleanText: string;
  isMeta: boolean;
}

interface TimedLyricEntry {
  timeSec: number;
  tag: string;
  text: string;
}

const LINE_TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME_TAG_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function toSeconds(minStr: string, secStr: string, msStr?: string): number {
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

function parseTimedEntries(lrc: string): TimedLyricEntry[] {
  const entries: TimedLyricEntry[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^\[(ti|ar|al|by|offset|re|ve):/i.test(trimmed)) continue;

    const tags: { tag: string; sec: number }[] = [];
    let m: RegExpExecArray | null;
    LINE_TIME_TAG_RE.lastIndex = 0;
    while ((m = LINE_TIME_TAG_RE.exec(trimmed)) !== null) {
      tags.push({ tag: m[0], sec: toSeconds(m[1], m[2], m[3]) });
    }
    if (tags.length === 0) continue;
    const text = trimmed.replace(LINE_TIME_TAG_RE, '').trim();
    if (!text) continue;

    for (const t of tags) {
      entries.push({ timeSec: t.sec, tag: t.tag, text });
    }
  }
  return entries.sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Merges original LRC with a separate translated LRC (`tlyric`) by matching nearest timestamps.
 */
function mergeOriginalAndTranslatedLrc(origLrc: string, transLrc: string): string {
  const origEntries = parseTimedEntries(origLrc);
  const transEntries = parseTimedEntries(transLrc);
  if (origEntries.length === 0 || transEntries.length === 0) return origLrc;

  const lines: string[] = [];
  let transCursor = 0;

  for (const orig of origEntries) {
    lines.push(`${orig.tag}${orig.text}`);

    while (
      transCursor < transEntries.length &&
      transEntries[transCursor].timeSec < orig.timeSec - 0.35
    ) {
      transCursor++;
    }

    let bestMatch: TimedLyricEntry | null = null;
    let bestDiff = 0.35;
    for (let k = transCursor; k < transEntries.length; k++) {
      const cand = transEntries[k];
      const diff = Math.abs(cand.timeSec - orig.timeSec);
      if (diff <= bestDiff) {
        bestDiff = diff;
        bestMatch = cand;
      }
      if (cand.timeSec > orig.timeSec + 0.35) break;
    }

    if (bestMatch && bestMatch.text && bestMatch.text !== orig.text) {
      lines.push(`${orig.tag}${bestMatch.text}`);
    }
  }

  return lines.join('\n');
}

function parseSourceLines(rawLyrics: string): ParsedSourceLine[] {
  return rawLyrics.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { raw: '', timestamps: [], cleanText: '', isMeta: true };
    }
    if (/^\[(ti|ar|al|by|offset|re|ve):/i.test(trimmed)) {
      return { raw: trimmed, timestamps: [], cleanText: '', isMeta: true };
    }
    const timestamps: string[] = [];
    let m: RegExpExecArray | null;
    LINE_TIME_TAG_RE.lastIndex = 0;
    while ((m = LINE_TIME_TAG_RE.exec(trimmed)) !== null) {
      timestamps.push(m[0]);
    }
    const withoutLineTime = trimmed.replace(LINE_TIME_TAG_RE, '').trim();
    const cleanText = withoutLineTime.replace(WORD_TIME_TAG_RE, '').trim();
    return {
      raw: trimmed,
      timestamps,
      cleanText,
      isMeta: cleanText.length === 0,
    };
  });
}

function isPrimarilyChinese(text: string): boolean {
  const stripped = text.replace(/[\s\p{P}\d]/gu, '');
  if (!stripped) return true;
  const hanMatches = stripped.match(/[\u4e00-\u9fff]/g) || [];
  const kanaMatches = stripped.match(/[\u3040-\u30ff]/g) || [];
  if (kanaMatches.length > 0) return false;
  return hanMatches.length / stripped.length > 0.55;
}

interface UnifiedLyricResult {
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

async function fetchLrclibResults(query: string): Promise<UnifiedLyricResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LUMINA-MUSIC/1.0',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as UnifiedLyricResult[];
    return data.map((item) => ({
      ...item,
      hasNativeTranslation: false,
      source: 'LRCLIB',
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNeteaseResults(query: string): Promise<UnifiedLyricResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(
      query
    )}&type=1&limit=4`;
    const searchRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!searchRes.ok) return [];
    const searchJson = (await searchRes.json()) as {
      result?: {
        songs?: {
          id: number;
          name: string;
          duration: number;
          artists?: { name: string }[];
          album?: { name: string };
        }[];
      };
    };
    const songs = searchJson.result?.songs?.slice(0, 3) || [];
    if (songs.length === 0) return [];

    const lyricPromises = songs.map(async (song): Promise<UnifiedLyricResult | null> => {
      try {
        const lrcUrl = `https://music.163.com/api/song/lyric?id=${song.id}&lv=1&tv=1`;
        const lrcRes = await fetch(lrcUrl, {
          signal: controller.signal,
          headers: {
            Referer: 'https://music.163.com/',
            'User-Agent': 'Mozilla/5.0',
          },
        });
        if (!lrcRes.ok) return null;
        const lrcJson = (await lrcRes.json()) as {
          lrc?: { lyric?: string };
          tlyric?: { lyric?: string };
        };
        const orig = lrcJson.lrc?.lyric?.trim();
        if (!orig) return null;
        const trans = lrcJson.tlyric?.lyric?.trim();
        const hasTrans = Boolean(trans && parseTimedEntries(trans).length > 0);
        const merged = hasTrans && trans ? mergeOriginalAndTranslatedLrc(orig, trans) : orig;
        const isTimed = /\[\d{1,3}:\d{1,2}/.test(merged);

        return {
          id: 900000000 + song.id,
          trackName: song.name,
          artistName: song.artists?.map((a) => a.name).join(' / ') || '',
          albumName: song.album?.name || '',
          duration: Math.round((song.duration || 0) / 1000),
          syncedLyrics: isTimed ? merged : null,
          plainLyrics: isTimed ? null : merged,
          hasNativeTranslation: hasTrans,
          source: hasTrans ? '网易云双语' : '网易云',
        };
      } catch {
        return null;
      }
    });

    const resolved = await Promise.all(lyricPromises);
    return resolved.filter((x): x is UnifiedLyricResult => x !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const TARGET_LANGUAGE_PROMPTS: Record<string, string> = {
  'zh-CN':
    'Simplified Chinese (简体中文). Write deeply poetic, graceful, lyrical Chinese prose—honoring imagery, metaphor, emotional nuance, and rhythmic cadence (信、达、雅). Avoid stiff literal machine translation.',
  'zh-TW':
    'Traditional Chinese (繁體中文). Write deeply poetic, graceful, lyrical Traditional Chinese—honoring imagery, metaphor, emotional nuance, and rhythmic cadence (信、達、雅).',
  en: 'English. Write lyrical, poetic, natural-sounding English lines that preserve the imagery, rhythm, and emotional resonance of the song.',
  ja: 'Japanese (日本語). Write poetic, natural Japanese lyrics preserving emotional subtlety and lyrical imagery.',
};

const STYLE_INSTRUCTIONS: Record<string, string> = {
  poetic:
    '诗意翻译风格：具有诗歌般的美感与韵律（信、达、雅），语言自然优美，保留原歌词的核心意境与情感，绝不要机械逐字硬翻，保持每句行文凝练，适合歌唱韵律。',
  literal:
    '忠实直译风格：尽可能精准保持原文原始含义与句法对应，字词对应准确，不随意添加或省略语义。',
  natural:
    '自然意译风格：完全符合现代中文日常表达与口语听感习惯，通俗自然、流畅亲切、易懂易哼唱。',
  literary:
    '文学翻译风格：注重细腻情感、深远意境与文字修辞表现力，富有文学质感与唯美氛围。',
  bilingual:
    '中英双语对译风格：语言精炼，突出原词精髓与情感对照，适合双语同屏对照。',
};

async function startServer() {
  await initStemJobQueue();
  const app = express();
  const httpServer = http.createServer(app);

  // Serve ONNX Runtime Web WASM & worker modules cleanly from node_modules
  const ortDistDir = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
  app.use(
    '/ort-wasm',
    express.static(ortDistDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        } else if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
        res.setHeader('Cache-Control', 'public, max-age=604800');
      },
    })
  );

  // Model metadata & cached ONNX weights download endpoint (avoids HuggingFace browser CORS)
  app.get('/api/stems/model/status', async (_req, res) => {
    const status = await getServerModelStatus();
    res.json(status);
  });

  app.get('/api/stems/model', async (_req, res) => {
    try {
      const modelPath = await ensureServerModelCached();
      const stat = await fsp.stat(modelPath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(modelPath).pipe(res);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '无法加载 AI 分离模型',
      });
    }
  });

  // Persistent queued server-side AI stem separation endpoints
  app.post(
    '/api/stems/separate',
    express.raw({ type: '*/*', limit: '150mb' }),
    async (req, res) => {
      try {
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          res.status(400).json({ error: '未收到音频文件数据' });
          return;
        }

        const ext = typeof req.query.ext === 'string' ? req.query.ext : 'bin';
        const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
        const sourceTrackId =
          typeof req.query.trackId === 'string' ? req.query.trackId : undefined;
        const sourceTrackTitle =
          typeof req.query.title === 'string' ? req.query.title : undefined;
        const sourceTrackArtist =
          typeof req.query.artist === 'string' ? req.query.artist : undefined;

        const job = await enqueueServerStemJob({
          audioBuffer: body,
          ext,
          taskId,
          sourceTrackId,
          sourceTrackTitle,
          sourceTrackArtist,
        });

        res.json({ jobId: job.id, job });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : '创建分离任务失败',
        });
      }
    }
  );

  app.get('/api/stems/jobs', async (_req, res) => {
    const jobs = await listServerStemJobs();
    res.json({ jobs });
  });

  app.get('/api/stems/job/:jobId', async (req, res) => {
    const job = await getServerStemJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: '分离任务不存在或已过期' });
      return;
    }
    res.json(job);
  });

  app.post('/api/stems/job/:jobId/pause', async (req, res) => {
    const job = await pauseServerStemJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: '分离任务不存在' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.post('/api/stems/job/:jobId/resume', async (req, res) => {
    try {
      const job = await resumeServerStemJob(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: '分离任务不存在' });
        return;
      }
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : '恢复任务失败',
      });
    }
  });

  app.post('/api/stems/job/:jobId/cancel', async (req, res) => {
    const job = await cancelServerStemJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: '分离任务不存在' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.delete('/api/stems/job/:jobId', async (req, res) => {
    const ok = await deleteServerStemJob(req.params.jobId);
    res.json({ ok });
  });

  app.get('/api/stems/job/:jobId/download/:stem', async (req, res) => {
    const targetPath = await getServerStemDownloadPath(
      req.params.jobId,
      req.params.stem
    );
    if (!targetPath) {
      res.status(404).json({ error: '分离音轨尚未就绪或不存在' });
      return;
    }
    const stat = await fsp.stat(targetPath);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(targetPath).pipe(res);
  });

  app.use('/api/ai', createAiRouter());

  app.use(express.json({ limit: '1mb' }));

  // Multi-source lyric search (aggregates native bilingual sources + LRCLIB)
  app.get('/api/lyrics/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.status(400).json({ error: '缺少搜索关键词' });
      return;
    }

    try {
      const [neteaseSettled, lrclibSettled] = await Promise.allSettled([
        fetchNeteaseResults(q),
        fetchLrclibResults(q),
      ]);

      const neteaseList =
        neteaseSettled.status === 'fulfilled' ? neteaseSettled.value : [];
      const lrclibList =
        lrclibSettled.status === 'fulfilled' ? lrclibSettled.value : [];

      const combined = [...neteaseList, ...lrclibList].sort((a, b) => {
        if (a.hasNativeTranslation && !b.hasNativeTranslation) return -1;
        if (!a.hasNativeTranslation && b.hasNativeTranslation) return 1;
        if (a.syncedLyrics && !b.syncedLyrics) return -1;
        if (!a.syncedLyrics && b.syncedLyrics) return 1;
        return 0;
      });

      res.json(combined);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '歌词检索服务暂时不可用',
      });
    }
  });

  // Poetic Gemini translation preserving exact LRC timestamps and word tags
  app.post('/api/lyrics/translate', async (req, res) => {
    try {
      const rawLyrics = typeof req.body?.rawLyrics === 'string' ? req.body.rawLyrics : '';
      const trackTitle = typeof req.body?.trackTitle === 'string' ? req.body.trackTitle : '';
      const artistName = typeof req.body?.artistName === 'string' ? req.body.artistName : '';
      const targetLanguage =
        typeof req.body?.targetLanguage === 'string' &&
        TARGET_LANGUAGE_PROMPTS[req.body.targetLanguage]
          ? req.body.targetLanguage
          : 'zh-CN';

      if (!rawLyrics.trim()) {
        res.status(400).json({ error: '歌词内容为空' });
        return;
      }

      const parsed = parseSourceLines(rawLyrics);
      const translatable: { idx: number; text: string }[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item.isMeta && item.cleanText) {
          translatable.push({ idx: i, text: item.cleanText });
        }
      }

      if (translatable.length === 0) {
        res.json({ bilingualLyrics: rawLyrics, translatedCount: 0, skippedReason: 'no_lines' });
        return;
      }

      let bilingualPairs = 0;
      for (let i = 0; i < parsed.length; i++) {
        if (/\s+\/\/\s+|\s+\|\s+/.test(parsed[i].cleanText)) bilingualPairs++;
        if (
          i > 0 &&
          parsed[i].timestamps.length > 0 &&
          parsed[i - 1].timestamps.length > 0 &&
          parsed[i].timestamps[0] === parsed[i - 1].timestamps[0]
        ) {
          bilingualPairs++;
        }
      }
      if (bilingualPairs >= 3) {
        res.json({
          bilingualLyrics: rawLyrics,
          translatedCount: 0,
          skippedReason: 'already_bilingual',
        });
        return;
      }

      const combinedSample = translatable.map((t) => t.text).join(' ');
      if (
        (targetLanguage === 'zh-CN' || targetLanguage === 'zh-TW') &&
        isPrimarilyChinese(combinedSample)
      ) {
        res.json({
          bilingualLyrics: rawLyrics,
          translatedCount: 0,
          skippedReason: 'already_target_language',
        });
        return;
      }

      const style =
        typeof req.body?.style === 'string' && STYLE_INSTRUCTIONS[req.body.style]
          ? req.body.style
          : 'poetic';
      const providerId =
        typeof req.body?.providerId === 'string' ? req.body.providerId.trim() : '';
      const modelName =
        typeof req.body?.modelName === 'string' ? req.body.modelName.trim() : '';

      const langInstruction = TARGET_LANGUAGE_PROMPTS[targetLanguage];
      const styleInstruction = STYLE_INSTRUCTIONS[style];
      let translations: { idx: number; translation: string }[] = [];

      if (providerId) {
        try {
          const resolved = await getStoredProviderWithKey(providerId);
          if (resolved && resolved.apiKey) {
            const userPrompt = JSON.stringify({
              song: trackTitle,
              artist: artistName,
              targetLanguage,
              style,
              lines: translatable,
            });
            const systemInstruction = `You are an acclaimed literary song lyricist and poetic translator.
Translate the given song lyrics line by line into ${langInstruction}.
Translation style requirement: ${styleInstruction}
Guidelines:
1. Capture the mood, poetic imagery, metaphors, and emotional flow of the entire song—avoid clunky word-for-word literalism.
2. Keep each translated line concise, musical, and singable in cadence so it pairs gracefully beneath the original lyric.
3. Keep recurring chorus lines consistent in phrasing and tone across the whole song.
4. If a line is already in the target language, purely vocalizations ("Ooh", "Ah", "La la la", "Yeah"), or instrumental/credit metadata ("Instrumental", "作曲", "作词"), return an empty string "" for translation.
5. Preserve the exact idx for every item in the input array; never merge or skip indices.
6. Return purely valid JSON array in the format: [{"idx": 0, "translation": "..."}]`;

            const responseText = await callProviderTextCompletion({
              provider: resolved.provider,
              apiKey: resolved.apiKey,
              modelOverride: modelName || resolved.provider.model,
              systemInstruction,
              userPrompt,
              expectJson: true,
            });

            const parsedJson = extractJsonFromLlmText<unknown>(responseText);
            if (Array.isArray(parsedJson)) {
              translations = parsedJson as { idx: number; translation: string }[];
            }
          }
        } catch (providerErr) {
          console.warn('Selected provider translation failed, falling back to Gemini:', providerErr);
        }
      }

      if (!translations || translations.length === 0) {
        const ai = getGeminiClient();
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: JSON.stringify({
            song: trackTitle,
            artist: artistName,
            targetLanguage,
            style,
            lines: translatable,
          }),
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            systemInstruction: `You are an acclaimed literary song lyricist and poetic translator.
Translate the given song lyrics line by line into ${langInstruction}.
Translation style requirement: ${styleInstruction}
Guidelines for poetic beauty:
1. Capture the mood, poetic imagery, metaphors, and emotional flow of the entire song—avoid clunky word-for-word literalism.
2. Keep each translated line concise, musical, and singable in cadence so it pairs gracefully beneath the original lyric.
3. Keep recurring chorus lines consistent in phrasing and tone across the whole song.
4. If a line is already in the target language, purely vocalizations ("Ooh", "Ah", "La la la", "Yeah"), or instrumental/credit metadata ("Instrumental", "作曲", "作词"), return an empty string "" for translation.
5. Preserve the exact idx for every item in the input array; never merge or skip indices.`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  idx: { type: Type.INTEGER },
                  translation: { type: Type.STRING },
                },
                required: ['idx', 'translation'],
              },
            },
          },
        });

        const jsonText = (response.text ?? '[]').trim();
        translations = JSON.parse(jsonText) as { idx: number; translation: string }[];
      }
      const transMap = new Map<number, string>();
      for (const item of translations) {
        if (typeof item.idx === 'number' && typeof item.translation === 'string') {
          transMap.set(item.idx, item.translation.trim());
        }
      }

      const outputLines: string[] = [];
      let translatedCount = 0;

      for (let i = 0; i < parsed.length; i++) {
        const line = parsed[i];
        if (!line.raw) continue;
        if (line.isMeta) {
          outputLines.push(line.raw);
          continue;
        }

        const translated = transMap.get(i);
        if (translated && translated !== line.cleanText) {
          translatedCount++;
          if (line.timestamps.length > 0) {
            outputLines.push(line.raw);
            outputLines.push(`${line.timestamps.join('')}${translated}`);
          } else {
            outputLines.push(`${line.raw} // ${translated}`);
          }
        } else {
          outputLines.push(line.raw);
        }
      }

      res.json({
        bilingualLyrics: outputLines.join('\n'),
        translatedCount,
      });
    } catch (err) {
      console.error('Lyrics translate error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : '歌词翻译失败，请稍后重试',
      });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: !disableHmr,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LUMINA MUSIC server listening on http://0.0.0.0:${PORT}`);
  });
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
