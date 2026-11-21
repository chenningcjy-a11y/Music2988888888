import React from 'react';
import { ListMusic, Play, Trash2, X } from 'lucide-react';
import { useMusic } from '../context/MusicContext';
import { formatTime } from '../utils/constants';

export const QueueDrawer: React.FC = () => {
  const {
    isQueueOpen,
    setIsQueueOpen,
    queueIds,
    tracks,
    currentTrack,
    isPlaying,
    shuffle,
    shufflePlayedIds,
    playTrackById,
    removeFromQueue,
    clearQueue,
    activePalette,
  } = useMusic();

  if (!isQueueOpen) return null;

  const queuedTracks = queueIds
    .map((id) => tracks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const shufflePlayedSet = new Set(shufflePlayedIds);
  const playedInCycleCount = queuedTracks.filter((t) =>
    shufflePlayedSet.has(t.id)
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        onClick={() => setIsQueueOpen(false)}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <aside className="relative z-10 w-full max-w-md h-full bg-[#1a0710]/90 backdrop-blur-2xl border-l border-white/12 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <ListMusic className="w-5 h-5 shrink-0" style={{ color: activePalette.primary }} />
            <h2 className="text-base font-semibold text-white shrink-0">播放队列</h2>
            <span className="text-xs text-white/50 font-mono-tabular truncate">
              {queuedTracks.length} 首
              {shuffle && queuedTracks.length > 1
                ? ` · 本轮随机 ${playedInCycleCount}/${queuedTracks.length}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {queuedTracks.length > 1 && (
              <button
                type="button"
                onClick={clearQueue}
                className="px-2.5 py-1.5 text-xs text-white/70 hover:text-white bg-white/6 hover:bg-white/12 rounded-lg transition-colors cursor-pointer"
              >
                清空队列
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsQueueOpen(false)}
              aria-label="关闭队列"
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto lumina-scroll p-3 space-y-1">
          {queuedTracks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/50 text-sm py-12">
              播放队列为空
            </div>
          ) : (
            queuedTracks.map((track, idx) => {
              const active = currentTrack?.id === track.id;
              const alreadyPlayedInShuffle =
                shuffle && !active && shufflePlayedSet.has(track.id);
              return (
                <div
                  key={`${track.id}-${idx}`}
                  className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors group ${
                    active
                      ? 'bg-white/12 border border-white/15'
                      : alreadyPlayedInShuffle
                      ? 'opacity-60 hover:opacity-100 hover:bg-white/[0.06]'
                      : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playTrackById(track.id)}
                    className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/10 cursor-pointer"
                  >
                    {track.coverDataUrl && (
                      <img
                        src={track.coverDataUrl}
                        alt={track.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div
                      className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${
                        active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Play
                        className="w-4 h-4 text-white"
                        fill={active && isPlaying ? 'currentColor' : 'none'}
                      />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => playTrackById(track.id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: active ? activePalette.primary : '#ffffff' }}
                    >
                      {track.title}
                    </p>
                    <p className="text-xs text-white/55 truncate mt-0.5">
                      {track.artist} · <span className="font-mono-tabular">{formatTime(track.duration)}</span>
                      {alreadyPlayedInShuffle ? ' · 本轮已随机' : ''}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => removeFromQueue(track.id)}
                    aria-label="移出队列"
                    className="p-2 rounded-lg text-white/40 hover:text-rose-300 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
