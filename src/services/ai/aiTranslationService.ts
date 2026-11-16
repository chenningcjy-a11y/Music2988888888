import { parseLrc } from '../../utils/lrcParser';

export type LyricTranslationStyle =
  | 'literal'
  | 'natural'
  | 'poetic'
  | 'literary'
  | 'bilingual';

export const LYRIC_TRANSLATION_STYLES: {
  id: LyricTranslationStyle;
  label: string;
  description: string;
}[] = [
  {
    id: 'poetic',
    label: '诗意翻译',
    description: '具有诗歌般美感与韵律，自然优美保留核心情感',
  },
  {
    id: 'natural',
    label: '自然意译',
    description: '符合中文日常表达习惯，通俗流畅亲切',
  },
  {
    id: 'literal',
    label: '忠实直译',
    description: '尽可能忠实保持原文含义与句式结构对应',
  },
  {
    id: 'literary',
    label: '文学翻译',
    description: '注重细腻情感、意境沉淀与文学修辞表现力',
  },
  {
    id: 'bilingual',
    label: '中英双语',
    description: '原文与中文并列互衬，精炼点题',
  },
];

interface TranslateOptions {
  rawLyrics: string;
  trackTitle?: string;
  artistName?: string;
  targetLanguage?: string;
  style?: LyricTranslationStyle;
  providerId?: string;
  modelName?: string;
}

export async function translateLyricsWithAiEngine(
  opts: TranslateOptions
): Promise<{
  bilingualLyrics: string;
  translatedCount: number;
  skippedReason?: string;
}> {
  const res = await fetch('/api/lyrics/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawLyrics: opts.rawLyrics,
      trackTitle: opts.trackTitle,
      artistName: opts.artistName,
      targetLanguage: opts.targetLanguage || 'zh-CN',
      style: opts.style || 'poetic',
      providerId: opts.providerId,
      modelName: opts.modelName,
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload?.error || `AI 歌词翻译失败 (${res.status})`);
  }

  return payload as {
    bilingualLyrics: string;
    translatedCount: number;
    skippedReason?: string;
  };
}
