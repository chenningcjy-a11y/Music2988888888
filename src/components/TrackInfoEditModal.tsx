import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Disc3, Pencil, X } from 'lucide-react';
import { TrackColorPalette, TrackMetadata } from '../types/music';

interface TrackInfoEditModalProps {
  open: boolean;
  track: TrackMetadata | null;
  palette: TrackColorPalette;
  onClose: () => void;
  onSave: (
    id: string,
    patch: { title: string; artist: string; album: string }
  ) => Promise<void> | void;
}

export const TrackInfoEditModal: React.FC<TrackInfoEditModalProps> = ({
  open,
  track,
  palette,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && track) {
      setTitle(track.title || '');
      setArtist(track.artist || '');
      setAlbum(track.album || '');
    }
  }, [open, track]);

  if (!open || !track) return null;

  const handleSwapTitleArtist = () => {
    setTitle(artist);
    setArtist(title);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setSaving(true);
    try {
      await onSave(track.id, {
        title: nextTitle,
        artist: artist.trim() || '未知艺术家',
        album: album.trim() || '本地音乐',
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-[#180710]/95 border border-white/15 shadow-2xl p-5 sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0 border border-white/15">
              {track.coverDataUrl ? (
                <img
                  src={track.coverDataUrl}
                  alt={track.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-5 h-5 text-white/55" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5 shrink-0" style={{ color: palette.primary }} />
                <h3 className="text-base font-semibold text-white truncate">
                  修改文件名与歌曲信息
                </h3>
              </div>
              <p className="text-xs text-white/55 font-mono-tabular truncate mt-0.5">
                {track.format}
                {track.sampleRate ? ` · ${Math.round(track.sampleRate / 1000)}kHz` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="p-1.5 rounded-xl text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-white/80">
                歌曲名称
              </label>
              <button
                type="button"
                onClick={handleSwapTitleArtist}
                className="text-[11px] text-white/65 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/8 hover:bg-white/14 transition-colors cursor-pointer"
                title="当「名称 - 人物」识别顺序反了时可一键互换"
              >
                <ArrowLeftRight className="w-3 h-3" />
                <span>互换名称与人物</span>
              </button>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入歌曲名称"
              required
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white placeholder-white/35 focus:outline-none focus:border-white/35"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-white/80 block mb-1.5">
              歌手 / 人物
            </label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="输入歌手或人物名称（留空则显示未知艺术家）"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white placeholder-white/35 focus:outline-none focus:border-white/35"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-white/80 block mb-1.5">
              专辑名称（可选）
            </label>
            <input
              type="text"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="输入专辑名称（默认：本地音乐）"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/35 border border-white/15 text-sm text-white placeholder-white/35 focus:outline-none focus:border-white/35"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-xs font-medium text-white/80 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg disabled:opacity-50 cursor-pointer"
              style={{
                background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
              }}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? '保存中...' : '保存修改'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
