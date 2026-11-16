import React, { useState } from 'react';
import {
  Check,
  Disc3,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useMusic } from '../context/MusicContext';
import { formatTime } from '../utils/constants';

export const PlaylistsPage: React.FC = () => {
  const {
    playlists,
    tracks,
    activePalette,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    playPlaylist,
  } = useMusic();

  const [selectedId, setSelectedId] = useState<string | null>(
    playlists[0]?.id || null
  );
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [addingSongsOpen, setAddingSongsOpen] = useState(false);

  const selectedPlaylist =
    playlists.find((p) => p.id === selectedId) || playlists[0] || null;

  const selectedTracks = selectedPlaylist
    ? selectedPlaylist.trackIds
        .map((id) => tracks.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
    : [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const pl = await createPlaylist(newName, newDesc);
    setSelectedId(pl.id);
    setNewName('');
    setNewDesc('');
    setCreating(false);
  };

  return (
    <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            播放列表
          </h1>
          <p className="text-sm text-white/60 mt-1">
            创建、编辑与管理你的个人歌单，随时一键播放
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="px-5 py-2.5 rounded-xl text-sm font-medium text-white flex items-center gap-2 self-start shadow-lg transition-transform active:scale-95 cursor-pointer"
          style={{
            background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
          }}
        >
          <Plus className="w-4 h-4" />
          新建播放列表
        </button>
      </div>

      {/* Create Playlist Form */}
      {creating && (
        <form
          onSubmit={handleCreate}
          className="rounded-3xl bg-white/[0.06] backdrop-blur-xl border border-white/14 p-5 space-y-4 max-w-xl"
        >
          <h2 className="text-sm font-semibold text-white">创建新播放列表</h2>
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="播放列表名称（如：深夜微醺）"
              required
              className="w-full px-4 py-2.5 rounded-xl bg-black/30 border border-white/12 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="简短描述（可选）"
              className="w-full px-4 py-2.5 rounded-xl bg-black/30 border border-white/12 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs text-white/80 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-medium text-white cursor-pointer"
              style={{
                background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
              }}
            >
              创建
            </button>
          </div>
        </form>
      )}

      {/* Dual-Column Playlist Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Playlist List */}
        <div className="lg:col-span-4 space-y-2.5">
          {playlists.length === 0 ? (
            <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-8 text-center space-y-2">
              <ListMusic className="w-8 h-8 text-white/35 mx-auto" />
              <p className="text-sm text-white/70">尚未创建播放列表</p>
              <p className="text-xs text-white/45">点击上方按钮新建你的第一个歌单</p>
            </div>
          ) : (
            playlists.map((pl) => {
              const active = selectedPlaylist?.id === pl.id;
              const firstCover = tracks.find((t) => t.id === pl.trackIds[0])
                ?.coverDataUrl;

              return (
                <div
                  key={pl.id}
                  onClick={() => setSelectedId(pl.id)}
                  className={`p-3.5 rounded-2xl border transition-all flex items-center gap-3.5 cursor-pointer ${
                    active
                      ? 'bg-white/[0.11] border-white/25'
                      : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                    {firstCover ? (
                      <img
                        src={firstCover}
                        alt={pl.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Disc3 className="w-6 h-6 text-white/45" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {editingId === pl.id ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 rounded-lg bg-black/40 border border-white/20 text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            renamePlaylist(pl.id, editName);
                            setEditingId(null);
                          }}
                          className="p-1.5 text-emerald-300 hover:bg-white/10 rounded-lg cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-white truncate">
                          {pl.name}
                        </p>
                        <p className="text-xs text-white/55 font-mono-tabular mt-0.5">
                          {pl.trackIds.length} 首歌曲
                        </p>
                      </>
                    )}
                  </div>

                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(pl.id);
                        setEditName(pl.name);
                      }}
                      title="重命名"
                      className="p-2 rounded-lg text-white/55 hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePlaylist(pl.id)}
                      title="删除播放列表"
                      className="p-2 rounded-lg text-white/45 hover:text-rose-300 hover:bg-white/10 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Selected Playlist Detail & Songs */}
        {selectedPlaylist && (
          <div className="lg:col-span-8 rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="font-display text-xl font-semibold text-white">
                  {selectedPlaylist.name}
                </h2>
                {selectedPlaylist.description && (
                  <p className="text-xs text-white/60 mt-1">
                    {selectedPlaylist.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setAddingSongsOpen((v) => !v)}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/16 border border-white/12 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加曲目
                </button>
                <button
                  type="button"
                  onClick={() => playPlaylist(selectedPlaylist.id)}
                  disabled={selectedTracks.length === 0}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
                  style={{
                    background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  }}
                >
                  <Play className="w-3.5 h-3.5" fill="currentColor" />
                  全部播放
                </button>
              </div>
            </div>

            {addingSongsOpen && (
              <div className="rounded-2xl bg-black/30 border border-white/12 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-white/80">
                    选择要加入「{selectedPlaylist.name}」的曲目
                  </p>
                  <button
                    type="button"
                    onClick={() => setAddingSongsOpen(false)}
                    className="p-1 text-white/55 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto lumina-scroll space-y-1">
                  {tracks.map((t) => {
                    const exists = selectedPlaylist.trackIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={exists}
                        onClick={() => addTrackToPlaylist(selectedPlaylist.id, t.id)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 text-left disabled:opacity-45 cursor-pointer"
                      >
                        <span className="text-xs text-white truncate">
                          {t.title} — <span className="text-white/55">{t.artist}</span>
                        </span>
                        <span className="text-[11px] text-white/60 shrink-0 ml-2">
                          {exists ? '已添加' : '+ 添加'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedTracks.length === 0 ? (
              <p className="text-sm text-white/50 text-center py-10">
                该播放列表暂无曲目，点击「添加曲目」从我的音乐库选取。
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {selectedTracks.map((track, idx) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-white/[0.05] transition-colors"
                  >
                    <span className="w-6 text-xs text-white/40 font-mono-tabular text-center">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => playPlaylist(selectedPlaylist.id, track.id)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <p className="text-sm font-medium text-white truncate">
                        {track.title}
                      </p>
                      <p className="text-xs text-white/55 truncate">
                        {track.artist} · {track.format}
                      </p>
                    </button>
                    <span className="text-xs text-white/55 font-mono-tabular">
                      {formatTime(track.duration)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        removeTrackFromPlaylist(selectedPlaylist.id, track.id)
                      }
                      title="从列表移除"
                      className="p-2 rounded-lg text-white/45 hover:text-rose-300 hover:bg-white/10 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
