import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../.cache');
const VAULT_FILE = path.join(CACHE_DIR, 'ai-providers-vault.enc');
const KEY_FILE = path.join(CACHE_DIR, '.vault-key');

export type AiProviderKind =
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'openai-compatible'
  | 'custom';

export type ProviderConnectionStatus = 'untested' | 'connected' | 'error';

export interface StoredAiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  availableModels: string[];
  encryptedApiKey?: string; // AES-256-GCM serialized ciphertext, never returned to client
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  timeoutMs: number;
  maxRequestsPerDay: number; // 0 = unlimited
  requestsToday: number;
  requestsDate: string; // YYYY-MM-DD
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  customHeadersJson?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicAiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  availableModels: string[];
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  timeoutMs: number;
  maxRequestsPerDay: number;
  requestsToday: number;
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  customHeadersJson?: string;
  createdAt: number;
  updatedAt: number;
}

export type StemServiceKind = 'builtin-mdx' | 'remote-demucs-http' | 'none';

export interface StoredStemService {
  id: string;
  name: string;
  kind: StemServiceKind;
  baseUrl: string;
  endpointPath: string;
  encryptedApiKey?: string;
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  timeoutMs: number;
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
}

export interface PublicStemService {
  id: string;
  name: string;
  kind: StemServiceKind;
  baseUrl: string;
  endpointPath: string;
  maskedKey: string;
  hasKey: boolean;
  enabled: boolean;
  isActive: boolean;
  timeoutMs: number;
  connectionStatus: ProviderConnectionStatus;
  lastError?: string;
  lastCheckedAt?: number;
}

