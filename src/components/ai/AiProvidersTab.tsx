import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useAi } from '../../context/AiContext';
import { useMusic } from '../../context/MusicContext';
import {
  deleteProviderById,
  deleteProviderKey,
  deleteStemServiceById,
  fetchProviderModels,
  inferClientModelCapabilities,
  saveProvider,
  saveStemService,
  setActiveStemServiceId,
  setDefaultProviderById,
  testProviderApi,
  testStemServiceById,
} from '../../services/ai';
import {
  AiProviderConfig,
  AiProviderKind,
  StemServiceConfig,
  StemServiceKind,
} from '../../types/ai';

const PROVIDER_TEMPLATES: {
  kind: AiProviderKind;
  label: string;
  defaultName: string;
  defaultBaseUrl: string;
  defaultModel: string;
}[] = [
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    defaultName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    defaultName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    kind: 'gemini',
    label: 'Google Gemini',
    defaultName: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-4-hydrogen',
  },
  {
    kind: 'openai-compatible',
    label: 'OpenAI 兼容服务',
    defaultName: 'OpenAI 兼容服务',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    kind: 'custom',
    label: '自定义 AI API',
    defaultName: '自定义 AI 服务',
    defaultBaseUrl: 'https://your-ai-endpoint.example.com/v1',
    defaultModel: 'custom-model',
  },
];

