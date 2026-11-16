import React, { useMemo, useRef, useState } from 'react';
import {
  FolderPlus,
  Heart,
  ImagePlus,
  ListPlus,
  Music2,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMusic } from '../context/MusicContext';
import {
  formatBitrate,
  formatFileSize,
  formatSampleRate,
  formatTime,
} from '../utils/constants';

export const LibraryPage: React.FC = () => {
  const {
    tracks,
    playlists,
    currentTrack,
    isPlaying,
    activePalette,
    isImporting,
    importProgress,
    importLocalFiles,
    playTrackById,
    setActivePage,
    toggleFavorite,
    deleteTrack,
    enqueueTrack,
    addTrackToPlaylist,
    updateTrackCover,
    loadDemoLibrary,
    personalization,
    updatePersonalization,
  } = useMusic();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [coverTargetTrackId, setCoverTargetTrackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'favorites'>('all');
  const [dragOver, setDragOver] = useState(false);
  const [playlistMenuTrackId, setPlaylistMenuTrackId] = useState<string | null>(null);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tracks.filter((t) => {
      if (filterMode === 'favorites' && !t.favorite) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.format.toLowerCase().includes(q)
      );
    });
  }, [tracks, searchQuery, filterMode]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await importLocalFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp3,.flac,.wav,.aac,.m4a,.ogg,.opus,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            importLocalFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && coverTargetTrackId) {
            updateTrackCover(coverTargetTrackId, f);
          }
          setCoverTargetTrackId(null);
          e.target.value = '';
        }}
      />

      {/* Header & Batch Import Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            我的音乐库
          </h1>
          <p className="text-sm text-white/60 mt-1">
            支持批量导入 MP3 · FLAC · WAV · AAC · M4A · OGG · OPUS，元数据与音频自动持久化至本地 IndexedDB
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 bg-white/[0.06] border border-white/10 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => updatePersonalization({ importMode: 'lean' })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                (personalization.importMode || 'lean') === 'lean'
                  ? 'bg-white/16 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
              title="仅导入音源与专辑封面，不自动导入外部或内嵌歌词"
            >
              精简导入 (推荐)
            </button>
            <button
              type="button"
              onClick={() => updatePersonalization({ importMode: 'full' })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                personalization.importMode === 'full'
                  ? 'bg-white/16 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
              title="完整导入，包含音频、封面及内嵌歌词"
            >
              完整导入
            </button>
          </div>

          {tracks.length === 0 && (
            <button
              type="button"
              onClick={loadDemoLibrary}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 text-xs font-medium text-white flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              加载内置示例
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white flex items-center gap-2 shadow-lg transition-transform active:scale-95 disabled:opacity-60 cursor-pointer whitespace-nowrap"
            style={{
              background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
            }}
          >
            <FolderPlus className="w-4 h-4" />
            {isImporting ? '正在导入...' : '批量导入本地音乐'}
          </button>
        </div>
      </div>

      {/* Drag & Drop Dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-2xl border border-dashed transition-all p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 cursor-pointer ${
          dragOver
            ? 'border-rose-400 bg-rose-500/15'
            : 'border-white/15 bg-white/[0.035] hover:bg-white/[0.06]'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${activePalette.primary}29` }}
          >
            <Upload className="w-5 h-5" style={{ color: activePalette.primary }} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              {importProgress || '点击选择或拖拽音频文件至此处批量导入'}
            </p>
            <p className="text-xs text-white/55 mt-0.5">
              自动提取曲名、歌手、专辑、内嵌封面、时长、格式、采样率与码率（兼容 Android 平板文件管理器）
            </p>
          </div>
        </div>
        <span className="text-xs text-white/50 font-mono-tabular shrink-0">
          共 {tracks.length} 首曲目
        </span>
      </div>

      {/* Search + Segmented Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-white/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索歌曲、艺术家、专辑或格式..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/12 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.06] border border-white/10 self-start">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === 'all'
                ? 'bg-white/16 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            全部歌曲 ({tracks.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('favorites')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === 'favorites'
                ? 'bg-white/16 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            我的收藏 ({tracks.filter((t) => t.favorite).length})
          </button>
        </div>
      </div>

      {/* Track List */}
      {filteredTracks.length === 0 ? (
        <div className="rounded-3xl bg-white/[0.03] border border-white/10 p-12 text-center flex flex-col items-center gap-3">
          <Music2 className="w-10 h-10 text-white/35" />
          <p className="text-sm text-white/75">
            {searchQuery
              ? '未找到匹配的歌曲'
              : filterMode === 'favorites'
              ? '暂无收藏的歌曲'
              : '曲库还是空的，快导入本地音乐吧'}
          </p>
        </div>
      ) : (
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 divide-y divide-white/[0.06] overflow-visible">
          {filteredTracks.map((track) => {
            const active = currentTrack?.id === track.id;
            return (
              <div
                key={track.id}
                className={`relative flex items-center gap-3 sm:gap-4 px-3.5 sm:px-5 py-3 transition-colors ${
                  active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
                }`}
              >
                {/* Cover Thumbnail */}
                <button
                  type="button"
                  onClick={async () => {
                    await playTrackById(
                      track.id,
                      filteredTracks.map((t) => t.id)
                    );
                    setActivePage('player');
                  }}
                  className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/10 group cursor-pointer"
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
                    className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Play
                      className="w-5 h-5 text-white"
                      fill={active && isPlaying ? 'currentColor' : 'none'}
                    />
                  </div>
                </button>

                {/* Title, Artist, Album & Unboxed Real Technical Metadata */}
                <button
                  type="button"
                  onClick={async () => {
                    await playTrackById(
                      track.id,
                      filteredTracks.map((t) => t.id)
                    );
                    setActivePage('player');
                  }}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <p
                    className="text-sm sm:text-[15px] font-medium truncate"
                    style={{ color: active ? activePalette.primary : '#ffffff' }}
                  >
                    {track.title}
                  </p>
                  <p className="text-xs text-white/60 truncate mt-0.5">
                    {track.artist} · {track.album}
                  </p>
                  <p className="text-[11px] text-white/45 font-mono-tabular truncate mt-0.5 sm:hidden">
                    {track.format} · {formatTime(track.duration)}
                  </p>
                </button>

                {/* Desktop/Tablet Metadata Columns */}
                <div className="hidden md:flex items-center gap-4 text-xs text-white/55 font-mono-tabular shrink-0">
                  <span>{track.format}</span>
                  {track.sampleRate && <span>{formatSampleRate(track.sampleRate)}</span>}
                  {track.bitrate && <span>{formatBitrate(track.bitrate)}</span>}
                  <span>{formatFileSize(track.fileSize)}</span>
                  <span className="w-12 text-right text-white/75">
                    {formatTime(track.duration)}
                  </span>
                </div>

                {/* Row Actions */}
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(track.id)}
                    title="收藏"
                    aria-label="收藏"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    style={{
                      color: track.favorite
                        ? activePalette.primary
                        : 'rgba(255,255,255,0.55)',
                    }}
                  >
                    <Heart
                      className="w-4 h-4"
                      fill={track.favorite ? 'currentColor' : 'none'}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCoverTargetTrackId(track.id);
                      coverInputRef.current?.click();
                    }}
                    title="设置专辑封面"
                    aria-label="设置专辑封面"
                    className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-xl text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => enqueueTrack(track.id)}
                    title="加入播放队列"
                    aria-label="加入播放队列"
                    className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-xl text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <ListPlus className="w-4 h-4" />
                  </button>

                  {/* Add to Playlist Menu Trigger */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setPlaylistMenuTrackId(
                          playlistMenuTrackId === track.id ? null : track.id
                        )
                      }
                      title="添加到播放列表"
                      aria-label="添加到播放列表"
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    {playlistMenuTrackId === track.id && (
                      <div className="absolute right-0 top-11 z-30 w-48 rounded-2xl bg-[#220a16]/95 backdrop-blur-xl border border-white/15 p-1.5 shadow-2xl">
                        <p className="px-2.5 py-1 text-[11px] text-white/50">
                          添加到播放列表
                        </p>
                        {playlists.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPlaylistMenuTrackId(null);
                              setActivePage('playlists');
                            }}
                            className="w-full text-left px-2.5 py-2 text-xs text-rose-300 hover:bg-white/10 rounded-xl cursor-pointer"
                          >
                            暂无列表，去创建 →
                          </button>
                        ) : (
                          playlists.map((pl) => (
                            <button
                              key={pl.id}
                              type="button"
                              onClick={() => {
                                addTrackToPlaylist(pl.id, track.id);
                                setPlaylistMenuTrackId(null);
                              }}
                              className="w-full text-left px-2.5 py-2 text-xs text-white/85 hover:bg-white/10 rounded-xl truncate cursor-pointer"
                            >
                              {pl.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => deleteTrack(track.id)}
                    title="删除歌曲"
                    aria-label="删除歌曲"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-white/45 hover:text-rose-300 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