interface VaultState {
  version: 1;
  defaultProviderId: string | null;
  providers: StoredAiProvider[];
  activeStemServiceId: string | null;
  stemServices: StoredStemService[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function maskSecretKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

let cachedMasterKey: Buffer | null = null;
let cachedVault: VaultState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function getMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  try {
    const existing = (await fsp.readFile(KEY_FILE, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) {
      cachedMasterKey = Buffer.from(existing, 'hex');
      return cachedMasterKey;
    }
  } catch {
    // Generate new installation-local AES-256 key
  }
  const fresh = crypto.randomBytes(32);
  await fsp.writeFile(KEY_FILE, fresh.toString('hex'), { mode: 0o600 });
  cachedMasterKey = fresh;
  return fresh;
}

async function encryptString(plain: string): Promise<string> {
  if (!plain) return '';
  const key = await getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

async function decryptString(serialized?: string): Promise<string> {
  if (!serialized) return '';
  const parts = serialized.split(':');
  if (parts.length !== 3) return '';
  try {
    const key = await getMasterKey();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const data = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

function createInitialVaultState(): VaultState {
  const now = Date.now();
  return {
    version: 1,
    defaultProviderId: 'provider-deepseek-default',
    providers: [
      {
        id: 'provider-deepseek-default',
        name: 'DeepSeek',
        kind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        availableModels: ['deepseek-chat', 'deepseek-reasoner'],
        maskedKey: '',
        hasKey: false,
        enabled: true,
        timeoutMs: 30000,
        maxRequestsPerDay: 0,
        requestsToday: 0,
        requestsDate: todayIso(),
        connectionStatus: 'untested',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'provider-openai-default',
        name: 'OpenAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        availableModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
        maskedKey: '',
        hasKey: false,
        enabled: true,
        timeoutMs: 30000,
        maxRequestsPerDay: 0,
        requestsToday: 0,
        requestsDate: todayIso(),
        connectionStatus: 'untested',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'provider-gemini-default',
        name: 'Google Gemini',
        kind: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-4-hydrogen',
        availableModels: [
          'gemini-4-hydrogen',
          'gemini-3.1-flash-lite',
          'gemini-4-argon',
        ],
        maskedKey: '',
        hasKey: false,
        enabled: true,
        timeoutMs: 45000,
        maxRequestsPerDay: 0,
        requestsToday: 0,
        requestsDate: todayIso(),
        connectionStatus: 'untested',
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeStemServiceId: 'stem-builtin-mdx',
    stemServices: [
      {
        id: 'stem-builtin-mdx',
        name: '内置 UVR MDX-Net (Kim_Vocal_2)',
        kind: 'builtin-mdx',
        baseUrl: '/api/stems',
        endpointPath: '/separate',
        maskedKey: '',
        hasKey: true,
        enabled: true,
        timeoutMs: 300000,
        connectionStatus: 'connected',
        lastCheckedAt: now,
      },
      {
        id: 'stem-remote-demucs',
        name: '外部 Demucs / Spleeter 分离服务',
        kind: 'remote-demucs-http',
        baseUrl: '',
        endpointPath: '/separate',
        maskedKey: '',
        hasKey: false,
        enabled: false,
        timeoutMs: 180000,
        connectionStatus: 'untested',
      },
    ],
  };
}

async function loadVault(): Promise<VaultState> {
  if (cachedVault) return cachedVault;
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  if (fs.existsSync(VAULT_FILE)) {
    try {
      const payload = await fsp.readFile(VAULT_FILE, 'utf8');
      const plain = await decryptString(payload.trim());
      if (plain) {
        const parsed = JSON.parse(plain) as VaultState;
        if (parsed && Array.isArray(parsed.providers) && Array.isArray(parsed.stemServices)) {
          cachedVault = parsed;
          return cachedVault;
        }
      }
    } catch {
      // Fall through to clean initial state if vault was unreadable
    }
  }
  cachedVault = createInitialVaultState();
  await persistVault(cachedVault);
  return cachedVault;
}

async function persistVault(state: VaultState): Promise<void> {
  cachedVault = state;
  writeQueue = writeQueue.then(async () => {
    const serialized = await encryptString(JSON.stringify(state));
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(VAULT_FILE, serialized, { mode: 0o600 });
  });
  await writeQueue;
}

function toPublicProvider(
  p: StoredAiProvider,
  defaultId: string | null
): PublicAiProvider {
  const today = todayIso();
  const requestsToday = p.requestsDate === today ? p.requestsToday : 0;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    model: p.model,
    availableModels: p.availableModels,
    maskedKey: p.maskedKey,
    hasKey: p.hasKey,
    enabled: p.enabled,
    isDefault: p.id === defaultId,
    timeoutMs: p.timeoutMs,
    maxRequestsPerDay: p.maxRequestsPerDay,
    requestsToday,
    connectionStatus: p.connectionStatus,
    lastError: p.lastError,
    lastCheckedAt: p.lastCheckedAt,
    lastLatencyMs: p.lastLatencyMs,
    customHeadersJson: p.customHeadersJson,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toPublicStemService(
  s: StoredStemService,
  activeId: string | null
): PublicStemService {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    baseUrl: s.baseUrl,
    endpointPath: s.endpointPath,
    maskedKey: s.maskedKey,
    hasKey: s.hasKey,
    enabled: s.enabled,
    isActive: s.id === activeId,
    timeoutMs: s.timeoutMs,
    connectionStatus: s.connectionStatus,
    lastError: s.lastError,
    lastCheckedAt: s.lastCheckedAt,
  };
}

export async function listPublicProviders(): Promise<{
  defaultProviderId: string | null;
  providers: PublicAiProvider[];
}> {
  const vault = await loadVault();
  return {
    defaultProviderId: vault.defaultProviderId,
    providers: vault.providers.map((p) => toPublicProvider(p, vault.defaultProviderId)),
  };
}

export async function getStoredProviderWithKey(providerId?: string): Promise<{
  provider: StoredAiProvider;
  apiKey: string;
} | null> {
  const vault = await loadVault();
  let found: StoredAiProvider | null = null;
  if (providerId) {
    found = vault.providers.find((p) => p.id === providerId) || null;
  } else {
    const def = vault.defaultProviderId
      ? vault.providers.find((p) => p.id === vault.defaultProviderId) || null
      : null;
    found =
      (def && def.enabled && def.hasKey ? def : null) ||
      vault.providers.find((p) => p.enabled && p.hasKey) ||
      def ||
      null;
  }
  if (!found) return null;
  const apiKey = await decryptString(found.encryptedApiKey);
  return { provider: found, apiKey };
}

export async function upsertProvider(input: {
  id?: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  availableModels?: string[];
  apiKey?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRequestsPerDay?: number;
  customHeadersJson?: string;
  setAsDefault?: boolean;
}): Promise<{ defaultProviderId: string | null; provider: PublicAiProvider }> {
  const vault = await loadVault();
  const now = Date.now();
  const existingIdx = input.id
    ? vault.providers.findIndex((p) => p.id === input.id)
    : -1;

  const trimmedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const hasNewKey = trimmedKey.length > 0;

  if (existingIdx >= 0) {
    const prev = vault.providers[existingIdx];
    const nextEncrypted = hasNewKey
      ? await encryptString(trimmedKey)
      : prev.encryptedApiKey;
    const nextMasked = hasNewKey ? maskSecretKey(trimmedKey) : prev.maskedKey;
    const nextHasKey = hasNewKey ? true : prev.hasKey;

    const updated: StoredAiProvider = {
      ...prev,
      name: input.name.trim() || prev.name,
      kind: input.kind,
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim() || prev.model,
      availableModels: Array.isArray(input.availableModels)
        ? input.availableModels
        : prev.availableModels,
      encryptedApiKey: nextEncrypted,
      maskedKey: nextMasked,
      hasKey: nextHasKey,
      enabled: input.enabled ?? prev.enabled,
      timeoutMs: Math.max(3000, Math.min(180000, Number(input.timeoutMs) || prev.timeoutMs)),
      maxRequestsPerDay: Math.max(0, Number(input.maxRequestsPerDay ?? prev.maxRequestsPerDay)),
      customHeadersJson: input.customHeadersJson ?? prev.customHeadersJson,
      connectionStatus: hasNewKey ? 'untested' : prev.connectionStatus,
      lastError: hasNewKey ? undefined : prev.lastError,
      updatedAt: now,
    };
    vault.providers[existingIdx] = updated;
    if (input.setAsDefault) {
      vault.defaultProviderId = updated.id;
    }
    await persistVault(vault);
    return {
      defaultProviderId: vault.defaultProviderId,
      provider: toPublicProvider(updated, vault.defaultProviderId),
    };
  }

  const newId = input.id || `provider-${crypto.randomUUID().slice(0, 8)}`;
  const created: StoredAiProvider = {
    id: newId,
    name: input.name.trim() || '自定义 AI 服务',
    kind: input.kind,
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    availableModels: Array.isArray(input.availableModels)
      ? input.availableModels
      : input.model.trim()
      ? [input.model.trim()]
      : [],
    encryptedApiKey: hasNewKey ? await encryptString(trimmedKey) : undefined,
    maskedKey: hasNewKey ? maskSecretKey(trimmedKey) : '',
    hasKey: hasNewKey,
    enabled: input.enabled ?? true,
    timeoutMs: Math.max(3000, Math.min(180000, Number(input.timeoutMs) || 30000)),
    maxRequestsPerDay: Math.max(0, Number(input.maxRequestsPerDay) || 0),
    requestsToday: 0,
    requestsDate: todayIso(),
    connectionStatus: 'untested',
    customHeadersJson: input.customHeadersJson,
    createdAt: now,
    updatedAt: now,
  };

  vault.providers.push(created);
  if (input.setAsDefault || !vault.defaultProviderId) {
    vault.defaultProviderId = created.id;
  }
  await persistVault(vault);
  return {
    defaultProviderId: vault.defaultProviderId,
    provider: toPublicProvider(created, vault.defaultProviderId),
  };
}

export async function clearProviderKey(providerId: string): Promise<PublicAiProvider | null> {
  const vault = await loadVault();
  const target = vault.providers.find((p) => p.id === providerId);
  if (!target) return null;
  target.encryptedApiKey = undefined;
  target.maskedKey = '';
  target.hasKey = false;
  target.connectionStatus = 'untested';
  target.lastError = undefined;
  target.updatedAt = Date.now();
  await persistVault(vault);
  return toPublicProvider(target, vault.defaultProviderId);
}

export async function deleteProvider(providerId: string): Promise<boolean> {
  const vault = await loadVault();
  const before = vault.providers.length;
  vault.providers = vault.providers.filter((p) => p.id !== providerId);
  if (vault.providers.length === before) return false;
  if (vault.defaultProviderId === providerId) {
    vault.defaultProviderId = vault.providers[0]?.id ?? null;
  }
  await persistVault(vault);
  return true;
}

export async function setDefaultProvider(providerId: string): Promise<boolean> {
  const vault = await loadVault();
  if (!vault.providers.some((p) => p.id === providerId)) return false;
  vault.defaultProviderId = providerId;
  await persistVault(vault);
  return true;
}

export async function recordProviderProbeResult(
  providerId: string,
  result: {
    status: ProviderConnectionStatus;
    error?: string;
    latencyMs?: number;
    availableModels?: string[];
  }
): Promise<PublicAiProvider | null> {
  const vault = await loadVault();
  const target = vault.providers.find((p) => p.id === providerId);
  if (!target) return null;
  target.connectionStatus = result.status;
  target.lastError = result.error;
  target.lastCheckedAt = Date.now();
  if (typeof result.latencyMs === 'number') {
    target.lastLatencyMs = result.latencyMs;
  }
  if (result.availableModels && result.availableModels.length > 0) {
    target.availableModels = result.availableModels;
  }
  target.updatedAt = Date.now();
  await persistVault(vault);
  return toPublicProvider(target, vault.defaultProviderId);
}

export async function checkAndIncrementProviderQuota(
  providerId: string
): Promise<{ allowed: boolean; error?: string }> {
  const vault = await loadVault();
  const target = vault.providers.find((p) => p.id === providerId);
  if (!target) return { allowed: false, error: '未找到指定 AI 服务商' };
  const today = todayIso();
  if (target.requestsDate !== today) {
    target.requestsDate = today;
    target.requestsToday = 0;
  }
  if (
    target.maxRequestsPerDay > 0 &&
    target.requestsToday >= target.maxRequestsPerDay
  ) {
    return {
      allowed: false,
      error: `已达到「${target.name}」设定的每日最大请求限制 (${target.maxRequestsPerDay} 次/日)`,
    };
  }
  target.requestsToday += 1;
  await persistVault(vault);
  return { allowed: true };
}

export async function listPublicStemServices(): Promise<{
  activeStemServiceId: string | null;
  services: PublicStemService[];
}> {
  const vault = await loadVault();
  return {
    activeStemServiceId: vault.activeStemServiceId,
    services: vault.stemServices.map((s) =>
      toPublicStemService(s, vault.activeStemServiceId)
    ),
  };
}

export async function getActiveStemServiceWithKey(): Promise<{
  service: StoredStemService;
  apiKey: string;
} | null> {
  const vault = await loadVault();
  const target = vault.stemServices.find(
    (s) => s.id === vault.activeStemServiceId
  );
  if (!target) return null;
  const apiKey = await decryptString(target.encryptedApiKey);
  return { service: target, apiKey };
}

export async function upsertStemService(input: {
  id?: string;
  name: string;
  kind: StemServiceKind;
  baseUrl: string;
  endpointPath: string;
  apiKey?: string;
  clearKey?: boolean;
  enabled?: boolean;
  timeoutMs?: number;
  setActive?: boolean;
}): Promise<{ activeStemServiceId: string | null; service: PublicStemService }> {
  const vault = await loadVault();
  const idx = input.id
    ? vault.stemServices.findIndex((s) => s.id === input.id)
    : -1;
  const trimmedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const hasNewKey = trimmedKey.length > 0;

  if (idx >= 0) {
    const prev = vault.stemServices[idx];
    const nextEncrypted = input.clearKey
      ? undefined
      : hasNewKey
      ? await encryptString(trimmedKey)
      : prev.encryptedApiKey;
    const nextMasked = input.clearKey
      ? ''
      : hasNewKey
      ? maskSecretKey(trimmedKey)
      : prev.maskedKey;
    const nextHasKey =
      prev.kind === 'builtin-mdx'
        ? true
        : input.clearKey
        ? false
        : hasNewKey
        ? true
        : prev.hasKey;

    const updated: StoredStemService = {
      ...prev,
      name: input.name.trim() || prev.name,
      kind: input.kind,
      baseUrl: input.baseUrl.trim(),
      endpointPath: input.endpointPath.trim() || '/separate',
      encryptedApiKey: nextEncrypted,
      maskedKey: nextMasked,
      hasKey: nextHasKey,
      enabled: input.enabled ?? prev.enabled,
      timeoutMs: Math.max(10000, Math.min(600000, Number(input.timeoutMs) || prev.timeoutMs)),
      connectionStatus:
        prev.kind === 'builtin-mdx' ? 'connected' : hasNewKey ? 'untested' : prev.connectionStatus,
    };
    vault.stemServices[idx] = updated;
    if (input.setActive) {
      vault.activeStemServiceId = updated.id;
    }
    await persistVault(vault);
    return {
      activeStemServiceId: vault.activeStemServiceId,
      service: toPublicStemService(updated, vault.activeStemServiceId),
    };
  }

  const newId = input.id || `stem-${crypto.randomUUID().slice(0, 8)}`;
  const created: StoredStemService = {
    id: newId,
    name: input.name.trim() || '自定义音源分离服务',
    kind: input.kind,
    baseUrl: input.baseUrl.trim(),
    endpointPath: input.endpointPath.trim() || '/separate',
    encryptedApiKey: hasNewKey ? await encryptString(trimmedKey) : undefined,
    maskedKey: hasNewKey ? maskSecretKey(trimmedKey) : '',
    hasKey: input.kind === 'builtin-mdx' ? true : hasNewKey,
    enabled: input.enabled ?? true,
    timeoutMs: Math.max(10000, Math.min(600000, Number(input.timeoutMs) || 180000)),
    connectionStatus: 'untested',
  };
  vault.stemServices.push(created);
  if (input.setActive) {
    vault.activeStemServiceId = created.id;
  }
  await persistVault(vault);
  return {
    activeStemServiceId: vault.activeStemServiceId,
    service: toPublicStemService(created, vault.activeStemServiceId),
  };
}

export async function setActiveStemService(serviceId: string | null): Promise<boolean> {
  const vault = await loadVault();
  if (serviceId !== null && !vault.stemServices.some((s) => s.id === serviceId)) {
    return false;
  }
  vault.activeStemServiceId = serviceId;
  await persistVault(vault);
  return true;
}

export async function deleteStemService(serviceId: string): Promise<boolean> {
  if (serviceId === 'stem-builtin-mdx') return false;
  const vault = await loadVault();
  const before = vault.stemServices.length;
  vault.stemServices = vault.stemServices.filter((s) => s.id !== serviceId);
  if (vault.stemServices.length === before) return false;
  if (vault.activeStemServiceId === serviceId) {
    vault.activeStemServiceId = vault.stemServices[0]?.id ?? null;
  }
  await persistVault(vault);
  return true;
}

export async function recordStemServiceProbeResult(
  serviceId: string,
  result: { status: ProviderConnectionStatus; error?: string }
): Promise<PublicStemService | null> {
  const vault = await loadVault();
  const target = vault.stemServices.find((s) => s.id === serviceId);
  if (!target) return null;
  target.connectionStatus = result.status;
  target.lastError = result.error;
  target.lastCheckedAt = Date.now();
  await persistVault(vault);
  return toPublicStemService(target, vault.activeStemServiceId);
}