export const AiProvidersTab: React.FC = () => {
  const {
    providers,
    refreshProviders,
    stemServices,
    refreshStemServices,
    setSelectedProviderId,
  } = useAi();
  const { showToast, activePalette } = useMusic();

  const [editingId, setEditingId] = useState<string>('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AiProviderKind>('deepseek');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [maxRequestsPerDay, setMaxRequestsPerDay] = useState(0);
  const [customHeadersJson, setCustomHeadersJson] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testBanner, setTestBanner] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [modelListHint, setModelListHint] = useState<string | null>(null);

  // Stem service editor state
  const [editingStemId, setEditingStemId] = useState<string>('');
  const [stemName, setStemName] = useState('');
  const [stemKind, setStemKind] = useState<StemServiceKind>('remote-demucs-http');
  const [stemBaseUrl, setStemBaseUrl] = useState('');
  const [stemEndpointPath, setStemEndpointPath] = useState('/separate');
  const [stemApiKey, setStemApiKey] = useState('');
  const [showStemKey, setShowStemKey] = useState(false);
  const [stemEnabled, setStemEnabled] = useState(true);
  const [stemTimeoutMs, setStemTimeoutMs] = useState(180000);
  const [isTestingStem, setIsTestingStem] = useState(false);
  const [isSavingStem, setIsSavingStem] = useState(false);

  const loadProviderIntoForm = (p: AiProviderConfig) => {
    setEditingId(p.id);
    setName(p.name);
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setAvailableModels(p.availableModels || []);
    setApiKeyInput('');
    setShowKeyInput(false);
    setEnabled(p.enabled);
    setTimeoutMs(p.timeoutMs);
    setMaxRequestsPerDay(p.maxRequestsPerDay);
    setCustomHeadersJson(p.customHeadersJson || '');
    setTestBanner(null);
    setModelListHint(null);
  };

  useEffect(() => {
    if (!editingId && providers.length > 0) {
      const def = providers.find((p) => p.isDefault) || providers[0];
      loadProviderIntoForm(def);
    } else if (editingId) {
      const current = providers.find((p) => p.id === editingId);
      if (!current && providers.length > 0) {
        loadProviderIntoForm(providers[0]);
      }
    }
  }, [providers, editingId]);

  const loadStemIntoForm = (s: StemServiceConfig) => {
    setEditingStemId(s.id);
    setStemName(s.name);
    setStemKind(s.kind);
    setStemBaseUrl(s.baseUrl);
    setStemEndpointPath(s.endpointPath || '/separate');
    setStemApiKey('');
    setShowStemKey(false);
    setStemEnabled(s.enabled);
    setStemTimeoutMs(s.timeoutMs);
  };

  useEffect(() => {
    if (!editingStemId && stemServices.length > 0) {
      const active = stemServices.find((s) => s.isActive) || stemServices[0];
      loadStemIntoForm(active);
    }
  }, [stemServices, editingStemId]);

  const currentEditingProvider = providers.find((p) => p.id === editingId) || null;
  const currentEditingStem = stemServices.find((s) => s.id === editingStemId) || null;
  const currentCapabilities = inferClientModelCapabilities(kind, model);

  const handleCreateTemplate = (tplKind: AiProviderKind) => {
    const tpl =
      PROVIDER_TEMPLATES.find((t) => t.kind === tplKind) || PROVIDER_TEMPLATES[0];
    setEditingId('');
    setName(tpl.defaultName);
    setKind(tpl.kind);
    setBaseUrl(tpl.defaultBaseUrl);
    setModel(tpl.defaultModel);
    setAvailableModels([tpl.defaultModel]);
    setApiKeyInput('');
    setShowKeyInput(false);
    setEnabled(true);
    setTimeoutMs(30000);
    setMaxRequestsPerDay(0);
    setCustomHeadersJson('');
    setTestBanner(null);
    setModelListHint(null);
  };

  const handleSaveProvider = async (setAsDefault = false): Promise<string | null> => {
    if (!name.trim() || !baseUrl.trim()) {
      showToast('请填写服务商名称与 API Base URL');
      return null;
    }
    setIsSaving(true);
    try {
      const res = await saveProvider({
        id: editingId || undefined,
        name: name.trim(),
        kind,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        availableModels,
        apiKey: apiKeyInput.trim() || undefined,
        enabled,
        timeoutMs,
        maxRequestsPerDay,
        customHeadersJson: customHeadersJson.trim() || undefined,
        setAsDefault,
      });
      await refreshProviders();
      setEditingId(res.provider.id);
      setApiKeyInput('');
      setShowKeyInput(false);
      if (setAsDefault) {
        setSelectedProviderId(res.provider.id);
      }
      showToast(`已保存「${res.provider.name}」配置（密钥已加密存储于服务端）`);
      return res.provider.id;
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestBanner(null);
    setIsTesting(true);
    try {
      let targetId = editingId;
      if (!targetId || apiKeyInput.trim()) {
        const savedId = await handleSaveProvider(false);
        if (!savedId) return;
        targetId = savedId;
      }
      const result = await testProviderApi(targetId);
      await refreshProviders();
      if (result.ok) {
        setTestBanner({
          ok: true,
          text: `连接成功（延迟 ${result.latencyMs} ms${
            result.modelsFound ? `，发现 ${result.modelsFound} 个可用模型` : ''
          }）`,
        });
      } else {
        setTestBanner({
          ok: false,
          text: result.error || '连接失败',
        });
      }
    } catch (err) {
      setTestBanner({
        ok: false,
        text: err instanceof Error ? err.message : '测试请求异常',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setModelListHint(null);
    setIsFetchingModels(true);
    try {
      let targetId = editingId;
      if (!targetId || apiKeyInput.trim()) {
        const savedId = await handleSaveProvider(false);
        if (!savedId) return;
        targetId = savedId;
      }
      const res = await fetchProviderModels(targetId);
      await refreshProviders();
      const ids = res.models.map((m) => m.id);
      if (ids.length > 0) {
        setAvailableModels(ids);
        if (!ids.includes(model)) {
          setModel(ids[0]);
        }
        setModelListHint(`已从接口同步 ${ids.length} 个模型`);
      } else {
        setModelListHint(res.message || '接口未返回模型列表，请手动输入模型名称');
      }
    } catch (err) {
      setModelListHint(
        err instanceof Error
          ? `${err.message}（可直接在下方手动输入模型名称）`
          : '获取模型列表失败，请手动输入'
      );
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleClearKey = async () => {
    if (!editingId) return;
    try {
      await deleteProviderKey(editingId);
      await refreshProviders();
      setApiKeyInput('');
      setTestBanner(null);
      showToast('已从服务端安全删除该 API Key');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除密钥失败');
    }
  };

  const handleDeleteProvider = async () => {
    if (!editingId) return;
    try {
      await deleteProviderById(editingId);
      setEditingId('');
      await refreshProviders();
      showToast('已删除该 AI 服务商配置');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSaveStem = async (setActive = false) => {
    setIsSavingStem(true);
    try {
      const res = await saveStemService({
        id: editingStemId || undefined,
        name: stemName.trim() || '自定义音源分离服务',
        kind: stemKind,
        baseUrl: stemBaseUrl.trim(),
        endpointPath: stemEndpointPath.trim() || '/separate',
        apiKey: stemApiKey.trim() || undefined,
        enabled: stemEnabled,
        timeoutMs: stemTimeoutMs,
        setActive,
      });
      await refreshStemServices();
      setEditingStemId(res.service.id);
      setStemApiKey('');
      showToast(`已保存音源分离服务「${res.service.name}」`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存音源分离服务失败');
    } finally {
      setIsSavingStem(false);
    }
  };

  const handleTestStem = async () => {
    if (!editingStemId) {
      await handleSaveStem(false);
    }
    if (!editingStemId) return;
    setIsTestingStem(true);
    try {
      const res = await testStemServiceById(editingStemId);
      await refreshStemServices();
      showToast(res.ok ? res.message || '连接正常' : res.error || '连接失败');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '测试分离服务失败');
    } finally {
      setIsTestingStem(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Security Architecture Notice */}
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/25 px-4 py-3.5 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-100/90 leading-relaxed space-y-1">
          <p className="font-semibold text-white">
            后端加密代理密钥保护已启用 (AES-256-GCM)
          </p>
          <p className="text-emerald-100/75">
            您填写的所有第三方 API Key 仅保存于服务端加密保险库并通过后端代理转发请求，不会写入浏览器 localStorage、不会在控制台打印，也不会下发给前端 JavaScript。
          </p>
        </div>
      </div>

      {/* Section 1: LLM / Multimodal AI Provider Manager */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">
              第三方 AI API 服务管理
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              支持 DeepSeek、OpenAI、Google Gemini、OpenAI 兼容接口及自定义 API 服务
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PROVIDER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.kind}
                type="button"
                onClick={() => handleCreateTemplate(tpl.kind)}
                className="px-3 py-1.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/85 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{tpl.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left list of configured providers */}
          <div className="lg:col-span-5 space-y-2.5">
            {providers.map((p) => {
              const selected = p.id === editingId;
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl p-3.5 border transition-all cursor-pointer ${
                    selected
                      ? 'bg-white/12 border-white/30'
                      : 'bg-black/25 border-white/10 hover:bg-white/[0.06]'
                  }`}
                  onClick={() => loadProviderIntoForm(p)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {p.name}
                      </p>
                      <p className="text-xs text-white/55 mt-0.5 truncate font-mono-tabular">
                        {p.model || '未指定模型'}
                        {' · '}
                        {p.hasKey ? `密钥 ${p.maskedKey}` : '未填写密钥'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-[11px] font-medium ${
                          p.connectionStatus === 'connected'
                            ? 'text-emerald-300'
                            : p.connectionStatus === 'error'
                            ? 'text-rose-300'
                            : 'text-white/45'
                        }`}
                      >
                        {p.connectionStatus === 'connected'
                          ? `已连接${p.lastLatencyMs ? ` · ${p.lastLatencyMs}ms` : ''}`
                          : p.connectionStatus === 'error'
                          ? '连接异常'
                          : '未测试'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-white/8 flex items-center justify-between text-[11px] text-white/60">
                    <span>
                      {p.enabled ? '已启用' : '已停用'}
                      {' · '}
                      今日请求 {p.requestsToday}
                      {p.maxRequestsPerDay > 0 ? `/${p.maxRequestsPerDay}` : ''}
                    </span>

                    {p.isDefault ? (
                      <span
                        className="font-semibold"
                        style={{ color: activePalette.primary }}
                      >
                        当前默认服务
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await setDefaultProviderById(p.id);
                          setSelectedProviderId(p.id);
                          await refreshProviders();
                          showToast(`已将「${p.name}」设为默认 AI 服务商`);
                        }}
                        className="text-white/75 hover:text-white underline cursor-pointer"
                      >
                        设为默认
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right provider form */}
          <div className="lg:col-span-7 rounded-2xl bg-black/25 border border-white/10 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">
                {currentEditingProvider ? `编辑服务：${currentEditingProvider.name}` : '新建 AI 服务配置'}
              </h3>
              <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="accent-rose-500 w-4 h-4"
                />
                <span>启用该服务</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="space-y-1.5 text-xs">
                <span className="text-white/70 block">服务商名称</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：DeepSeek 官方"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white outline-none focus:border-white/40"
                />
              </label>

              <label className="space-y-1.5 text-xs">
                <span className="text-white/70 block">接口协议类型</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AiProviderKind)}
                  className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white outline-none"
                >
                  <option value="deepseek" className="bg-[#180713]">
                    DeepSeek
                  </option>
                  <option value="openai" className="bg-[#180713]">
                    OpenAI
                  </option>
                  <option value="gemini" className="bg-[#180713]">
                    Google Gemini
                  </option>
                  <option value="openai-compatible" className="bg-[#180713]">
                    OpenAI 兼容格式 (Kimi/智谱/通义/硅基等)
                  </option>
                  <option value="custom" className="bg-[#180713]">
                    自定义 AI API
                  </option>
                </select>
              </label>
            </div>

            <label className="space-y-1.5 text-xs block">
              <span className="text-white/70 block">API Base URL</span>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com"
                className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none focus:border-white/40"
              />
            </label>

            {/* Secure API Key Input */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-white/70">
                  API Key（{currentEditingProvider?.hasKey ? `已加密保存：${currentEditingProvider.maskedKey}` : '尚未配置'}）
                </span>
                {currentEditingProvider?.hasKey && (
                  <button
                    type="button"
                    onClick={handleClearKey}
                    className="text-rose-300 hover:text-rose-200 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    删除已存密钥
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <KeyRound className="w-4 h-4 text-white/40 absolute left-3 pointer-events-none" />
                <input
                  type={showKeyInput ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    currentEditingProvider?.hasKey
                      ? '留空则保留当前已加密密钥，输入新密钥可覆盖'
                      : '输入您的 API Key（例如 sk-...）'
                  }
                  className="w-full pl-9 pr-11 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyInput((v) => !v)}
                  aria-label={showKeyInput ? '隐藏输入密钥' : '显示输入密钥'}
                  className="absolute right-2 p-1.5 rounded-lg text-white/55 hover:text-white cursor-pointer"
                >
                  {showKeyInput ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Model selection & live model fetch */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/70">模型名称（支持从接口获取或手动输入）</span>
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {isFetchingModels ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>从服务商获取模型列表</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="手动输入模型 ID，如 deepseek-chat"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none focus:border-white/40"
                />

                <select
                  value={availableModels.includes(model) ? model : ''}
                  onChange={(e) => {
                    if (e.target.value) setModel(e.target.value);
                  }}
                  aria-label="选择已获取的模型"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white outline-none"
                >
                  <option value="" className="bg-[#180713]">
                    {availableModels.length > 0 ? '快速选择列表中的模型…' : '暂无缓存模型列表'}
                  </option>
                  {availableModels.map((m) => (
                    <option key={m} value={m} className="bg-[#180713]">
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {modelListHint && (
                <p className="text-[11px] text-white/65">{modelListHint}</p>
              )}

              {/* Honest Model Capabilities Summary */}
              <div className="text-[11px] text-white/60 pt-1">
                <span>能力评估：</span>
                <span>{currentCapabilities.textReasoning ? '支持文本规划与歌词' : '不支持文本'}</span>
                <span> · </span>
                <span>{currentCapabilities.audioInputAnalysis ? '支持音频信号输入' : '不支持音频输入'}</span>
                <span> · </span>
                <span>音轨分离需独立分离服务</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="space-y-1.5 text-xs">
                <span className="text-white/70 block">请求超时时间 (ms)</span>
                <input
                  type="number"
                  min={3000}
                  max={180000}
                  step={1000}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)}
                  className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                />
              </label>

              <label className="space-y-1.5 text-xs">
                <span className="text-white/70 block">每日最大请求限制 (0 为不限制)</span>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={maxRequestsPerDay}
                  onChange={(e) => setMaxRequestsPerDay(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                />
              </label>
            </div>

            {kind === 'custom' && (
              <label className="space-y-1.5 text-xs block">
                <span className="text-white/70 block">
                  自定义额外请求头 (可选 JSON，例如 {`{"X-Org":"team"}`})
                </span>
                <input
                  type="text"
                  value={customHeadersJson}
                  onChange={(e) => setCustomHeadersJson(e.target.value)}
                  placeholder='{"X-Custom-Header": "value"}'
                  className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-xs text-white font-mono-tabular outline-none"
                />
              </label>
            )}

            {/* Connection Test Feedback */}
            {(testBanner || currentEditingProvider?.lastError) && (
              <div
                className={`rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2 border ${
                  testBanner?.ok
                    ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-100'
                    : 'bg-rose-500/12 border-rose-400/30 text-rose-100'
                }`}
              >
                {testBanner?.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                )}
                <span className="break-all">
                  {testBanner ? testBanner.text : currentEditingProvider?.lastError}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => handleSaveProvider(false)}
                disabled={isSaving}
                className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                }}
              >
                {isSaving ? '保存中…' : '保存服务配置'}
              </button>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>测试 API 连接</span>
              </button>

              {!currentEditingProvider?.isDefault && (
                <button
                  type="button"
                  onClick={() => handleSaveProvider(true)}
                  disabled={isSaving}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white/85 cursor-pointer"
                >
                  保存并设为默认
                </button>
              )}

              {editingId && providers.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeleteProvider}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-xs text-rose-200 ml-auto cursor-pointer"
                >
                  删除服务
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Independent Stem Separation Service Manager */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Wrench className="w-5 h-5 text-fuchsia-300 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                独立 AI 音源分离服务配置
              </h2>
              <p className="text-xs text-white/55 mt-0.5">
                与 DeepSeek 等文本接口完全解耦，可选择内置 UVR MDX-Net 模型或对接外部 Demucs / Spleeter HTTP 服务
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingStemId('');
              setStemName('自定义 Demucs 分离节点');
              setStemKind('remote-demucs-http');
              setStemBaseUrl('');
              setStemEndpointPath('/separate');
              setStemApiKey('');
              setStemEnabled(true);
              setStemTimeoutMs(180000);
            }}
            className="px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white flex items-center gap-1.5 cursor-pointer self-start"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增外部分离服务</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-2.5">
            {stemServices.map((s) => {
              const selected = s.id === editingStemId;
              return (
                <div
                  key={s.id}
                  onClick={() => loadStemIntoForm(s)}
                  className={`rounded-2xl p-3.5 border transition-all cursor-pointer ${
                    selected
                      ? 'bg-white/12 border-white/30'
                      : 'bg-black/25 border-white/10 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {s.name}
                      </p>
                      <p className="text-xs text-white/55 mt-0.5 truncate">
                        {s.kind === 'builtin-mdx'
                          ? '内置 ONNX 引擎 (本地浏览器 / 服务端)'
                          : s.baseUrl || '未填写外部 Base URL'}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-medium shrink-0 ${
                        s.connectionStatus === 'connected'
                          ? 'text-emerald-300'
                          : s.connectionStatus === 'error'
                          ? 'text-rose-300'
                          : 'text-white/45'
                      }`}
                    >
                      {s.connectionStatus === 'connected'
                        ? '就绪'
                        : s.connectionStatus === 'error'
                        ? '异常'
                        : '未测试'}
                    </span>
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-white/8 flex items-center justify-between text-[11px] text-white/60">
                    <span>{s.enabled ? '已启用' : '已停用'}</span>
                    {s.isActive ? (
                      <span className="font-semibold text-fuchsia-300">
                        当前激活分离服务
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await setActiveStemServiceId(s.id);
                          await refreshStemServices();
                          showToast(`已切换音源分离服务为「${s.name}」`);
                        }}
                        className="text-white/75 hover:text-white underline cursor-pointer"
                      >
                        设为当前分离服务
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={async () => {
                await setActiveStemServiceId(null);
                await refreshStemServices();
                showToast('已停用自动音源分离服务选择');
              }}
              className="w-full py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-white/60 hover:text-white cursor-pointer"
            >
              暂不激活任何分离服务（用于验证未配置提示）
            </button>
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-black/25 border border-white/10 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {currentEditingStem ? `配置：${currentEditingStem.name}` : '新增外部分离服务'}
              </h3>
              <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stemEnabled}
                  onChange={(e) => setStemEnabled(e.target.checked)}
                  className="accent-rose-500 w-4 h-4"
                />
                <span>启用此分离服务</span>
              </label>
            </div>

            {stemKind === 'builtin-mdx' ? (
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3.5 text-xs text-white/75 leading-relaxed space-y-1.5">
                <p className="font-medium text-white">
                  内置 UVR MDX-Net (`Kim_Vocal_2.onnx`) 深度音源分离服务
                </p>
                <p>
                  支持本地浏览器（WebGPU / WebAssembly）及服务端 ONNX Runtime 真实分离出独立人声与伴奏 WAV 音轨，无需填写外部 API Key。
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <label className="space-y-1.5 text-xs">
                    <span className="text-white/70 block">服务名称</span>
                    <input
                      type="text"
                      value={stemName}
                      onChange={(e) => setStemName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs">
                    <span className="text-white/70 block">分离接口路径</span>
                    <input
                      type="text"
                      value={stemEndpointPath}
                      onChange={(e) => setStemEndpointPath(e.target.value)}
                      placeholder="/separate"
                      className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                    />
                  </label>
                </div>

                <label className="space-y-1.5 text-xs block">
                  <span className="text-white/70 block">
                    Demucs / Spleeter 服务 Base URL
                  </span>
                  <input
                    type="url"
                    value={stemBaseUrl}
                    onChange={(e) => setStemBaseUrl(e.target.value)}
                    placeholder="https://your-demucs-worker.example.com"
                    className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5 text-xs">
                    <span className="text-white/70 block">
                      访问鉴权 Key (可选{currentEditingStem?.hasKey ? ` · ${currentEditingStem.maskedKey}` : ''})
                    </span>
                    <div className="relative flex items-center">
                      <input
                        type={showStemKey ? 'text' : 'password'}
                        value={stemApiKey}
                        onChange={(e) => setStemApiKey(e.target.value)}
                        autoComplete="new-password"
                        placeholder="留空则保持不变"
                        className="w-full pl-3 pr-10 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowStemKey((v) => !v)}
                        className="absolute right-2 p-1 text-white/55 hover:text-white cursor-pointer"
                      >
                        {showStemKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-white/70 block">超时时间 (ms)</span>
                    <input
                      type="number"
                      min={10000}
                      max={600000}
                      step={5000}
                      value={stemTimeoutMs}
                      onChange={(e) => setStemTimeoutMs(Number(e.target.value) || 180000)}
                      className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/15 text-sm text-white font-mono-tabular outline-none"
                    />
                  </label>
                </div>
              </>
            )}

            {currentEditingStem?.lastError && (
              <div className="rounded-xl px-3 py-2 bg-rose-500/12 border border-rose-400/25 text-xs text-rose-200">
                {currentEditingStem.lastError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => handleSaveStem(true)}
                disabled={isSavingStem}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-white/14 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white cursor-pointer"
              >
                {isSavingStem ? '保存中…' : '保存并设为当前分离服务'}
              </button>

              <button
                type="button"
                onClick={handleTestStem}
                disabled={isTestingStem}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs text-white cursor-pointer"
              >
                {isTestingStem ? '检测中…' : '检测服务状态'}
              </button>

              {editingStemId && editingStemId !== 'stem-builtin-mdx' && (
                <button
                  type="button"
                  onClick={async () => {
                    await deleteStemServiceById(editingStemId);
                    setEditingStemId('');
                    await refreshStemServices();
                    showToast('已删除该分离服务');
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-xs text-rose-200 ml-auto cursor-pointer"
                >
                  删除
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
