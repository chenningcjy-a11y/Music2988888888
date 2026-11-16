import React, { useState } from 'react';
import { Bot, History, KeyRound, Wrench } from 'lucide-react';
import { AiAssistantTab } from '../components/ai/AiAssistantTab';
import { AiHistoryTab } from '../components/ai/AiHistoryTab';
import { AiProvidersTab } from '../components/ai/AiProvidersTab';
import { AiToolboxTab } from '../components/ai/AiToolboxTab';
import { useAi } from '../context/AiContext';
import { useMusic } from '../context/MusicContext';
import { AiSubTab, AiTaskRecord } from '../types/ai';

const SUB_TABS: {
  id: AiSubTab;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'assistant', label: 'AI 助手', icon: Bot },
  { id: 'toolbox', label: 'AI 音乐工具箱', icon: Wrench },
  { id: 'providers', label: 'API 服务管理', icon: KeyRound },
  { id: 'history', label: '任务记录', icon: History },
];

export const AiCenterPage: React.FC = () => {
  const { aiSubTab, setAiSubTab, activeProvider, activeStemService } = useAi();
  const { activePalette, setActivePage } = useMusic();
  const [replayTrigger, setReplayTrigger] = useState<{
    id: number;
    prompt: string;
  } | null>(null);

  const handleReplay = (task: AiTaskRecord) => {
    if (!task.replayPayload?.prompt) return;
    setAiSubTab('assistant');
    setReplayTrigger({
      id: Date.now(),
      prompt: task.replayPayload.prompt,
    });
  };

  return (
    <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6">
      {/* Header + Breadcrumb */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-white/50 mb-1">
            <button
              type="button"
              onClick={() => setActivePage('settings')}
              className="hover:text-white cursor-pointer"
            >
              设置
            </button>
            <span>/</span>
            <span className="text-white/75">AI 智能中心</span>
            <span>/</span>
            <span className="text-white">
              {SUB_TABS.find((t) => t.id === aiSubTab)?.label}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            AI 智能中心
          </h1>
          <p className="text-xs sm:text-sm text-white/60 mt-1">
            {activeProvider
              ? `默认对话服务：${activeProvider.name} (${activeProvider.model || '未选模型'})`
              : '尚未配置默认 AI 服务'}
            {' · '}
            {activeStemService && activeStemService.enabled
              ? `音源分离服务：${activeStemService.name}`
              : '音源分离服务：未启用'}
          </p>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-black/35 border border-white/12 self-start lg:self-auto">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = aiSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAiSubTab(tab.id)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-white shadow-md'
                    : 'text-white/65 hover:text-white hover:bg-white/[0.06]'
                }`}
                style={
                  active
                    ? {
                        background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                      }
                    : undefined
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {aiSubTab === 'assistant' && (
        <AiAssistantTab externalPromptTrigger={replayTrigger} />
      )}
      {aiSubTab === 'toolbox' && <AiToolboxTab />}
      {aiSubTab === 'providers' && <AiProvidersTab />}
      {aiSubTab === 'history' && <AiHistoryTab onReplayTask={handleReplay} />}
    </div>
  );
};
