export type LyricsAiAction =
  | 'translate'
  | 'detect-language'
  | 'proofread'
  | 'explain'
  | 'timeline-align';

export interface LyricsAiResponse {
  action: LyricsAiAction;
  providerName: string;
  modelUsed: string;
  isTimedLrc: boolean;
  hasWordTags?: boolean;
  bilingualLyrics?: string;
  correctedLyrics?: string;
  changes?: string[];
  summary?: string;
  result?: Record<string, unknown>;
}

export async function runLyricsAiTask(params: {
  providerId?: string;
  model?: string;
  action: LyricsAiAction;
  rawLyrics: string;
  trackTitle: string;
  artistName: string;
  targetLanguage?: 'zh-CN' | 'zh-TW' | 'en' | 'ja';
  durationSec?: number;
  signal?: AbortSignal;
}): Promise<LyricsAiResponse> {
  const res = await fetch('/api/ai/tasks/lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: params.providerId,
      model: params.model,
      action: params.action,
      rawLyrics: params.rawLyrics,
      trackTitle: params.trackTitle,
      artistName: params.artistName,
      targetLanguage: params.targetLanguage || 'zh-CN',
      durationSec: params.durationSec,
    }),
    signal: params.signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `AI 歌词任务失败 (${res.status})`);
  }
  return json as LyricsAiResponse;
}
