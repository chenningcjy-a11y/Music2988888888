import express, { Router } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  clearProviderKey,
  deleteProvider,
  deleteStemService,
  getActiveStemServiceWithKey,
  getStoredProviderWithKey,
  listPublicProviders,
  listPublicStemServices,
  recordStemServiceProbeResult,
  setActiveStemService,
  setDefaultProvider,
  upsertProvider,
  upsertStemService,
} from './keyVault.ts';
import {
  callProviderTextCompletion,
  extractJsonFromLlmText,
  fetchModelsFromProvider,
  inferModelCapabilities,
  testProviderConnection,
} from './providerClient.ts';

function joinBaseAndPath(baseUrl: string, endpointPath: string): string {
  const b = (baseUrl || '').trim().replace(/\/+$/, '');
  const p = (endpointPath || '/separate').trim();
  if (!b) return '';
  return p.startsWith('/') ? `${b}${p}` : `${b}/${p}`;
}

export function createAiRouter(): Router {
  const router = Router();

  // Remote stem separation proxy (accepts raw audio binary, forwards multipart to configured remote Demucs/Spleeter server)
  router.post(
    '/stem-remote/separate',
    express.raw({ type: '*/*', limit: '150mb' }),
    async (req, res) => {
      try {
        const active = await getActiveStemServiceWithKey();
        if (!active || !active.service.enabled || active.service.kind === 'none') {
          res.status(400).json({
            error:
              '尚未配置或启用独立音源分离服务。请前往「设置 → AI 智能中心 → API 服务管理」配置内置模型或外部 Demucs 服务。',
          });
          return;
        }
        if (active.service.kind === 'builtin-mdx') {
          res.status(400).json({
            error: '当前激活的是内置 UVR MDX-Net 引擎，请直接调用 /api/stems/separate 或本地推理。',
          });
          return;
        }

        const targetUrl = joinBaseAndPath(
          active.service.baseUrl,
          active.service.endpointPath
        );
        if (!targetUrl) {
          res.status(400).json({ error: '外部音源分离服务的 Base URL 不能为空' });
          return;
        }

        const audioBuf = req.body as Buffer;
        if (!Buffer.isBuffer(audioBuf) || audioBuf.length === 0) {
          res.status(400).json({ error: '未收到音频文件数据' });
          return;
        }

        const filename =
          typeof req.query.filename === 'string'
            ? req.query.filename.slice(0, 120)
            : 'audio.wav';

        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(audioBuf)], { type: 'application/octet-stream' }),
          filename
        );

        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(new Error('外部分离服务请求超时')),
          active.service.timeoutMs || 180000
        );

        try {
          const headers: Record<string, string> = {};
          if (active.apiKey) {
            headers.Authorization = `Bearer ${active.apiKey}`;
          }
          const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: form,
            signal: controller.signal,
          });
          if (!upstream.ok) {
            const errTxt = await upstream.text().catch(() => '');
            res.status(upstream.status).json({
              error: `外部分离服务返回错误 (${upstream.status}): ${errTxt.slice(0, 200)}`,
            });
            return;
          }

          const json = (await upstream.json()) as {
            vocalBase64?: string;
            instrumentalBase64?: string;
            vocalUrl?: string;
            instrumentalUrl?: string;
            error?: string;
          };

          if (json.error) {
            res.status(502).json({ error: json.error });
            return;
          }

          let vocalBase64 = json.vocalBase64;
          let instrumentalBase64 = json.instrumentalBase64;

          if ((!vocalBase64 || !instrumentalBase64) && json.vocalUrl && json.instrumentalUrl) {
            const [vRes, iRes] = await Promise.all([
              fetch(json.vocalUrl, { headers, signal: controller.signal }),
              fetch(json.instrumentalUrl, { headers, signal: controller.signal }),
            ]);
            if (!vRes.ok || !iRes.ok) {
              res.status(502).json({ error: '从外部分离服务下载分轨音频失败' });
              return;
            }
            const [vBuf, iBuf] = await Promise.all([
              vRes.arrayBuffer(),
              iRes.arrayBuffer(),
            ]);
            vocalBase64 = Buffer.from(vBuf).toString('base64');
            instrumentalBase64 = Buffer.from(iBuf).toString('base64');
          }

          if (!vocalBase64 || !instrumentalBase64) {
            res.status(502).json({
              error:
                '外部分离服务响应缺少 vocalBase64 / instrumentalBase64 或 vocalUrl / instrumentalUrl 字段',
            });
            return;
          }

          res.json({
            vocalBase64,
            instrumentalBase64,
            serviceName: active.service.name,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : '调用外部音源分离服务失败',
        });
      }
    }
  );

  // JSON body parser for all other /api/ai/* routes (supports up to 18mb for inline audio clip analysis)
  router.use(express.json({ limit: '18mb' }));

  // 1. Provider & Key Management
  router.get('/providers', async (_req, res) => {
    try {
      const data = await listPublicProviders();
      res.json({
        ...data,
        builtinGeminiAvailable: Boolean(process.env.GEMINI_API_KEY),
        builtinGeminiModels: process.env.GEMINI_API_KEY
          ? [
              '__builtin_auto_ensemble__',
              'gemini-3.1-flash-lite::minimal',
              'gemini-3.1-flash-lite::medium',
              'gemini-3.1-flash-lite::high',
              'gemini-4-hydrogen::low',
              'gemini-4-hydrogen::medium',
              'gemini-4-hydrogen::high',
              'gemini-4-hydrogen::xhigh',
            ]
          : [],
        securityMode: 'backend-encrypted-proxy',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '读取 AI 服务配置失败',
      });
    }
  });

  router.post('/providers', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.kind || !body.baseUrl) {
        res.status(400).json({ error: '请填写服务商类型与 API Base URL' });
        return;
      }
      const result = await upsertProvider({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : 'AI 服务',
        kind: body.kind,
        baseUrl: body.baseUrl,
        model: typeof body.model === 'string' ? body.model : '',
        availableModels: Array.isArray(body.availableModels)
          ? body.availableModels
          : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
        timeoutMs: Number(body.timeoutMs) || 30000,
        maxRequestsPerDay: Number(body.maxRequestsPerDay) || 0,
        customHeadersJson:
          typeof body.customHeadersJson === 'string'
            ? body.customHeadersJson
            : undefined,
        setAsDefault: Boolean(body.setAsDefault),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '保存 AI 服务商配置失败',
      });
    }
  });

  router.delete('/providers/:id', async (req, res) => {
    const ok = await deleteProvider(req.params.id);
    if (!ok) {
      res.status(404).json({ error: '未找到指定服务商' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/providers/:id/key', async (req, res) => {
    const updated = await clearProviderKey(req.params.id);
    if (!updated) {
      res.status(404).json({ error: '未找到指定服务商' });
      return;
    }
    res.json({ provider: updated });
  });

  router.post('/providers/:id/default', async (req, res) => {
    const ok = await setDefaultProvider(req.params.id);
    if (!ok) {
      res.status(404).json({ error: '未找到指定服务商' });
      return;
    }
    res.json({ ok: true, defaultProviderId: req.params.id });
  });

  router.post('/providers/:id/test', async (req, res) => {
    try {
      const result = await testProviderConnection(req.params.id);
      const list = await listPublicProviders();
      const updated = list.providers.find((p) => p.id === req.params.id);
      res.json({ ...result, provider: updated });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : '连接测试失败',
      });
    }
  });

  router.get('/providers/:id/models', async (req, res) => {
    try {
      const result = await fetchModelsFromProvider(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : '获取模型列表失败',
      });
    }
  });

  // 2. Independent Stem Separation Service Management
  router.get('/stem-services', async (_req, res) => {
    const data = await listPublicStemServices();
    res.json(data);
  });

  router.post('/stem-services', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await upsertStemService({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : '音源分离服务',
        kind: body.kind || 'remote-demucs-http',
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
        endpointPath:
          typeof body.endpointPath === 'string' ? body.endpointPath : '/separate',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        clearKey: Boolean(body.clearKey),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
        timeoutMs: Number(body.timeoutMs) || 180000,
        setActive: Boolean(body.setActive),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '保存音源分离服务失败',
      });
    }
  });

  router.post('/stem-services/active', async (req, res) => {
    const serviceId =
      req.body?.serviceId === null || typeof req.body?.serviceId === 'string'
        ? req.body.serviceId
        : null;
    const ok = await setActiveStemService(serviceId);
    if (!ok) {
      res.status(404).json({ error: '未找到指定音源分离服务' });
      return;
    }
    res.json({ ok: true, activeStemServiceId: serviceId });
  });

  router.delete('/stem-services/:id', async (req, res) => {
    const ok = await deleteStemService(req.params.id);
    if (!ok) {
      res.status(400).json({ error: '无法删除内置分离服务或服务不存在' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/stem-services/:id/test', async (req, res) => {
    const list = await listPublicStemServices();
    const target = list.services.find((s) => s.id === req.params.id);
    if (!target) {
      res.status(404).json({ ok: false, error: '未找到指定音源分离服务' });
      return;
    }
    if (target.kind === 'builtin-mdx') {
      const updated = await recordStemServiceProbeResult(target.id, {
        status: 'connected',
      });
      res.json({
        ok: true,
        message: '内置 UVR MDX-Net (Kim_Vocal_2) 推理服务就绪',
        service: updated,
      });
      return;
    }
    if (!target.baseUrl) {
      const updated = await recordStemServiceProbeResult(target.id, {
        status: 'error',
        error: '请先填写外部 Demucs / Spleeter 服务的 Base URL',
      });
      res.json({ ok: false, error: updated?.lastError, service: updated });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const probeUrl = target.baseUrl.replace(/\/+$/, '');
      const resp = await fetch(probeUrl, { method: 'GET', signal: controller.signal });
      if (resp.status >= 500) {
        throw new Error(`服务响应异常 (HTTP ${resp.status})`);
      }
      const updated = await recordStemServiceProbeResult(target.id, {
        status: 'connected',
      });
      res.json({
        ok: true,
        message: `已连接至分离服务 (HTTP ${resp.status})`,
        service: updated,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '无法连接外部音源分离服务';
      const updated = await recordStemServiceProbeResult(target.id, {
        status: 'error',
        error: errMsg,
      });
      res.json({ ok: false, error: errMsg, service: updated });
    } finally {
      clearTimeout(timer);
    }
  });

  // 3. AI Lyrics Assistant Task Proxy
  router.post('/tasks/lyrics', async (req, res) => {
    try {
      const {
        providerId,
        model,
        action,
        rawLyrics,
        trackTitle,
        artistName,
        targetLanguage = 'zh-CN',
        durationSec,
      } = req.body || {};

      const resolved = await getStoredProviderWithKey(providerId);
      if (!resolved) {
        res.status(400).json({
          error: '尚未配置可用 AI 服务商，请先前往「API 服务管理」添加并启用服务商及 API Key。',
        });
        return;
      }

      const { provider, apiKey } = resolved;
      const effectiveModel = model || provider.model;
      const caps = inferModelCapabilities(provider.kind, effectiveModel);
      if (!caps.lyricsProcessing) {
        res.status(400).json({
          error: `模型「${effectiveModel}」不支持歌词文本处理，请选择对话/文本推理模型。`,
        });
        return;
      }

      if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
        res.status(400).json({ error: '当前歌曲暂无歌词文本可供处理' });
        return;
      }

      const hasTimestamps = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(rawLyrics);
      const hasWordTags = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(rawLyrics);

      if (action === 'translate') {
        const systemInstruction = `You are an acclaimed literary song lyricist and poetic translator.
Translate the given lyrics gracefully into ${
          targetLanguage === 'zh-TW'
            ? 'Traditional Chinese (繁體中文)'
            : targetLanguage === 'en'
            ? 'English'
            : targetLanguage === 'ja'
            ? 'Japanese'
            : 'Simplified Chinese (简体中文)'
        }.
CRITICAL RULES:
1. If the input contains LRC timestamps like [mm:ss.xx], preserve EVERY timestamp line verbatim and insert a paired translation line right beneath it with the SAME timestamp, OR keep existing format intact. NEVER invent or fabricate new word-level <mm:ss.xx> tags!
2. If the input is plain text without timestamps, output plain bilingual lines (original line followed by translated line, or "原文 // 译文") and NEVER fabricate fake timestamps.
3. Return strictly valid JSON: {"bilingualLyrics": string, "summary": string, "isTimedLrc": boolean}`;

        const raw = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction,
          userPrompt: JSON.stringify({
            song: trackTitle || '',
            artist: artistName || '',
            isTimedLrc: hasTimestamps,
            rawLyrics,
          }),
          expectJson: true,
        });

        const parsed = extractJsonFromLlmText<{
          bilingualLyrics: string;
          summary?: string;
        }>(raw);

        res.json({
          action,
          providerName: provider.name,
          modelUsed: effectiveModel,
          isTimedLrc: hasTimestamps,
          hasWordTags,
          bilingualLyrics: parsed.bilingualLyrics || rawLyrics,
          summary: parsed.summary || '已完成诗意双语翻译',
        });
        return;
      }

      if (action === 'detect-language') {
        const raw = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction:
            'Identify the languages and script distribution in the lyrics. Return JSON: {"primaryLanguage": string, "secondaryLanguages": string[], "hasBilingualContent": boolean, "formatType": "lrc-word"|"lrc-line"|"plain-text", "notes": string}. Write notes in Simplified Chinese.',
          userPrompt: rawLyrics,
          expectJson: true,
        });
        const parsed = extractJsonFromLlmText<Record<string, unknown>>(raw);
        res.json({
          action,
          providerName: provider.name,
          modelUsed: effectiveModel,
          isTimedLrc: hasTimestamps,
          hasWordTags,
          result: parsed,
        });
        return;
      }

      if (action === 'proofread') {
        const raw = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction: `Proofread the lyrics for obvious OCR/typo mistakes, broken punctuation, or formatting inconsistencies.
CRITICAL: NEVER alter, shift, or invent [mm:ss.xx] or <mm:ss.xx> timestamps! If input is plain text, do NOT add timestamps.
Return JSON: {"correctedLyrics": string, "changes": string[], "summary": string}. Respond in Simplified Chinese.`,
          userPrompt: JSON.stringify({
            song: trackTitle || '',
            artist: artistName || '',
            isTimedLrc: hasTimestamps,
            rawLyrics,
          }),
          expectJson: true,
        });
        const parsed = extractJsonFromLlmText<{
          correctedLyrics: string;
          changes?: string[];
          summary?: string;
        }>(raw);
        res.json({
          action,
          providerName: provider.name,
          modelUsed: effectiveModel,
          isTimedLrc: hasTimestamps,
          correctedLyrics: parsed.correctedLyrics || rawLyrics,
          changes: parsed.changes || [],
          summary: parsed.summary || '歌词校对完成',
        });
        return;
      }

      if (action === 'explain') {
        const raw = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction:
            'You are a literary music critic. Explain the poetic imagery, emotional arc, metaphors, and core theme of these lyrics in refined Simplified Chinese. Return JSON: {"theme": string, "imagery": string[], "emotionalArc": string, "highlights": [{"line": string, "meaning": string}]}',
          userPrompt: JSON.stringify({
            song: trackTitle || '',
            artist: artistName || '',
            rawLyrics,
          }),
          expectJson: true,
        });
        const parsed = extractJsonFromLlmText<Record<string, unknown>>(raw);
        res.json({
          action,
          providerName: provider.name,
          modelUsed: effectiveModel,
          isTimedLrc: hasTimestamps,
          result: parsed,
        });
        return;
      }

      if (action === 'timeline-align') {
        const raw = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction: `Analyze the LRC timeline integrity of the provided lyrics (given track duration ${
            durationSec || 'unknown'
          } seconds).
STRICT INTEGRITY RULE:
- Do NOT invent or fabricate word-level <mm:ss.xx> timestamps.
- If the input is plain text without timestamps, clearly report that plain text lacks timing markers and recommend importing an LRC source or marking lines manually in the Lyrics Editor while listening; you may suggest an estimated overall offsetMs ONLY if timestamps already exist and show obvious global drift or negative/exceeding-duration anomalies.
Return JSON: {"isTimedLrc": boolean, "hasWordSync": boolean, "issues": string[], "recommendedOffsetMs": number, "advice": string}. Respond in Simplified Chinese.`,
          userPrompt: JSON.stringify({
            song: trackTitle || '',
            durationSec,
            isTimedLrc: hasTimestamps,
            hasWordTags,
            rawLyrics,
          }),
          expectJson: true,
        });
        const parsed = extractJsonFromLlmText<Record<string, unknown>>(raw);
        res.json({
          action,
          providerName: provider.name,
          modelUsed: effectiveModel,
          isTimedLrc: hasTimestamps,
          hasWordTags,
          result: parsed,
        });
        return;
      }

      res.status(400).json({ error: `不支持的歌词任务类型: ${String(action)}` });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI 歌词任务处理失败',
      });
    }
  });

  // 4. AI Smart Tuning (DSP Plan) Proxy
  router.post('/tasks/dsp-plan', async (req, res) => {
    try {
      const {
        providerId,
        model,
        instruction,
        currentSettings,
        trackInfo,
        hasSeparatedStems,
      } = req.body || {};

      if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
        res.status(400).json({ error: '请输入自然语言调音指令' });
        return;
      }

      const resolved = await getStoredProviderWithKey(providerId);
      if (!resolved) {
        res.status(400).json({
          error: '尚未配置可用 AI 服务商，请先前往「API 服务管理」配置并启用 API Key。',
        });
        return;
      }

      const { provider, apiKey } = resolved;
      const effectiveModel = model || provider.model;

      const systemInstruction = `You are LUMINA MUSIC's professional Web Audio DSP mastering engineer.
Translate the user's natural-language tuning instruction into a precise, valid JSON patch for the real AudioDspSettings engine.

Available AudioDspSettings fields & valid ranges:
- masterEnabled: boolean
- qualityMode: "original" | "high" | "lossless" | "auto"
- eqPreset: "标准" | "流行" | "摇滚" | "古典" | "爵士" | "电子" | "人声增强" | "低音增强" | "自定义"
- eqGains: array of 7 numbers in [-12, 12] dB corresponding to [60Hz, 150Hz, 400Hz, 1kHz, 2.4kHz, 6kHz, 15kHz]
- bassBoost: number in [0, 12] dB
- trebleBoost: number in [0, 12] dB
- vocalEnhance: number in [0, 10] dB (2.8kHz vocal clarity peaking boost)
- reverbMix: number in [0, 100] % (spatial convolution reverb)
- stereoWidth: number in [0, 100] % (50 is neutral natural stereo)
- surroundEnabled: boolean
- surroundWidth: number in [0, 100]
- surroundIntensity: number in [0, 100]
- headphoneOptimize: boolean
- loudnessNormalization: boolean
- stemModeActive: boolean (ONLY set true if hasSeparatedStems === true!)
- vocalGain: number in [0, 200] % (effective when stemModeActive is true)
- instrumentalGain: number in [0, 200] % (effective when stemModeActive is true)
- vocalAccompanimentBalance: number in [-100, 100] (ONLY used when hasSeparatedStems === false as fallback M/S vocal vs background balance: +val lowers background, -val lowers center vocal)

CRITICAL HONESTY RULES:
1. If user asks to independently adjust vocal vs accompaniment volume (e.g. "让人声更加清晰，降低伴奏音量") AND hasSeparatedStems is true: set stemModeActive: true and tune vocalGain / instrumentalGain directly (0..200).
2. If hasSeparatedStems is false and user asks to lower accompaniment/increase vocal: you may combine vocalEnhance + moderate positive vocalAccompanimentBalance OR EQ midrange clarity, AND set "suggestStemSeparation": true so the UI recommends running real AI stem separation! Never claim EQ alone achieves true AI stem separation.
3. Always ensure masterEnabled: true and qualityMode !== "original" if applying DSP changes.
4. Only include fields that should change inside "patch".
5. Return strictly valid JSON:
{
  "explanation": string (clear Simplified Chinese explanation of what will change and why),
  "patch": { ... },
  "suggestStemSeparation": boolean,
  "warnings": string[]
}`;

      const raw = await callProviderTextCompletion({
        provider,
        apiKey,
        modelOverride: effectiveModel,
        systemInstruction,
        userPrompt: JSON.stringify({
          instruction: instruction.trim(),
          hasSeparatedStems: Boolean(hasSeparatedStems),
          trackInfo: trackInfo || {},
          currentSettings: currentSettings || {},
        }),
        expectJson: true,
      });

      const parsed = extractJsonFromLlmText<{
        explanation?: string;
        patch?: Record<string, unknown>;
        suggestStemSeparation?: boolean;
        warnings?: string[];
      }>(raw);

      res.json({
        providerName: provider.name,
        modelUsed: effectiveModel,
        explanation: parsed.explanation || '已根据指令生成音效调整建议',
        patch: parsed.patch || {},
        suggestStemSeparation: Boolean(parsed.suggestStemSeparation),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '生成智能调音方案失败',
      });
    }
  });

  // 5. AI Music Analysis (enforces strict multimodal capability check for audio-signal tasks)
  router.post('/tasks/analyze-audio', async (req, res) => {
    try {
      const {
        providerId,
        model,
        analysisType = 'comprehensive',
        trackInfo,
        audioBase64,
        audioMimeType,
        hasAudioClip,
      } = req.body || {};

      const resolved = await getStoredProviderWithKey(providerId);
      if (!resolved) {
        res.status(400).json({
          error: '尚未配置可用 AI 服务商，请先前往「API 服务管理」配置服务商与 API Key。',
        });
        return;
      }

      const { provider, apiKey } = resolved;
      const effectiveModel = model || provider.model;
      const caps = inferModelCapabilities(provider.kind, effectiveModel);

      const requiresAudioSignal =
        analysisType === 'instruments' || analysisType === 'rhythm-audio';

      if (requiresAudioSignal && !caps.audioInputAnalysis) {
        res.status(400).json({
          error: `模型「${effectiveModel}」(${provider.name}) 为纯文本模型，无法直接接收并听辨音频波形来识别真实乐器或音频节拍。请切换为支持音频输入的多模态模型（如 Google Gemini）后再执行此项分析。`,
          capabilityError: true,
        });
        return;
      }

      if (requiresAudioSignal && (!audioBase64 || !audioMimeType)) {
        res.status(400).json({
          error: '未获取到音频采样片段，无法执行基于真实音频信号的乐器与节奏分析。',
        });
        return;
      }

      const usingRealAudio = Boolean(
        caps.audioInputAnalysis && audioBase64 && audioMimeType
      );

      const systemInstruction = `You are a professional musicologist and audio analyst.
${
  usingRealAudio
    ? 'You have been provided with an actual audio recording segment alongside track metadata. Base instrument recognition, rhythm/BPM feel, timbre, and sonic character directly on what you hear in the audio.'
    : 'You are provided ONLY with track metadata and lyrics (no audio stream). Analyze song style, mood, background, and curation insights based strictly on the provided metadata/lyrics—do NOT claim to have listened to the audio waveform or hallucinate exact audio-only instrument mixes.'
}
Return strictly valid JSON in Simplified Chinese:
{
  "genre": string,
  "mood": string,
  "instruments": string[],
  "rhythmAndTempo": string,
  "curatedSummary": string,
  "tags": string[],
  "analyzedFromAudio": boolean
}`;

      const raw = await callProviderTextCompletion({
        provider,
        apiKey,
        modelOverride: effectiveModel,
        systemInstruction,
        userPrompt: JSON.stringify({
          analysisType,
          hasAudioClip: Boolean(hasAudioClip && usingRealAudio),
          trackInfo: trackInfo || {},
        }),
        expectJson: true,
        audioInline: usingRealAudio
          ? { mimeType: String(audioMimeType), base64Data: String(audioBase64) }
          : undefined,
      });

      const parsed = extractJsonFromLlmText<Record<string, unknown>>(raw);
      res.json({
        providerName: provider.name,
        modelUsed: effectiveModel,
        analyzedFromAudio: usingRealAudio,
        result: {
          ...parsed,
          analyzedFromAudio: usingRealAudio,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI 音乐分析失败',
      });
    }
  });

  // 6. Unified AI Task Manager Intent Router
  router.post('/tasks/route-intent', async (req, res) => {
    try {
      const {
        providerId,
        model,
        prompt,
        trackInfo,
        hasLyrics,
        hasSeparatedStems,
        currentSettings,
      } = req.body || {};

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: '请输入指令或问题' });
        return;
      }

      const resolved = await getStoredProviderWithKey(providerId);
      const stemData = await listPublicStemServices();
      const activeStem = stemData.services.find(
        (s) => s.id === stemData.activeStemServiceId
      );
      const stemReady = Boolean(
        activeStem &&
          activeStem.enabled &&
          activeStem.kind !== 'none' &&
          (activeStem.kind === 'builtin-mdx' || Boolean(activeStem.baseUrl))
      );

      if (!resolved || !resolved.apiKey || !resolved.provider.enabled) {
        // Even if no LLM key is configured, check if it's clearly a stem-separation request?
        // No—prompt requires checking configured AI services honestly:
        res.status(400).json({
          error:
            '当前默认 AI 服务商未启用或尚未填写 API Key。请前往「设置 → AI 智能中心 → API 服务管理」配置并测试连接。',
        });
        return;
      }

      const { provider, apiKey } = resolved;
      const effectiveModel = model || provider.model;
      const caps = inferModelCapabilities(provider.kind, effectiveModel);

      const systemInstruction = `You are LUMINA MUSIC's AI Task Manager router.
Classify the user's natural-language request into ONE primary taskType and evaluate capability availability based on the provided system capabilities.
Task types:
- "stem_separation": User asks to separate vocals and accompaniment/instrumental tracks (e.g., "把人声和伴奏分开", "提取人声", "制作伴奏").
- "dsp_tuning": User asks to adjust audio effects, EQ, bass, treble, vocal clarity, reverb, surround, or vocal/instrumental mix volume.
- "lyrics_assistant": User asks to search, translate, detect language, proofread, explain, or check timing of lyrics.
- "audio_analysis": User asks to analyze song style, mood, instruments, rhythm, or track background.
- "general_qa": General music conversation or guidance.

System capability state provided in input:
- stemServiceReady: boolean (${stemReady})
- stemServiceName: "${activeStem?.name || '未配置'}"
- modelSupportsAudioInput: boolean (${caps.audioInputAnalysis})
- hasTrack: boolean
- hasLyrics: boolean
- hasSeparatedStems: boolean

CRITICAL RULES:
1. For "stem_separation", NEVER say the LLM itself separates audio. Check stemServiceReady: if false, set canExecute: false and explain clearly that an independent stem separation service must be configured first. If true and hasTrack, set canExecute: true, requiresConfirmation: true, and ask whether to begin separation.
2. For "audio_analysis" involving audio-only tasks (instruments / audio tempo), if !modelSupportsAudioInput, note honestly that current model is text-only and can only analyze metadata/lyrics unless switched to Gemini multimodal.
3. For "dsp_tuning", provide "dspInstruction": string summarizing the tuning goal so the tuning planner can generate exact parameters for user confirmation.
4. For "lyrics_assistant", set "lyricsAction": "translate" | "detect-language" | "proofread" | "explain" | "timeline-align" | "search".
5. Respond strictly in JSON (Simplified Chinese replyMessage):
{
  "taskType": "stem_separation" | "dsp_tuning" | "lyrics_assistant" | "audio_analysis" | "general_qa",
  "canExecute": boolean,
  "requiresConfirmation": boolean,
  "replyMessage": string,
  "lyricsAction": string | null,
  "dspInstruction": string | null,
  "analysisType": "comprehensive" | "instruments" | "rhythm-audio" | null
}`;

      const raw = await callProviderTextCompletion({
        provider,
        apiKey,
        modelOverride: effectiveModel,
        systemInstruction,
        userPrompt: JSON.stringify({
          prompt: prompt.trim(),
          stemServiceReady: stemReady,
          stemServiceName: activeStem?.name || null,
          modelSupportsAudioInput: caps.audioInputAnalysis,
          hasTrack: Boolean(trackInfo?.id),
          trackInfo: trackInfo || null,
          hasLyrics: Boolean(hasLyrics),
          hasSeparatedStems: Boolean(hasSeparatedStems),
          currentSettings: currentSettings || null,
        }),
        expectJson: true,
      });

      const plan = extractJsonFromLlmText<Record<string, unknown>>(raw);
      res.json({
        providerName: provider.name,
        modelUsed: effectiveModel,
        capabilities: caps,
        stemServiceReady: stemReady,
        stemServiceName: activeStem?.name || null,
        plan,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI 任务调度解析失败',
      });
    }
  });

  // 7. AI MV Theater Intro / Mid-Breaks / Outro Boundary Analyzer (full-track acoustic draft + multimodal frames)
  router.post('/tasks/mv-theater-analyze', async (req, res) => {
    try {
      const {
        providerId,
        model,
        mvDurationSec = 0,
        songDurationSec = 0,
        trackTitle = '',
        artistName = '',
        mvTitle = '',
        firstLyricSec = null,
        lastLyricSec = null,
        headCorrelationCandidates = [],
        tailCorrelationCandidates = [],
        alignmentPlateaus = [],
        localDraft = null,
        mvSilenceSegments = [],
        mvEnergyTimeline = [],
        songEnergyTimeline = [],
        frames = [],
      } = req.body || {};

      const safeMvDur = Math.max(0, Number(mvDurationSec) || 0);
      const safeSongDur = Math.max(0, Number(songDurationSec) || 0);
      if (safeMvDur <= 0) {
        res.status(400).json({ error: '请先等待 MV 视频元数据加载完成再进行 AI 分析' });
        return;
      }

      const sanitizeFrames: { label: string; mimeType: string; base64Data: string }[] =
        Array.isArray(frames)
          ? frames
              .slice(0, 10)
              .filter(
                (f): f is { timestampSec: number; base64Data: string; mimeType?: string } =>
                  Boolean(f && typeof f.base64Data === 'string' && f.base64Data.length > 20)
              )
              .map((f) => ({
                label: `[MV 视频关键帧 · 时刻 t=${Number(f.timestampSec || 0).toFixed(1)}s]`,
                mimeType: typeof f.mimeType === 'string' ? f.mimeType : 'image/jpeg',
                base64Data: f.base64Data,
              }))
          : [];

      const systemInstruction = `You are LUMINA MUSIC's MV Theater synchronization & film-editing director.
Your task is to pinpoint ALL THREE phases comparing the ENTIRE song against the ENTIRE MV video:
1. **前瞻播放段 (Intro)**: Pre-song cinematic/dialogue sequence at MV start BEFORE song audio 0:00 begins (0s -> introEndSec).
2. **中间无音频段 (Mid-Breaks)**: Middle cinematic interludes / dialogue pauses inside the MV where song audio pauses at audioTriggerSec, MV plays clear video with original MV sound from mvStartSec -> mvEndSec, then song audio resumes seamlessly at audioTriggerSec aligned with MV mvEndSec. Keep mvEndSec - mvStartSec >= 1.8. Return [] if none.
3. **后段尾声 (Outro)**: Post-song epilogue/credits scene AFTER the main song audio finishes (outroStartSec -> outroEndSec, up to mvDurationSec).

HOW TO REASON FROM EVIDENCE:
- You are given full-track DSP multi-band alignment results (localDraft and alignmentPlateaus mapping songStartSec..songEndSec to mvStartSec..mvEndSec with lagSec and meanCorrelation), mvSilenceSegments, energy timelines, LRC bounds, and labeled JPEG keyframes.
- Respect strong local acoustic plateau alignments (meanCorrelation >= 0.35). Do NOT invent fake mid-breaks or long intros if plateaus show uninterrupted alignment.
- Clamp MV timestamps within [0, ${safeMvDur.toFixed(2)}] seconds, and song audioTriggerSec within [0, ${safeSongDur.toFixed(2)}] seconds.
- Write all explanations in clear, concise Simplified Chinese.

Return strictly valid JSON matching:
{
  "summary": string,
  "intro": {
    "recommended": boolean,
    "introEndSec": number,
    "confidence": "high" | "medium" | "low",
    "reason": string,
    "evidenceTimestamps": number[]
  },
  "midBreaks": [
    {
      "id": string,
      "label": string,
      "audioTriggerSec": number,
      "mvStartSec": number,
      "mvEndSec": number,
      "confidence": "high" | "medium" | "low",
      "reason": string,
      "evidenceTimestamps": number[]
    }
  ],
  "outro": {
    "recommended": boolean,
    "outroStartSec": number,
    "outroEndSec": number,
    "confidence": "high" | "medium" | "low",
    "reason": string,
    "evidenceTimestamps": number[]
  }
}`;

      const promptPayload = JSON.stringify({
        trackTitle,
        artistName,
        mvTitle,
        mvDurationSec: safeMvDur,
        songDurationSec: safeSongDur,
        extraDurationSec: Number((safeMvDur - safeSongDur).toFixed(2)),
        firstLyricSec,
        lastLyricSec,
        localDraft,
        alignmentPlateaus,
        headCorrelationCandidates,
        tailCorrelationCandidates,
        mvSilenceSegments,
        mvEnergyTimeline,
        songEnergyTimeline,
        attachedVisualFramesCount: sanitizeFrames.length,
      });

      const forceBuiltin = providerId === '__builtin_gemini__';
      const resolved = forceBuiltin
        ? null
        : await getStoredProviderWithKey(
            typeof providerId === 'string' && providerId ? providerId : undefined
          );

      if (providerId && !forceBuiltin) {
        if (!resolved || !resolved.provider.enabled || !resolved.apiKey) {
          res.status(400).json({
            error: `所选 AI 服务商（${resolved?.provider.name || providerId}）未启用或尚未填写 API Key，请前往「AI 智能中心 → API 服务管理」配置后再试。`,
          });
          return;
        }
      }

      let providerName = '';
      let modelUsed = '';
      let usedVisualFrames = false;
      let rawText = '';

      if (resolved && resolved.apiKey && resolved.provider.enabled) {
        const { provider, apiKey } = resolved;
        const effectiveModel = (typeof model === 'string' && model.trim()) || provider.model;
        providerName = provider.name;
        modelUsed = effectiveModel;
        usedVisualFrames =
          sanitizeFrames.length > 0 &&
          (provider.kind === 'gemini' ||
            /gpt-4o|gpt-4\.1|vision|vl|claude|gemini/i.test(effectiveModel));

        rawText = await callProviderTextCompletion({
          provider,
          apiKey,
          modelOverride: effectiveModel,
          systemInstruction,
          userPrompt: promptPayload,
          expectJson: true,
          imageFrames: sanitizeFrames.length > 0 ? sanitizeFrames : undefined,
        });
      } else if (process.env.GEMINI_API_KEY) {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const parts: Array<
          { text: string } | { inlineData: { mimeType: string; data: string } }
        > = [];
        for (const frame of sanitizeFrames) {
          parts.push({ text: frame.label });
          parts.push({
            inlineData: { mimeType: frame.mimeType, data: frame.base64Data },
          });
        }
        parts.push({ text: promptPayload });

        const mvResponseSchema = {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            intro: {
              type: Type.OBJECT,
              properties: {
                recommended: { type: Type.BOOLEAN },
                introEndSec: { type: Type.NUMBER },
                confidence: { type: Type.STRING },
                reason: { type: Type.STRING },
                evidenceTimestamps: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
              },
              required: [
                'recommended',
                'introEndSec',
                'confidence',
                'reason',
                'evidenceTimestamps',
              ],
            },
            midBreaks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  audioTriggerSec: { type: Type.NUMBER },
                  mvStartSec: { type: Type.NUMBER },
                  mvEndSec: { type: Type.NUMBER },
                  confidence: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  evidenceTimestamps: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                  },
                },
                required: [
                  'id',
                  'label',
                  'audioTriggerSec',
                  'mvStartSec',
                  'mvEndSec',
                  'confidence',
                  'reason',
                  'evidenceTimestamps',
                ],
              },
            },
            outro: {
              type: Type.OBJECT,
              properties: {
                recommended: { type: Type.BOOLEAN },
                outroStartSec: { type: Type.NUMBER },
                outroEndSec: { type: Type.NUMBER },
                confidence: { type: Type.STRING },
                reason: { type: Type.STRING },
                evidenceTimestamps: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
              },
              required: [
                'recommended',
                'outroStartSec',
                'outroEndSec',
                'confidence',
                'reason',
                'evidenceTimestamps',
              ],
            },
          },
          required: ['summary', 'intro', 'midBreaks', 'outro'],
        };

        const callSingleBuiltinGemini = async (
          baseModel: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen',
          thinkingLevel: ThinkingLevel
        ): Promise<string> => {
          const response = await ai.models.generateContent({
            model: baseModel,
            contents: { parts },
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
              responseMimeType: 'application/json',
              responseSchema: mvResponseSchema,
            },
          });
          return (response.text ?? '').trim();
        };

        const requestedSpec = typeof model === 'string' ? model.trim() : '';
        usedVisualFrames = sanitizeFrames.length > 0;

        if (requestedSpec === '__builtin_auto_ensemble__') {
          const settled = await Promise.allSettled([
            callSingleBuiltinGemini('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL),
            callSingleBuiltinGemini('gemini-4-hydrogen', ThinkingLevel.MEDIUM),
          ]);
          const liteRes =
            settled[0].status === 'fulfilled' && settled[0].value
              ? { model: 'gemini-3.1-flash-lite', text: settled[0].value }
              : null;
          const hydroRes =
            settled[1].status === 'fulfilled' && settled[1].value
              ? { model: 'gemini-4-hydrogen', text: settled[1].value }
              : null;

          if (hydroRes && liteRes) {
            providerName = '内置谷歌 AI 双模型联合引擎';
            modelUsed = 'gemini-4-hydrogen + gemini-3.1-flash-lite';
            let chosenText = hydroRes.text;
            try {
              const parseCandidate = (txt: string) =>
                extractJsonFromLlmText<{
                  intro?: { introEndSec?: number };
                  midBreaks?: unknown[];
                  outro?: { outroStartSec?: number };
                }>(txt);
              const hydroJson = parseCandidate(hydroRes.text);
              const liteJson = parseCandidate(liteRes.text);
              const refIntro = Number(localDraft?.intro?.introEndSec ?? 0);
              const refOutro = Number(localDraft?.outro?.outroStartSec ?? safeMvDur);
              const refMidLen = Array.isArray(localDraft?.midBreaks)
                ? localDraft.midBreaks.length
                : 0;
              const driftScore = (c: ReturnType<typeof parseCandidate>) =>
                Math.abs(Number(c.intro?.introEndSec ?? 0) - refIntro) +
                Math.abs(Number(c.outro?.outroStartSec ?? safeMvDur) - refOutro) +
                Math.abs((Array.isArray(c.midBreaks) ? c.midBreaks.length : 0) - refMidLen) *
                  12;
              if (driftScore(liteJson) + 1.5 < driftScore(hydroJson)) {
                chosenText = liteRes.text;
              }
            } catch {
              try {
                extractJsonFromLlmText(hydroRes.text);
                chosenText = hydroRes.text;
              } catch {
                chosenText = liteRes.text;
              }
            }
            rawText = chosenText;
          } else if (liteRes) {
            providerName = '内置谷歌 AI（Flash Lite 自动接管）';
            modelUsed = 'gemini-3.1-flash-lite';
            rawText = liteRes.text;
          } else if (hydroRes) {
            providerName = '内置谷歌 AI（Hydrogen 自动接管）';
            modelUsed = 'gemini-4-hydrogen';
            rawText = hydroRes.text;
          } else {
            const err1 =
              settled[0].status === 'rejected'
                ? settled[0].reason instanceof Error
                  ? settled[0].reason.message
                  : String(settled[0].reason)
                : '空响应';
            const err2 =
              settled[1].status === 'rejected'
                ? settled[1].reason instanceof Error
                  ? settled[1].reason.message
                  : String(settled[1].reason)
                : '空响应';
            throw new Error(`双内置谷歌模型均暂不可用：${err1} / ${err2}`);
          }
        } else {
          const [rawBase, rawTier] = requestedSpec.split('::');
          const baseModel: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen' =
            rawBase === 'gemini-3.1-flash-lite'
              ? 'gemini-3.1-flash-lite'
              : 'gemini-4-hydrogen';

          let thinkingLevel: ThinkingLevel =
            baseModel === 'gemini-3.1-flash-lite'
              ? ThinkingLevel.MINIMAL
              : ThinkingLevel.LOW;
          if (rawTier === 'minimal' && baseModel === 'gemini-3.1-flash-lite') {
            thinkingLevel = ThinkingLevel.MINIMAL;
          } else if (rawTier === 'low') {
            thinkingLevel = ThinkingLevel.LOW;
          } else if (rawTier === 'medium') {
            thinkingLevel = ThinkingLevel.MEDIUM;
          } else if (rawTier === 'high') {
            thinkingLevel = ThinkingLevel.HIGH;
          } else if (rawTier === 'xhigh' && baseModel === 'gemini-4-hydrogen') {
            thinkingLevel = ThinkingLevel.XHIGH;
          }

          providerName = '内置 Gemini 多模态引擎';
          modelUsed = rawTier ? `${baseModel} (${rawTier.toUpperCase()})` : baseModel;
          rawText = await callSingleBuiltinGemini(baseModel, thinkingLevel);
        }
      } else {
        res.status(400).json({
          error:
            '尚未配置可用的 AI 服务商。建议切换为「本地全曲声纹对比引擎」（免 API 密钥），或前往「AI 智能中心 → API 服务管理」配置 DeepSeek / Gemini。',
        });
        return;
      }

      const parsed = extractJsonFromLlmText<{
        summary?: string;
        intro?: {
          recommended?: boolean;
          introEndSec?: number;
          confidence?: string;
          reason?: string;
          evidenceTimestamps?: number[];
        };
        midBreaks?: {
          id?: string;
          label?: string;
          audioTriggerSec?: number;
          mvStartSec?: number;
          mvEndSec?: number;
          confidence?: string;
          reason?: string;
          evidenceTimestamps?: number[];
        }[];
        outro?: {
          recommended?: boolean;
          outroStartSec?: number;
          outroEndSec?: number;
          confidence?: string;
          reason?: string;
          evidenceTimestamps?: number[];
        };
      }>(rawText);

      const clampMv = (v: unknown, fallback = 0) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Number(Math.max(0, Math.min(safeMvDur, n)).toFixed(2));
      };

      const clampSong = (v: unknown, fallback = 0) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Number(Math.max(0, Math.min(safeSongDur || safeMvDur, n)).toFixed(2));
      };

      const introEndSec = clampMv(parsed.intro?.introEndSec, 0);
      const outroStartSec = clampMv(parsed.outro?.outroStartSec, safeMvDur);
      const outroEndSec = Math.max(
        outroStartSec,
        clampMv(parsed.outro?.outroEndSec, safeMvDur)
      );

      const normConf = (c: unknown): 'high' | 'medium' | 'low' =>
        c === 'high' || c === 'medium' || c === 'low' ? c : 'medium';

      const normTimes = (arr: unknown): number[] =>
        Array.isArray(arr)
          ? arr
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x) && x >= 0 && x <= safeMvDur)
              .slice(0, 6)
              .map((x) => Number(x.toFixed(1)))
          : [];

      const rawMidSource = Array.isArray(parsed.midBreaks)
        ? parsed.midBreaks
        : Array.isArray(localDraft?.midBreaks)
        ? localDraft.midBreaks
        : [];

      const midBreaks = rawMidSource
        .map((b: Record<string, unknown>, idx: number) => {
          const mvStartSec = clampMv(b?.mvStartSec, 0);
          const mvEndSec = clampMv(b?.mvEndSec, mvStartSec);
          const audioTriggerSec = clampSong(b?.audioTriggerSec, 0);
          return {
            id:
              typeof b?.id === 'string' && b.id.trim()
                ? b.id.trim()
                : `ai-mid-${idx + 1}`,
            label:
              typeof b?.label === 'string' && b.label.trim()
                ? b.label.trim()
                : `中段剧情 ${idx + 1}`,
            audioTriggerSec,
            mvStartSec,
            mvEndSec,
            confidence: normConf(b?.confidence),
            reason:
              typeof b?.reason === 'string' && b.reason.trim()
                ? b.reason.trim()
                : '全曲时间轴对齐跃迁检测到的中段插曲/剧情区。',
            evidenceTimestamps: normTimes(b?.evidenceTimestamps),
          };
        })
        .filter((b: { mvEndSec: number; mvStartSec: number }) => b.mvEndSec - b.mvStartSec >= 1.5);

      res.json({
        providerName,
        modelUsed,
        usedVisualFrames,
        summary:
          parsed.summary ||
          '已完成整首歌与整部 MV 的全曲声纹联合识别，请对照画面帧与音频波形确认前瞻、中段与后段参数。',
        intro: {
          recommended: Boolean(parsed.intro?.recommended && introEndSec > 0.3),
          introEndSec,
          confidence: normConf(parsed.intro?.confidence),
          reason:
            parsed.intro?.reason ||
            '已结合全曲前段声纹对齐偏移与 MV 开场特征完成研判。',
          evidenceTimestamps: normTimes(parsed.intro?.evidenceTimestamps),
        },
        midBreaks,
        outro: {
          recommended: Boolean(
            parsed.outro?.recommended && outroEndSec > outroStartSec + 0.4
          ),
          outroStartSec,
          outroEndSec,
          confidence: normConf(parsed.outro?.confidence),
          reason:
            parsed.outro?.reason ||
            '已结合全曲末段对齐位置与 MV 剩余片尾区间完成研判。',
          evidenceTimestamps: normTimes(parsed.outro?.evidenceTimestamps),
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI 分析 MV 剧场分段失败',
      });
    }
  });

  return router;
}
