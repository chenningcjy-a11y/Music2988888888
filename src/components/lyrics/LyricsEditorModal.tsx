import React, { useEffect, useState } from 'react';
import { Clock, Save, X } from 'lucide-react';
import { TrackColorPalette, TrackMetadata } from '../../types/music';

interface LyricsEditorModalProps {
  open: boolean;
  track: TrackMetadata | null;
  currentTime: number;
  palette: TrackColorPalette;
  onClose: () => void;
  onSave: (rawLrc: string) => void;
}

function formatLrcTimestamp(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  const wholeSec = Math.floor(rem);
  const centis = Math.floor((rem - wholeSec) * 100);
  return `[${String(mins).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${String(
    centis
  ).padStart(2, '0')}]`;
}

export const LyricsEditorModal: React.FC<LyricsEditorModalProps> = ({
  open,
  track,
  currentTime,
  palette,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open && track) {
      setDraft(track.lyricsRaw || '');
    }
  }, [open, track]);

  if (!open || !track) return null;

  const insertTimestampAtTopOrEnd = () => {
    const tag = formatLrcTimestamp(currentTime);
    setDraft((prev) => (prev ? `${prev}\n${tag} ` : `${tag} `));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-2xl max-h-[88vh] bg-[#1b0711]/95 backdrop-blur-2xl border border-white/14 rounded-3xl flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white truncate">
              歌词编辑器 · {track.title}
            </h3>
            <p className="text-xs text-white/55 mt-0.5">
              支持标准 LRC 时间轴、双语 (`原词 // 译文`) 及逐字时间戳 (`&lt;mm:ss.xx&gt;`)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={insertTimestampAtTopOrEnd}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/12 text-xs text-white/85 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              插入当前播放时间 {formatLrcTimestamp(currentTime)}
            </button>
            <span className="text-xs text-white/45 font-mono-tabular">
              {draft.split('\n').filter((l) => l.trim()).length} 行
            </span>
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`[00:12.40]第一句歌词 // First line translation\n[00:18.00]第二句歌词`}
            className="flex-1 min-h-[280px] w-full p-4 rounded-2xl bg-black/35 border border-white/12 text-sm text-white/90 font-mono-tabular leading-relaxed focus:outline-none focus:border-white/35 resize-none lumina-scroll"
          />
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-medium text-white/80 transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="px-5 py-2 rounded-xl text-xs font-medium text-white flex items-center gap-1.5 shadow-lg transition-transform active:scale-95 cursor-pointer"
            style={{
              background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
            }}
          >
            <Save className="w-3.5 h-3.5" />
            保存歌词
          </button>
        </div>
      </div>
    </div>
  );
};
