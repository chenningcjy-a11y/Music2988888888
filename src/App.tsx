import React from 'react';
import {
  Bot,
  Disc3,
  Film,
  FolderHeart,
  ListChecks,
  ListMusic,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Palette,
  Pause,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QueueDrawer } from './components/QueueDrawer';
import { DynamicBackground } from './components/visualizers/DynamicBackground';
import { AiProvider } from './context/AiContext';
import { MusicProvider, useMusic } from './context/MusicContext';
import { TaskCenterProvider, useTaskCenter } from './context/TaskCenterContext';
import { AiCenterPage } from './pages/AiCenterPage';
import { AiTasksPage } from './pages/AiTasksPage';
import { AudioDspPage } from './pages/AudioDspPage';
import { LibraryPage } from './pages/LibraryPage';
import { LyricsPage } from './pages/LyricsPage';
import { MvPage } from './pages/MvPage';
import { MvStandalonePage } from './pages/MvStandalonePage';
import { PlayerPage } from './pages/PlayerPage';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NavPage } from './types/music';

const NAV_ITEMS: {
  id: NavPage;
  label: string;
  shortLabel: string;
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
}[] = [
  { id: 'player', label: '播放器主页', shortLabel: '播放', icon: Disc3 },
  { id: 'library', label: '我的音乐', shortLabel: '音乐', icon: FolderHeart },
  { id: 'playlists', label: '播放列表', shortLabel: '歌单', icon: ListMusic },
  { id: 'lyrics', label: '歌词中心', shortLabel: '歌词', icon: MessageSquareText },
  { id: 'mv', label: 'MV 剧场', shortLabel: 'MV', icon: Film },
  { id: 'audio', label: '音质与音效', shortLabel: '音效', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI 智能中心', shortLabel: 'AI', icon: Bot },
  { id: 'tasks', label: 'AI 任务中心', shortLabel: '任务', icon: ListChecks },
  { id: 'settings', label: '个性化设置', shortLabel: '设置', icon: Palette },
];

const LuminaShell: React.FC = () => {
  const {
    activePage,
    setActivePage,
    currentTrack,
    isPlaying,
    togglePlayPause,
    activePalette,
    personalization,
    toastMessage,
    isFullscreen,
    toggleFullscreen,
    exitFullscreen,
  } = useMusic();
  const { runningCount, queuedCount } = useTaskCenter();
  const activeTaskCount = runningCount + queuedCount;

  const fontClass =
    personalization.fontPreset === 'editorial'
      ? 'font-serif-editorial'
      : personalization.fontPreset === 'rounded'
      ? 'font-sans-rounded'
      : personalization.fontPreset === 'mono'
      ? 'font-mono-audiophile'
      : personalization.fontPreset === 'classic'
      ? 'font-sans-classic'
      : 'font-sans-modern';

  return (
    <div className={`relative flex flex-col md:flex-row h-screen w-screen overflow-hidden ${fontClass}`}>
      {/* Real-time Audio-Reactive Liquid Fluid Background */}
      <DynamicBackground
        palette={activePalette}
        isPlaying={isPlaying}
        dynamicGlow={personalization.dynamicBackgroundGlow}
        glowIntensity={personalization.glowIntensity}
        animationIntensity={personalization.animationIntensity}
        reducedMotion={Boolean(personalization.reducedMotion)}
        isFullscreen={isFullscreen}
      />

      {/* Desktop & Landscape Tablet Left Glass Navigation Rail */}
      {!isFullscreen && (
        <aside className="hidden md:flex flex-col justify-between w-20 lg:w-60 shrink-0 h-full bg-black/25 backdrop-blur-2xl border-r border-white/10 p-3 lg:p-4 z-20">
        <div className="space-y-6">
          {/* Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActivePage('player')}
            className="w-full flex items-center justify-center lg:justify-start gap-3 px-2 py-2 cursor-pointer"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              <Disc3 className="w-5 h-5 text-white" />
            </div>
            <span className="hidden lg:inline font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
              LUMINA MUSIC
            </span>
          </button>

          {/* Navigation Items */}
          <nav aria-label="主导航" className="space-y-1.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.id)}
                  title={item.label}
                  className={`w-full min-h-[44px] flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white/14 text-white shadow-sm border border-white/12'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.06] border border-transparent'
                  }`}
                >
                  <Icon
                    className="w-5 h-5 shrink-0"
                    style={active ? { color: activePalette.primary } : undefined}
                  />
                  <span className="hidden lg:inline truncate flex-1 text-left">
                    {item.label}
                  </span>
                  {item.id === 'tasks' && activeTaskCount > 0 && (
                    <span className="hidden lg:inline font-mono-tabular text-xs font-semibold text-white/85">
                      {activeTaskCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={toggleFullscreen}
            title="全屏展示"
            className="w-full min-h-[44px] flex items-center justify-center lg:justify-start gap-3 px-3 py-2 rounded-2xl text-xs font-medium text-white/70 hover:text-white bg-white/[0.05] hover:bg-white/[0.11] border border-white/10 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Maximize2 className="w-4 h-4 shrink-0" />
            <span className="hidden lg:inline">全屏展示</span>
          </button>

          {/* Mini Docked Now-Playing Control on Sidebar when away from Player */}
          {currentTrack && activePage !== 'player' && (
            <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-2.5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setActivePage('player')}
                className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-white/10 cursor-pointer"
              >
                {currentTrack.coverDataUrl && (
                  <img
                    src={currentTrack.coverDataUrl}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActivePage('player')}
                className="hidden lg:block flex-1 min-w-0 text-left cursor-pointer"
              >
                <p className="text-xs font-medium text-white truncate">
                  {currentTrack.title}
                </p>
                <p className="text-[11px] text-white/55 truncate">
                  {currentTrack.artist}
                </p>
              </button>
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? '暂停' : '播放'}
                className="hidden lg:flex w-8 h-8 rounded-full items-center justify-center text-white shrink-0 cursor-pointer"
                style={{ backgroundColor: activePalette.primary }}
              >
                {isPlaying ? (
                  <Pause className="w-3.5 h-3.5" fill="currentColor" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                )}
              </button>
            </div>
          )}
        </div>
        </aside>
      )}

      {/* Main Content Stage */}
      <main
        className={`flex-1 h-full min-w-0 min-h-0 overflow-hidden relative z-10 ${
          isFullscreen ? 'pb-0' : 'pb-14 md:pb-0'
        }`}
      >
        {activePage === 'player' && <PlayerPage />}
        {activePage === 'library' && <LibraryPage />}
        {activePage === 'playlists' && <PlaylistsPage />}
        {activePage === 'lyrics' && <LyricsPage />}
        {activePage === 'mv' && <MvPage />}
        {activePage === 'audio' && <AudioDspPage />}
        {activePage === 'ai' && <AiCenterPage />}
        {activePage === 'tasks' && <AiTasksPage />}
        {activePage === 'settings' && <SettingsPage />}
      </main>

      {/* Floating Exit Fullscreen Control (for non-player pages) */}
      {isFullscreen && activePage !== 'player' && (
        <button
          type="button"
          onClick={exitFullscreen}
          aria-label="退出全屏"
          title="退出全屏 (ESC)"
          className="fixed top-4 right-4 z-40 min-h-[44px] px-3.5 py-2 rounded-2xl bg-black/45 hover:bg-black/65 backdrop-blur-xl border border-white/15 text-xs font-medium text-white/85 hover:text-white flex items-center gap-1.5 shadow-xl transition-all cursor-pointer"
        >
          <Minimize2 className="w-4 h-4" />
          <span>退出全屏</span>
        </button>
      )}

      {/* Mobile Portrait Fixed Bottom Navigation Bar (compact <= 10% viewport height) */}
      {!isFullscreen && (
        <nav
          aria-label="底部导航"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-[#14050c]/88 backdrop-blur-xl border-t border-white/12 grid grid-cols-9 items-center px-0.5"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className="h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer relative"
                style={{
                  color: active ? activePalette.primary : 'rgba(255,255,255,0.58)',
                }}
              >
                <Icon className="w-[17px] h-[17px]" />
                <span className="text-[10px] font-medium whitespace-nowrap">
                  {item.id === 'tasks' && activeTaskCount > 0
                    ? `${item.shortLabel}(${activeTaskCount})`
                    : item.shortLabel}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Slide-over Queue Drawer */}
      <QueueDrawer />

      {/* Non-intrusive Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 max-w-sm px-4 py-2.5 rounded-2xl bg-[#1f0914]/92 backdrop-blur-xl border border-white/15 text-xs text-white shadow-2xl pointer-events-none">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const isMvStandalone =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mvTheater') === '1';

  if (isMvStandalone) {
    return (
      <ErrorBoundary>
        <MvStandalonePage />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <MusicProvider>
        <TaskCenterProvider>
          <AiProvider>
            <LuminaShell />
          </AiProvider>
        </TaskCenterProvider>
      </MusicProvider>
    </ErrorBoundary>
  );
}
