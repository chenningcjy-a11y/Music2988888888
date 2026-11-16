import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { inferClientModelCapabilities } from '../services/ai';
import {
  AiProviderConfig,
  AiSubTab,
  AiTaskRecord,
  ModelCapabilities,
  StemServiceConfig,
} from '../types/ai';
import { TrackMetadata } from '../types/music';
import {
  fetchProviders,
  fetchStemServices,
} from '../services/ai/providerManager';
import { useMusic } from './MusicContext';
import { useTaskCenter } from './TaskCenterContext';

interface AiContextValue {
  aiSubTab: AiSubTab;
  setAiSubTab: (tab: AiSubTab) => void;
  openAiCenter: (tab: AiSubTab) => void;

  providers: AiProviderConfig[];
  defaultProviderId: string | null;
  selectedProviderId: string;
  setSelectedProviderId: (id: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  activeProvider: AiProviderConfig | null;
  activeCapabilities: ModelCapabilities;
  isLoadingProviders: boolean;
  refreshProviders: () => Promise<void>;

  stemServices: StemServiceConfig[];
  activeStemServiceId: string | null;
  activeStemService: StemServiceConfig | null;
  refreshStemServices: () => Promise<void>;

  taskHistory: AiTaskRecord[];
  activeTaskId: string | null;
  beginTask: (params: {
    taskName: string;
    category: AiTaskRecord['category'];
    providerName: string;
    modelName: string;
    track?: TrackMetadata | null;
    trackTitle?: string;
    replayPayload?: AiTaskRecord['replayPayload'];
  }) => { task: AiTaskRecord; signal: AbortSignal };
  updateTask: (id: string, patch: Partial<AiTaskRecord>) => void;
  finishTask: (
    id: string,
    status: AiTaskRecord['status'],
    extra?: Partial<AiTaskRecord>
  ) => void;
  cancelActiveTask: () => void;
  clearTaskHistory: () => Promise<void>;
}

const AiContext = createContext<AiContextValue | null>(null);

export const AiProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { setActivePage } = useMusic();
  const {
    tasks,
    beginAdHocTask,
    updateTask: tcUpdateTask,
    finishTask: tcFinishTask,
    cancelTask,
    clearCompletedOrAllTasks,
  } = useTaskCenter();

  const [aiSubTab, setAiSubTab] = useState<AiSubTab>('assistant');
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderIdState] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  const [stemServices, setStemServices] = useState<StemServiceConfig[]>([]);
  const [activeStemServiceId, setActiveStemServiceId] = useState<string | null>(null);

  const [activeAdHocTaskId, setActiveAdHocTaskId] = useState<string | null>(null);
  const activeAdHocIdRef = useRef<string | null>(null);

  const refreshProviders = useCallback(async () => {
    setIsLoadingProviders(true);
    try {
      const data = await fetchProviders();
      setProviders(data.providers);
      setDefaultProviderId(data.defaultProviderId);
      setSelectedProviderIdState((prev) => {
        if (prev && data.providers.some((p) => p.id === prev)) {
          return prev;
        }
        return data.defaultProviderId || data.providers[0]?.id || '';
      });
    } catch {
      // keep previous state
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  const refreshStemServices = useCallback(async () => {
    try {
      const data = await fetchStemServices();
      setStemServices(data.services);
      setActiveStemServiceId(data.activeStemServiceId);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
    void refreshStemServices();
  }, [refreshProviders, refreshStemServices]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) || null,
    [providers, selectedProviderId]
  );

  useEffect(() => {
    if (activeProvider) {
      setSelectedModel((prev) => {
        if (
          prev &&
          (activeProvider.model === prev ||
            activeProvider.availableModels.includes(prev))
        ) {
          return prev;
        }
        return activeProvider.model;
      });
    } else {
      setSelectedModel('');
    }
  }, [activeProvider]);

  const setSelectedProviderId = useCallback(
    (id: string) => {
      setSelectedProviderIdState(id);
      const found = providers.find((p) => p.id === id);
      if (found) {
        setSelectedModel(found.model);
      }
    },
    [providers]
  );

  const activeCapabilities = useMemo<ModelCapabilities>(() => {
    if (!activeProvider) {
      return {
        textReasoning: false,
        lyricsProcessing: false,
        dspPlanning: false,
        audioInputAnalysis: false,
        stemSeparation: false,
        note: '尚未配置可用 AI 服务商',
      };
    }
    return inferClientModelCapabilities(
      activeProvider.kind,
      selectedModel || activeProvider.model
    );
  }, [activeProvider, selectedModel]);

  const activeStemService = useMemo(
    () => stemServices.find((s) => s.id === activeStemServiceId) || null,
    [stemServices, activeStemServiceId]
  );

  const openAiCenter = useCallback(
    (tab: AiSubTab) => {
      setAiSubTab(tab);
      setActivePage('ai');
    },
    [setActivePage]
  );

  const beginTask = useCallback(
    (params: {
      taskName: string;
      category: AiTaskRecord['category'];
      providerName: string;
      modelName: string;
      track?: TrackMetadata | null;
      trackTitle?: string;
      replayPayload?: AiTaskRecord['replayPayload'];
    }) => {
      const res = beginAdHocTask(params);
      activeAdHocIdRef.current = res.task.id;
      setActiveAdHocTaskId(res.task.id);
      return res;
    },
    [beginAdHocTask]
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<AiTaskRecord>) => {
      tcUpdateTask(id, patch);
    },
    [tcUpdateTask]
  );

  const finishTask = useCallback(
    (
      id: string,
      status: AiTaskRecord['status'],
      extra?: Partial<AiTaskRecord>
    ) => {
      if (activeAdHocIdRef.current === id) {
        activeAdHocIdRef.current = null;
        setActiveAdHocTaskId(null);
      }
      tcFinishTask(id, status, extra);
    },
    [tcFinishTask]
  );

  const cancelActiveTask = useCallback(() => {
    const id = activeAdHocIdRef.current;
    if (id) {
      activeAdHocIdRef.current = null;
      setActiveAdHocTaskId(null);
      void cancelTask(id);
    }
  }, [cancelTask]);

  return (
    <AiContext.Provider
      value={{
        aiSubTab,
        setAiSubTab,
        openAiCenter,
        providers,
        defaultProviderId,
        selectedProviderId,
        setSelectedProviderId,
        selectedModel,
        setSelectedModel,
        activeProvider,
        activeCapabilities,
        isLoadingProviders,
        refreshProviders,
        stemServices,
        activeStemServiceId,
        activeStemService,
        refreshStemServices,
        taskHistory: tasks,
        activeTaskId: activeAdHocTaskId,
        beginTask,
        updateTask,
        finishTask,
        cancelActiveTask,
        clearTaskHistory: clearCompletedOrAllTasks,
      }}
    >
      {children}
    </AiContext.Provider>
  );
};

export function useAi(): AiContextValue {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error('useAi must be used within AiProvider');
  return ctx;
}
