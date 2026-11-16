import React from 'react';
import {
  AudioLines,
  Headphones,
  Info,
  Mic2,
  Power,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { StemSeparationPanel } from '../components/audio/StemSeparationPanel';
import { VocalBackgroundControl } from '../components/audio/VocalBackgroundControl';
import { useMusic } from '../context/MusicContext';
import { EqPresetName, QualityMode } from '../types/music';
import {
  EQ_BANDS,
  EQ_PRESETS,
  formatBitrate,
  formatSampleRate,
} from '../utils/constants';

const QUALITY_MODES: {
  id: QualityMode;
  label: string;
  desc: string;
}[] = [
  {
    id: 'original',
    label: '原始音质 (直通)',
    desc: '完全绕过 EQ 与音效处理链路，以源文件原生信号直出。',
  },
  {
    id: 'high',
    label: '高品质播放',
    desc: '启用 Web Audio 实时音效管线与防削波动态保护。',
  },
  {
    id: 'lossless',
    label: '无损音频播放',
    desc: '针对 FLAC / WAV 等无损源文件保持全频段动态与高精度混音。',
  },
  {
    id: 'auto',
    label: '自动匹配最佳音质',
    desc: '依据当前曲目编码与设备采样率自动匹配最优播放策略。',
  },
];

export const AudioDspPage: React.FC = () => {
  const {
    currentTrack,
    audioSettings,
    activePalette,
    currentTrackStemMeta,
    updateAudioSettings,
    resetAudioSettings,
  } = useMusic();

  const presetNames = Object.keys(EQ_PRESETS) as Exclude<EqPresetName, '自定义'>[];
  const isBypassed = !audioSettings.masterEnabled || audioSettings.qualityMode === 'original';

  const handlePresetClick = (preset: Exclude<EqPresetName, '自定义'>) => {
    updateAudioSettings({
      eqPreset: preset,
      eqGains: [...EQ_PRESETS[preset]],
    });
  };

  const handleEqBandChange = (index: number, gainDb: number) => {
    const next = [...audioSettings.eqGains] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    next[index] = gainDb;
    updateAudioSettings({
      eqPreset: '自定义',
      eqGains: next,
    });
  };

  // Build smooth SVG EQ frequency response curve preview
  const eqCurvePoints = audioSettings.eqGains
    .map((gain, i) => {
      const x = (i / (EQ_BANDS.length - 1)) * 100;
      const y = 50 - (gain / 12) * 38;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="h-full overflow-y-auto lumina-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-6">
      {/* Header + Master DSP Switch */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            音质与音效引擎
          </h1>
          <p className="text-sm text-white/60 mt-1">
            基于 Web Audio API 实时信号链：7 段参数均衡器、立体声 M/S 3D 环绕、卷积混响与防削波限幅器
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={resetAudioSettings}
            className="px-4 py-2.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs font-medium text-white/85 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认
          </button>

          <button
            type="button"
            onClick={() =>
              updateAudioSettings({ masterEnabled: !audioSettings.masterEnabled })
            }
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              audioSettings.masterEnabled
                ? 'text-white shadow-lg'
                : 'bg-white/10 text-white/60 border border-white/12'
            }`}
            style={
              audioSettings.masterEnabled
                ? {
                    background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                  }
                : undefined
            }
          >
            <Power className="w-4 h-4" />
            {audioSettings.masterEnabled ? '音效总开关：开启' : '音效总开关：关闭'}
          </button>
        </div>
      </div>

      {/* Section 1: Quality Mode & Honest Source Diagnostics */}
      <section className="rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <AudioLines className="w-5 h-5" style={{ color: activePalette.primary }} />
            <h2 className="text-base font-semibold text-white">音质设置与源文件检测</h2>
          </div>

          {currentTrack && (
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular text-white/75">
              <span>格式：{currentTrack.format}</span>
              <span>采样率：{formatSampleRate(currentTrack.sampleRate)}</span>
              <span>
                位深：
                {currentTrack.bitsPerSample ? `${currentTrack.bitsPerSample}-bit` : '未标明'}
              </span>
              <span>码率：{formatBitrate(currentTrack.bitrate)}</span>
              <span>输出引擎：{(audioEngine.sampleRate / 1000).toFixed(1)} kHz</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUALITY_MODES.map((m) => {
            const active = audioSettings.qualityMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => updateAudioSettings({ qualityMode: m.id })}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-white/[0.12] border-white/30'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{m.label}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: active
                        ? activePalette.primary
                        : 'rgba(255,255,255,0.18)',
                    }}
                  />
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">{m.desc}</p>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-black/30 border border-white/8 text-xs text-white/65 leading-relaxed">
          <Info className="w-4 h-4 text-white/60 shrink-0 mt-0.5" />
          <p>
            音质说明：播放器的音质模式负责音频管线调度与失真保护，无法将有损压缩文件（如 MP3 / AAC）凭空还原为真正无损音频；只有导入 FLAC / WAV 等无损格式时才具备原始无损信息。
            {audioSettings.qualityMode === 'original' &&
              ' 当前处于「原始音质直通」，以下 DSP 音效将自动旁路。'}
          </p>
        </div>
      </section>

      {/* Section 1.5: Real AI Stem Separation & Independent Vocal / Instrumental Control */}
      <StemSeparationPanel />

      {/* Section 1.6: Quick Stereo M/S Balance (when AI stems are not active) */}
      <section
        className={`rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-4 transition-opacity ${
          isBypassed || (audioSettings.stemModeActive && currentTrackStemMeta)
            ? 'opacity-50 pointer-events-none'
            : 'opacity-100'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Mic2 className="w-5 h-5" style={{ color: activePalette.primary }} />
            <div>
              <h2 className="text-base font-semibold text-white">
                免分离立体声快捷平衡 (Mid/Side 矩阵)
              </h2>
              <p className="text-xs text-white/55">
                {audioSettings.stemModeActive && currentTrackStemMeta
                  ? '当前已启用上方「AI 分离双轨混音」，本快捷矩阵已自动让位'
                  : '未运行 AI 分离时，可通过 M/S 声道矩阵快速微调中央人声与侧声部伴奏比例'}
              </p>
            </div>
          </div>
        </div>

        <VocalBackgroundControl
          balance={audioSettings.vocalAccompanimentBalance}
          palette={activePalette}
          onChange={(val) => updateAudioSettings({ vocalAccompanimentBalance: val })}
        />
      </section>

      {/* Section 2: 3D Spatial Surround + Additional Effects */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-12 gap-6 transition-opacity ${
          isBypassed ? 'opacity-55 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* 3D Surround Card */}
        <section className="lg:col-span-6 rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Headphones className="w-5 h-5" style={{ color: activePalette.primary }} />
              <div>
                <h2 className="text-base font-semibold text-white">3D 环绕音效</h2>
                <p className="text-xs text-white/55">
                  Mid/Side 立体声矩阵扩展 + 哈斯微延迟与耳机互馈优化
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                updateAudioSettings({ surroundEnabled: !audioSettings.surroundEnabled })
              }
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                audioSettings.surroundEnabled
                  ? 'text-white'
                  : 'bg-white/10 text-white/60'
              }`}
              style={
                audioSettings.surroundEnabled
                  ? { backgroundColor: activePalette.primary }
                  : undefined
              }
            >
              {audioSettings.surroundEnabled ? '已开启' : '已关闭'}
            </button>
          </div>

          <div
            className={`space-y-4 transition-opacity ${
              audioSettings.surroundEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'
            }`}
          >
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-white/80">空间声场宽度</span>
                <span className="font-mono-tabular text-white/75">
                  {audioSettings.surroundWidth}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={audioSettings.surroundWidth}
                onChange={(e) =>
                  updateAudioSettings({ surroundWidth: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-white/80">环绕沉浸强度</span>
                <span className="font-mono-tabular text-white/75">
                  {audioSettings.surroundIntensity}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={audioSettings.surroundIntensity}
                onChange={(e) =>
                  updateAudioSettings({ surroundIntensity: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
              <div>
                <span className="text-xs font-medium text-white block">
                  耳机聆听优化 (自然互馈 Crossfeed)
                </span>
                <span className="text-[11px] text-white/50 block mt-0.5">
                  模拟双耳自然声学交叉，缓解耳机长时间极端立体声疲劳
                </span>
              </div>
              <input
                type="checkbox"
                checked={audioSettings.headphoneOptimize}
                onChange={(e) =>
                  updateAudioSettings({ headphoneOptimize: e.target.checked })
                }
                className="accent-rose-500 w-4 h-4 shrink-0"
              />
            </label>
          </div>

          <p className="text-[11px] text-white/45 leading-relaxed">
            技术说明：浏览器 Web Audio 输出为双声道立体声。本功能通过真实 M/S 侧音增益矩阵、1.4ms 微延迟及 720Hz 低通互馈提升空间感，非硬件多声道 Dolby Atmos 解码。
          </p>
        </section>

        {/* Additional DSP Effects */}
        <section className="lg:col-span-6 rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5" style={{ color: activePalette.secondary }} />
            <h2 className="text-base font-semibold text-white">空间与音色增强</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-2xl bg-white/[0.035] border border-white/8">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-white/85">低音增强 (85Hz)</span>
                <span className="font-mono-tabular text-white/75">
                  +{audioSettings.bassBoost} dB
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={audioSettings.bassBoost}
                onChange={(e) =>
                  updateAudioSettings({ bassBoost: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.035] border border-white/8">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-white/85">高音增强 (8.2kHz)</span>
                <span className="font-mono-tabular text-white/75">
                  +{audioSettings.trebleBoost} dB
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={audioSettings.trebleBoost}
                onChange={(e) =>
                  updateAudioSettings({ trebleBoost: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.035] border border-white/8">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-white/85">人声清晰度 (2.8kHz)</span>
                <span className="font-mono-tabular text-white/75">
                  +{audioSettings.vocalEnhance} dB
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={audioSettings.vocalEnhance}
                onChange={(e) =>
                  updateAudioSettings({ vocalEnhance: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.035] border border-white/8">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-white/85">厅堂混响 (Reverb)</span>
                <span className="font-mono-tabular text-white/75">
                  {audioSettings.reverbMix}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={audioSettings.reverbMix}
                onChange={(e) =>
                  updateAudioSettings({ reverbMix: Number(e.target.value) })
                }
                className="lumina-range w-full"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.035] border border-white/8">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-white/85">基础声场宽度 (M/S 平衡)</span>
              <span className="font-mono-tabular text-white/75">
                {audioSettings.stereoWidth}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={audioSettings.stereoWidth}
              onChange={(e) =>
                updateAudioSettings({ stereoWidth: Number(e.target.value) })
              }
              className="lumina-range w-full"
            />
          </div>

          <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
              <div>
                <span className="text-xs font-medium text-white block">
                  音量标准化与防削波限幅保护
                </span>
                <span className="text-[11px] text-white/50 block">
                  通过动态压缩器实时抑制多频段叠加导致的数字破音
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={audioSettings.loudnessNormalization}
              onChange={(e) =>
                updateAudioSettings({ loudnessNormalization: e.target.checked })
              }
              className="accent-rose-500 w-4 h-4 shrink-0"
            />
          </label>
        </section>
      </div>

      {/* Section 3: 7-Band Interactive Equalizer */}
      <section
        className={`rounded-3xl bg-white/[0.045] backdrop-blur-xl border border-white/10 p-5 sm:p-6 space-y-5 transition-opacity ${
          isBypassed ? 'opacity-55 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5" style={{ color: activePalette.primary }} />
            <div>
              <h2 className="text-base font-semibold text-white">7 段图形均衡器 (BiquadFilter EQ)</h2>
              <p className="text-xs text-white/55">
                实时调节各频段增益 (-12 dB 至 +12 dB)
              </p>
            </div>
          </div>

          {/* Preset Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            {presetNames.map((preset) => {
              const active = audioSettings.eqPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'text-white shadow-md'
                      : 'bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.12]'
                  }`}
                  style={
                    active
                      ? {
                          background: `linear-gradient(135deg, ${activePalette.primary}, ${activePalette.secondary})`,
                        }
                      : undefined
                  }
                >
                  {preset}
                </button>
              );
            })}
            <span
              className={`px-3 py-1.5 rounded-xl text-xs font-medium ${
                audioSettings.eqPreset === '自定义'
                  ? 'bg-white/18 text-white'
                  : 'text-white/40'
              }`}
            >
              自定义
            </span>
          </div>
        </div>

        {/* Visual Frequency Curve */}
        <div className="h-20 w-full rounded-2xl bg-black/30 border border-white/8 px-4 py-2 relative overflow-hidden">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" />
            <polyline
              fill="none"
              stroke={activePalette.primary}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={eqCurvePoints}
            />
          </svg>
        </div>

        {/* 7 Vertical EQ Sliders */}
        <div className="grid grid-cols-7 gap-2 sm:gap-4 pt-2">
          {EQ_BANDS.map((band, idx) => {
            const gain = audioSettings.eqGains[idx];
            return (
              <div key={band.freq} className="flex flex-col items-center gap-2.5">
                <span className="text-[11px] sm:text-xs font-mono-tabular text-white/80">
                  {gain > 0 ? `+${gain}` : gain} dB
                </span>

                <div className="h-40 sm:h-48 flex items-center justify-center relative w-full">
                  <div className="w-1.5 h-full rounded-full bg-white/10 relative overflow-hidden pointer-events-none">
                    <div
                      className="absolute left-0 right-0 rounded-full"
                      style={{
                        backgroundColor: activePalette.primary,
                        top: gain >= 0 ? `${50 - (gain / 12) * 50}%` : '50%',
                        bottom: gain < 0 ? `${50 - (Math.abs(gain) / 12) * 50}%` : '50%',
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(e) => handleEqBandChange(idx, Number(e.target.value))}
                    aria-label={`${band.label} 增益`}
                    className="lumina-range-vertical absolute inset-0 w-10 h-full mx-auto opacity-85 cursor-pointer"
                  />
                </div>

                <span className="text-[11px] sm:text-xs font-mono-tabular text-white/60">
                  {band.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
