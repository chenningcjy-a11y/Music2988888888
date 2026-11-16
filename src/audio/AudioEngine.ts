import { AudioAnalysisFrame, AudioDspSettings } from '../types/music';
import { DEFAULT_AUDIO_SETTINGS, EQ_BANDS } from '../utils/constants';

export interface StemMeterLevels {
  vocalLevel: number; // 0..1
  instrumentalLevel: number; // 0..1
}

export class LuminaAudioEngine {
  private audioEl: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Master & Dual-Source Input Matrix (Original HTMLAudio vs AI-Separated Stems vs MV Video Audio)
  private originalInputGain: GainNode | null = null;
  private stemsMixGain: GainNode | null = null;
  private songMixGain: GainNode | null = null;
  private mvInputGain: GainNode | null = null;
  private mvSourceMap = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();
  private vocalGainNode: GainNode | null = null;
  private instrumentalGainNode: GainNode | null = null;
  private vocalAnalyser: AnalyserNode | null = null;
  private instrumentalAnalyser: AnalyserNode | null = null;
  private masterVolumeGain: GainNode | null = null;

  // Decoded AI Stem Buffers & Active Buffer Sources
  private stemsTrackId: string | null = null;
  private vocalBuffer: AudioBuffer | null = null;
  private instrumentalBuffer: AudioBuffer | null = null;
  private vocalSource: AudioBufferSourceNode | null = null;
  private instrumentalSource: AudioBufferSourceNode | null = null;
  private stemAnchorAudioTime = 0;
  private stemAnchorCtxTime = 0;
  private stemsActivePlaying = false;
  private wasStemRouteActive = false;

  // Routing & Bypass
  private preGain: GainNode | null = null;
  private bypassGain: GainNode | null = null;
  private dspOutGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  // EQ & Tone nodes
  private eqFilters: BiquadFilterNode[] = [];
  private bassBoostFilter: BiquadFilterNode | null = null;
  private trebleBoostFilter: BiquadFilterNode | null = null;
  private vocalEnhanceFilter: BiquadFilterNode | null = null;

  // M/S Stereo Width, 3D Surround & Vocal/Background Matrix
  private midGain: GainNode | null = null;
  private sideGain: GainNode | null = null;
  private midHighpass: BiquadFilterNode | null = null;
  private midLowpass: BiquadFilterNode | null = null;
  private midVocalFilter: BiquadFilterNode | null = null;
  private surroundDelayR: DelayNode | null = null;
  private surroundDelayWet: GainNode | null = null;
  private crossfeedLtoR: GainNode | null = null;
  private crossfeedRtoL: GainNode | null = null;
  private crossfeedFilterL: BiquadFilterNode | null = null;
  private crossfeedFilterR: BiquadFilterNode | null = null;

  // Convolution Reverb
  private convolver: ConvolverNode | null = null;
  private reverbDryGain: GainNode | null = null;
  private reverbWetGain: GainNode | null = null;

  private freqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(2048));
  private stemTimeBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(512));
  private currentSettings: AudioDspSettings = DEFAULT_AUDIO_SETTINGS;
  private currentVolume = 0.85;
  private currentMuted = false;
  private currentObjectUrl: string | null = null;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.preload = 'auto';
    this.audioEl.setAttribute('playsinline', 'true');
  }

  public get element(): HTMLAudioElement {
    return this.audioEl;
  }

  public get sampleRate(): number {
    return this.ctx?.sampleRate || 44100;
  }

  public get loadedStemsTrackId(): string | null {
    return this.stemsTrackId;
  }

  public get hasLoadedStems(): boolean {
    return Boolean(this.vocalBuffer && this.instrumentalBuffer);
  }

  private createStereoImpulseResponse(
    ctx: AudioContext,
    duration = 1.8,
    decay = 2.6
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        const early = i < rate * 0.03 ? 0.65 : 1.0;
        data[i] = (Math.random() * 2 - 1) * env * early;
      }
    }
    return impulse;
  }

  public ensureInitialized(): AudioContext {
    if (this.ctx) return this.ctx;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.sourceNode = ctx.createMediaElementSource(this.audioEl);
    // Keep HTMLAudioElement at unity gain so originalInputGain can cleanly mute it in Stem Mode
    this.audioEl.volume = 1;
    this.audioEl.muted = false;

    this.originalInputGain = ctx.createGain();
    this.originalInputGain.gain.value = 1;

    this.stemsMixGain = ctx.createGain();
    this.stemsMixGain.gain.value = 0;

    this.vocalGainNode = ctx.createGain();
    this.vocalGainNode.gain.value = 1;

    this.instrumentalGainNode = ctx.createGain();
    this.instrumentalGainNode.gain.value = 1;

    this.vocalAnalyser = ctx.createAnalyser();
    this.vocalAnalyser.fftSize = 512;
    this.vocalAnalyser.smoothingTimeConstant = 0.72;

    this.instrumentalAnalyser = ctx.createAnalyser();
    this.instrumentalAnalyser.fftSize = 512;
    this.instrumentalAnalyser.smoothingTimeConstant = 0.72;

    this.stemTimeBuffer = new Uint8Array(new ArrayBuffer(this.vocalAnalyser.fftSize));

    this.songMixGain = ctx.createGain();
    this.songMixGain.gain.value = 1;

    this.mvInputGain = ctx.createGain();
    this.mvInputGain.gain.value = 0;

    this.preGain = ctx.createGain();
    this.bypassGain = ctx.createGain();
    this.dspOutGain = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.masterVolumeGain = ctx.createGain();
    this.masterVolumeGain.gain.value = this.currentMuted ? 0 : this.currentVolume;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -12;

    this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    // Original branch: Source -> originalInputGain -> songMixGain -> preGain
    this.sourceNode.connect(this.originalInputGain);
    this.originalInputGain.connect(this.songMixGain);

    // AI Stems branch: vocalGain -> vocalAnalyser -> stemsMixGain -> songMixGain -> preGain
    //                  instrumentalGain -> instrumentalAnalyser -> stemsMixGain -> songMixGain -> preGain
    this.vocalGainNode.connect(this.vocalAnalyser);
    this.vocalAnalyser.connect(this.stemsMixGain);

    this.instrumentalGainNode.connect(this.instrumentalAnalyser);
    this.instrumentalAnalyser.connect(this.stemsMixGain);

    this.stemsMixGain.connect(this.songMixGain);
    this.songMixGain.connect(this.preGain);

    // MV Video audio branch -> mvInputGain -> preGain (shares exact EQ / Surround / Reverb / Limiter DSP!)
    this.mvInputGain.connect(this.preGain);

    // Direct bypass branch -> Compressor
    this.preGain.connect(this.bypassGain);
    this.bypassGain.connect(this.compressor);

    // 7-band Graphic EQ
    this.eqFilters = EQ_BANDS.map((band, idx) => {
      const f = ctx.createBiquadFilter();
      f.type = idx === 0 ? 'lowshelf' : idx === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = band.freq;
      f.Q.value = idx === 0 || idx === EQ_BANDS.length - 1 ? 0.75 : 1.25;
      f.gain.value = 0;
      return f;
    });

    // Tone shapers
    this.bassBoostFilter = ctx.createBiquadFilter();
    this.bassBoostFilter.type = 'lowshelf';
    this.bassBoostFilter.frequency.value = 85;
    this.bassBoostFilter.gain.value = 0;

    this.trebleBoostFilter = ctx.createBiquadFilter();
    this.trebleBoostFilter.type = 'highshelf';
    this.trebleBoostFilter.frequency.value = 8200;
    this.trebleBoostFilter.gain.value = 0;

    this.vocalEnhanceFilter = ctx.createBiquadFilter();
    this.vocalEnhanceFilter.type = 'peaking';
    this.vocalEnhanceFilter.frequency.value = 2800;
    this.vocalEnhanceFilter.Q.value = 1.1;
    this.vocalEnhanceFilter.gain.value = 0;

    // Chain PreGain -> EQ -> Bass -> Treble -> Vocal
    let prev: AudioNode = this.preGain;
    for (const eq of this.eqFilters) {
      prev.connect(eq);
      prev = eq;
    }
    prev.connect(this.bassBoostFilter);
    this.bassBoostFilter.connect(this.trebleBoostFilter);
    this.trebleBoostFilter.connect(this.vocalEnhanceFilter);

    // M/S Stereo Spatializer & 3D Surround
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    this.vocalEnhanceFilter.connect(splitter);

    const lToMid = ctx.createGain();
    lToMid.gain.value = 0.5;
    const rToMid = ctx.createGain();
    rToMid.gain.value = 0.5;
    this.midGain = ctx.createGain();
    this.midGain.gain.value = 1.0;

    splitter.connect(lToMid, 0);
    splitter.connect(rToMid, 1);
    lToMid.connect(this.midGain);
    rToMid.connect(this.midGain);

    const lToSide = ctx.createGain();
    lToSide.gain.value = 0.5;
    const rToSide = ctx.createGain();
    rToSide.gain.value = -0.5;
    this.sideGain = ctx.createGain();
    this.sideGain.gain.value = 1.0;

    splitter.connect(lToSide, 0);
    splitter.connect(rToSide, 1);
    lToSide.connect(this.sideGain);
    rToSide.connect(this.sideGain);

    const sideInvert = ctx.createGain();
    sideInvert.gain.value = -1;
    this.sideGain.connect(sideInvert);

    this.surroundDelayR = ctx.createDelay(0.05);
    this.surroundDelayR.delayTime.value = 0.0014;
    this.surroundDelayWet = ctx.createGain();
    this.surroundDelayWet.gain.value = 0;
    sideInvert.connect(this.surroundDelayR);
    this.surroundDelayR.connect(this.surroundDelayWet);

    this.midHighpass = ctx.createBiquadFilter();
    this.midHighpass.type = 'highpass';
    this.midHighpass.frequency.value = 20;
    this.midHighpass.Q.value = 0.7;

    this.midLowpass = ctx.createBiquadFilter();
    this.midLowpass.type = 'lowpass';
    this.midLowpass.frequency.value = 20000;
    this.midLowpass.Q.value = 0.7;

    this.midVocalFilter = ctx.createBiquadFilter();
    this.midVocalFilter.type = 'peaking';
    this.midVocalFilter.frequency.value = 1250;
    this.midVocalFilter.Q.value = 0.6;
    this.midVocalFilter.gain.value = 0;

    this.midGain.connect(this.midHighpass);
    this.midHighpass.connect(this.midLowpass);
    this.midLowpass.connect(this.midVocalFilter);

    this.midVocalFilter.connect(merger, 0, 0);
    this.midVocalFilter.connect(merger, 0, 1);

    this.sideGain.connect(merger, 0, 0);
    sideInvert.connect(merger, 0, 1);
    this.surroundDelayWet.connect(merger, 0, 1);

    // Headphone crossfeed
    this.crossfeedFilterL = ctx.createBiquadFilter();
    this.crossfeedFilterL.type = 'lowpass';
    this.crossfeedFilterL.frequency.value = 720;
    this.crossfeedFilterR = ctx.createBiquadFilter();
    this.crossfeedFilterR.type = 'lowpass';
    this.crossfeedFilterR.frequency.value = 720;

    const cfDelayL = ctx.createDelay(0.02);
    cfDelayL.delayTime.value = 0.00028;
    const cfDelayR = ctx.createDelay(0.02);
    cfDelayR.delayTime.value = 0.00028;

    this.crossfeedLtoR = ctx.createGain();
    this.crossfeedLtoR.gain.value = 0;
    this.crossfeedRtoL = ctx.createGain();
    this.crossfeedRtoL.gain.value = 0;

    splitter.connect(this.crossfeedFilterL, 0);
    this.crossfeedFilterL.connect(cfDelayL);
    cfDelayL.connect(this.crossfeedLtoR);
    this.crossfeedLtoR.connect(merger, 0, 1);

    splitter.connect(this.crossfeedFilterR, 1);
    this.crossfeedFilterR.connect(cfDelayR);
    cfDelayR.connect(this.crossfeedRtoL);
    this.crossfeedRtoL.connect(merger, 0, 0);

    // Convolution Reverb Stage
    this.reverbDryGain = ctx.createGain();
    this.reverbDryGain.gain.value = 1;
    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.value = 0;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.createStereoImpulseResponse(ctx, 1.85, 2.5);

    merger.connect(this.reverbDryGain);
    this.reverbDryGain.connect(this.dspOutGain);

    merger.connect(this.convolver);
    this.convolver.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.dspOutGain);

    this.dspOutGain.connect(this.compressor);

    // Output protection Limiter -> Master Volume -> Analyser -> Speakers
    this.compressor.connect(this.masterVolumeGain);
    this.masterVolumeGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.applySettings(this.currentSettings);
    return ctx;
  }

  public async resumeContext(): Promise<void> {
    const ctx = this.ensureInitialized();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  private stopStemSources(): void {
    this.stemsActivePlaying = false;
    if (this.vocalSource) {
      try {
        this.vocalSource.stop();
        this.vocalSource.disconnect();
      } catch {
        // already stopped
      }
      this.vocalSource = null;
    }
    if (this.instrumentalSource) {
      try {
        this.instrumentalSource.stop();
        this.instrumentalSource.disconnect();
      } catch {
        // already stopped
      }
      this.instrumentalSource = null;
    }
  }

  private startStemSourcesAt(offsetSec: number): void {
    if (
      !this.ctx ||
      !this.vocalBuffer ||
      !this.instrumentalBuffer ||
      !this.vocalGainNode ||
      !this.instrumentalGainNode
    ) {
      return;
    }

    this.stopStemSources();

    const maxDur = Math.min(this.vocalBuffer.duration, this.instrumentalBuffer.duration);
    if (maxDur <= 0.02) return;
    const clampedOffset = Math.max(0, Math.min(offsetSec, maxDur - 0.02));

    const vSrc = this.ctx.createBufferSource();
    vSrc.buffer = this.vocalBuffer;
    vSrc.connect(this.vocalGainNode);

    const iSrc = this.ctx.createBufferSource();
    iSrc.buffer = this.instrumentalBuffer;
    iSrc.connect(this.instrumentalGainNode);

    const startAt = this.ctx.currentTime + 0.015;
    vSrc.start(startAt, clampedOffset);
    iSrc.start(startAt, clampedOffset);

    this.vocalSource = vSrc;
    this.instrumentalSource = iSrc;
    this.stemAnchorAudioTime = clampedOffset;
    this.stemAnchorCtxTime = startAt;
    this.stemsActivePlaying = true;
  }

  public async loadStems(
    trackId: string,
    vocalBlob: Blob,
    instrumentalBlob: Blob
  ): Promise<void> {
    const ctx = this.ensureInitialized();
    const [vArr, iArr] = await Promise.all([
      vocalBlob.arrayBuffer(),
      instrumentalBlob.arrayBuffer(),
    ]);
    const [vBuf, iBuf] = await Promise.all([
      ctx.decodeAudioData(vArr.slice(0)),
      ctx.decodeAudioData(iArr.slice(0)),
    ]);

    this.stopStemSources();
    this.stemsTrackId = trackId;
    this.vocalBuffer = vBuf;
    this.instrumentalBuffer = iBuf;

    this.applySettings(this.currentSettings);
    if (
      this.currentSettings.stemModeActive &&
      !this.audioEl.paused &&
      !this.stemsActivePlaying
    ) {
      this.startStemSourcesAt(this.audioEl.currentTime || 0);
    }
  }

  public clearStems(): void {
    this.stopStemSources();
    this.stemsTrackId = null;
    this.vocalBuffer = null;
    this.instrumentalBuffer = null;
    this.applySettings(this.currentSettings);
  }

  /**
   * Keeps dual AudioBufferSourceNode stems tightly locked to HTMLAudioElement timeline.
   */
  public syncStemsIfNeeded(): void {
    if (
      !this.ctx ||
      !this.stemsActivePlaying ||
      !this.currentSettings.stemModeActive ||
      this.audioEl.paused ||
      !this.vocalBuffer ||
      !this.instrumentalBuffer
    ) {
      return;
    }

    const elapsedSinceAnchor = Math.max(0, this.ctx.currentTime - this.stemAnchorCtxTime);
    const stemExpectedTime = this.stemAnchorAudioTime + elapsedSinceAnchor;
    const elTime = this.audioEl.currentTime || 0;
    if (Math.abs(stemExpectedTime - elTime) > 0.14) {
      this.startStemSourcesAt(elTime);
    }
  }

  public loadBlob(blob: Blob): string {
    this.clearStems();
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    const url = URL.createObjectURL(blob);
    this.currentObjectUrl = url;
    this.audioEl.src = url;
    this.audioEl.load();
    return url;
  }

  public async play(): Promise<void> {
    await this.resumeContext();
    await this.audioEl.play();
    if (
      this.currentSettings.stemModeActive &&
      this.vocalBuffer &&
      this.instrumentalBuffer
    ) {
      this.startStemSourcesAt(this.audioEl.currentTime || 0);
    }
  }

  public pause(): void {
    this.audioEl.pause();
    this.stopStemSources();
  }

  public seek(timeSec: number): void {
    if (!Number.isFinite(timeSec)) return;
    const clamped = Math.max(
      0,
      Math.min(timeSec, this.audioEl.duration || timeSec)
    );
    this.audioEl.currentTime = clamped;
    if (
      this.currentSettings.stemModeActive &&
      this.vocalBuffer &&
      this.instrumentalBuffer &&
      !this.audioEl.paused
    ) {
      this.startStemSourcesAt(clamped);
    }
  }

  public canUseWebAudioForSrc(src: string): boolean {
    if (!src) return false;
    if (src.startsWith('blob:') || src.startsWith('data:')) return true;
    try {
      const parsed = new URL(src, window.location.href);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  /**
   * Routes an HTMLVideoElement through the exact same Web Audio DSP chain
   * (EQ, 3D Surround, Vocal/Bass/Treble, Reverb, Loudness Normalization) so MV audio
   * matches the user's configured sound quality.
   */
  public attachMvVideoElement(video: HTMLVideoElement, src: string): boolean {
    if (!this.canUseWebAudioForSrc(src)) {
      return false;
    }
    try {
      const ctx = this.ensureInitialized();
      if (!this.mvInputGain) return false;
      let node = this.mvSourceMap.get(video);
      if (!node) {
        node = ctx.createMediaElementSource(video);
        node.connect(this.mvInputGain);
        this.mvSourceMap.set(video, node);
      }
      video.muted = false;
      video.volume = 1;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Smoothly crossfades song audio vs MV audio via Web Audio GainNodes without pops or abrupt gaps.
   */
  public setTheaterMixGains(songGain: number, mvGain: number, timeConstantSec = 0.03): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = Math.max(0.008, timeConstantSec);
    const s = Math.max(0, Math.min(1, Number.isFinite(songGain) ? songGain : 1));
    const m = Math.max(0, Math.min(1, Number.isFinite(mvGain) ? mvGain : 0));
    this.songMixGain?.gain.setTargetAtTime(s, now, tc);
    this.mvInputGain?.gain.setTargetAtTime(m, now, tc);
  }

  public setVolume(volume: number, muted: boolean): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.currentVolume = clamped;
    this.currentMuted = muted;

    if (this.ctx && this.masterVolumeGain) {
      this.audioEl.volume = 1;
      this.audioEl.muted = false;
      this.masterVolumeGain.gain.setTargetAtTime(
        muted ? 0 : clamped,
        this.ctx.currentTime,
        0.02
      );
    } else {
      this.audioEl.volume = clamped;
      this.audioEl.muted = muted;
    }
  }

  public applySettings(settings: AudioDspSettings): void {
    this.currentSettings = settings;
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const tc = 0.04; // smooth 40ms parameter ramp prevents zipper clicks
    const gainTc = 0.025; // responsive 25ms anti-pop gain ramp for stem sliders

    // Dual-Stem vs Original Input Crossfade
    const stemsReady = Boolean(this.vocalBuffer && this.instrumentalBuffer);
    const useStems = Boolean(settings.stemModeActive && stemsReady);

    this.originalInputGain?.gain.setTargetAtTime(useStems ? 0 : 1, now, gainTc);
    this.stemsMixGain?.gain.setTargetAtTime(useStems ? 1 : 0, now, gainTc);

    // Individual Vocal (0..200%) and Instrumental (0..200%) GainNodes
    const vLevel = settings.vocalMuted
      ? 0
      : Math.max(0, Math.min(2, (settings.vocalGain ?? 100) / 100));
    const iLevel = settings.instrumentalMuted
      ? 0
      : Math.max(0, Math.min(2, (settings.instrumentalGain ?? 100) / 100));

    this.vocalGainNode?.gain.setTargetAtTime(vLevel, now, gainTc);
    this.instrumentalGainNode?.gain.setTargetAtTime(iLevel, now, gainTc);

    if (useStems && !this.wasStemRouteActive && !this.audioEl.paused) {
      this.startStemSourcesAt(this.audioEl.currentTime || 0);
    } else if (!useStems && this.wasStemRouteActive) {
      // Stop stem sources gracefully right after 25ms crossfade completes
      window.setTimeout(() => {
        if (!this.currentSettings.stemModeActive || !this.hasLoadedStems) {
          this.stopStemSources();
        }
      }, 90);
    }
    this.wasStemRouteActive = useStems;

    // Original quality mode or master DSP disabled -> clean bypass
    const dspActive = settings.masterEnabled && settings.qualityMode !== 'original';

    this.bypassGain?.gain.setTargetAtTime(dspActive ? 0 : 1, now, tc);
    this.dspOutGain?.gain.setTargetAtTime(dspActive ? 1 : 0, now, tc);

    // 7-Band EQ
    this.eqFilters.forEach((filter, idx) => {
      const gainVal = Math.max(-12, Math.min(12, settings.eqGains[idx] || 0));
      filter.gain.setTargetAtTime(gainVal, now, tc);
    });

    // Bass, Treble, Vocal
    this.bassBoostFilter?.gain.setTargetAtTime(
      Math.max(0, Math.min(12, settings.bassBoost)),
      now,
      tc
    );
    this.trebleBoostFilter?.gain.setTargetAtTime(
      Math.max(0, Math.min(12, settings.trebleBoost)),
      now,
      tc
    );
    this.vocalEnhanceFilter?.gain.setTargetAtTime(
      Math.max(0, Math.min(10, settings.vocalEnhance)),
      now,
      tc
    );

    // Stereo Width + 3D Surround + M/S balance (disabled automatically when true AI stems are active)
    const baseWidth = settings.stereoWidth / 50;
    let sideMultiplier = baseWidth;
    let midMultiplier = 1.0;

    const vbBalance = useStems
      ? 0
      : Math.max(-100, Math.min(100, settings.vocalAccompanimentBalance || 0));
    const leftRatio = vbBalance < 0 ? Math.abs(vbBalance) / 100 : 0;
    const rightRatio = vbBalance > 0 ? vbBalance / 100 : 0;

    if (settings.surroundEnabled) {
      const sWidth = settings.surroundWidth / 100;
      const sInt = settings.surroundIntensity / 100;
      sideMultiplier = baseWidth * (1 + sWidth * 0.65 + sInt * 0.45);
      midMultiplier = Math.max(0.75, 1.0 - sInt * 0.14);

      const surroundScale = 1 - rightRatio;
      this.surroundDelayWet?.gain.setTargetAtTime(sInt * 0.35 * surroundScale, now, tc);
      const cfLevel = (settings.headphoneOptimize ? 0.14 + sInt * 0.1 : 0) * surroundScale;
      this.crossfeedLtoR?.gain.setTargetAtTime(cfLevel, now, tc);
      this.crossfeedRtoL?.gain.setTargetAtTime(cfLevel, now, tc);
    } else {
      this.surroundDelayWet?.gain.setTargetAtTime(0, now, tc);
      this.crossfeedLtoR?.gain.setTargetAtTime(0, now, tc);
      this.crossfeedRtoL?.gain.setTargetAtTime(0, now, tc);
    }

    if (leftRatio > 0) {
      midMultiplier *= 1 - leftRatio * 0.86;
      sideMultiplier *= 1 + leftRatio * 0.38;
      this.midHighpass?.frequency.setTargetAtTime(20, now, tc);
      this.midLowpass?.frequency.setTargetAtTime(20000, now, tc);
      this.midVocalFilter?.frequency.setTargetAtTime(1250, now, tc);
      this.midVocalFilter?.Q.setTargetAtTime(0.55, now, tc);
      this.midVocalFilter?.gain.setTargetAtTime(-24 * leftRatio, now, tc);
    } else if (rightRatio > 0) {
      sideMultiplier *= 1 - rightRatio * 0.96;
      midMultiplier *= 1 + rightRatio * 0.18;
      this.midHighpass?.frequency.setTargetAtTime(20 + rightRatio * 200, now, tc);
      this.midLowpass?.frequency.setTargetAtTime(
        20000 * Math.pow(5600 / 20000, rightRatio),
        now,
        tc
      );
      this.midVocalFilter?.frequency.setTargetAtTime(1850, now, tc);
      this.midVocalFilter?.Q.setTargetAtTime(0.7, now, tc);
      this.midVocalFilter?.gain.setTargetAtTime(3.5 * rightRatio, now, tc);
    } else {
      this.midHighpass?.frequency.setTargetAtTime(20, now, tc);
      this.midLowpass?.frequency.setTargetAtTime(20000, now, tc);
      this.midVocalFilter?.gain.setTargetAtTime(0, now, tc);
    }

    this.midGain?.gain.setTargetAtTime(midMultiplier, now, tc);
    this.sideGain?.gain.setTargetAtTime(Math.min(2.4, sideMultiplier), now, tc);

    // Reverb wet/dry
    const wet = Math.max(0, Math.min(0.65, (settings.reverbMix / 100) * 0.65));
    this.reverbDryGain?.gain.setTargetAtTime(1 - wet * 0.35, now, tc);
    this.reverbWetGain?.gain.setTargetAtTime(wet, now, tc);

    // Anti-clipping compressor + optional loudness normalization
    if (this.compressor) {
      if (settings.loudnessNormalization && dspActive) {
        this.compressor.threshold.setTargetAtTime(-16, now, tc);
        this.compressor.knee.setTargetAtTime(14, now, tc);
        this.compressor.ratio.setTargetAtTime(4, now, tc);
        this.compressor.attack.setTargetAtTime(0.005, now, tc);
        this.compressor.release.setTargetAtTime(0.18, now, tc);
        this.preGain?.gain.setTargetAtTime(1.08, now, tc);
      } else {
        this.compressor.threshold.setTargetAtTime(-1.5, now, tc);
        this.compressor.knee.setTargetAtTime(2, now, tc);
        this.compressor.ratio.setTargetAtTime(12, now, tc);
        this.compressor.attack.setTargetAtTime(0.002, now, tc);
        this.compressor.release.setTargetAtTime(0.1, now, tc);
        this.preGain?.gain.setTargetAtTime(1.0, now, tc);
      }
    }
  }

  /**
   * Computes real-time RMS output levels for both separated Vocal and Instrumental stems.
   */
  public getStemLevels(): StemMeterLevels {
    if (
      !this.ctx ||
      !this.vocalAnalyser ||
      !this.instrumentalAnalyser ||
      !this.currentSettings.stemModeActive ||
      !this.hasLoadedStems ||
      this.audioEl.paused
    ) {
      return { vocalLevel: 0, instrumentalLevel: 0 };
    }

    this.syncStemsIfNeeded();

    const measure = (node: AnalyserNode): number => {
      node.getByteTimeDomainData(this.stemTimeBuffer);
      let sq = 0;
      for (let i = 0; i < this.stemTimeBuffer.length; i++) {
        const s = (this.stemTimeBuffer[i] - 128) / 128;
        sq += s * s;
      }
      const rms = Math.sqrt(sq / this.stemTimeBuffer.length);
      return Math.min(1, rms * 3.2);
    };

    return {
      vocalLevel: measure(this.vocalAnalyser),
      instrumentalLevel: measure(this.instrumentalAnalyser),
    };
  }

  /**
   * Computes real-time spectral bands and waveform directly from AnalyserNode.
   * Contains zero simulated or randomized values.
   */
  public getAnalysisFrame(): AudioAnalysisFrame {
    if (!this.analyser || !this.ctx) {
      return {
        bass: 0,
        mid: 0,
        high: 0,
        volume: 0,
        frequencies: this.freqBuffer,
        waveform: this.timeBuffer,
      };
    }

    this.syncStemsIfNeeded();
    this.analyser.getByteFrequencyData(this.freqBuffer);
    this.analyser.getByteTimeDomainData(this.timeBuffer);

    const binCount = this.freqBuffer.length;
    const nyquist = this.ctx.sampleRate / 2;
    const hzPerBin = nyquist / binCount;

    let bassSum = 0;
    let bassCount = 0;
    let midSum = 0;
    let midCount = 0;
    let highSum = 0;
    let highCount = 0;

    for (let i = 0; i < binCount; i++) {
      const freq = i * hzPerBin;
      const val = this.freqBuffer[i] / 255;
      if (freq >= 20 && freq < 250) {
        bassSum += val;
        bassCount++;
      } else if (freq >= 250 && freq < 2600) {
        midSum += val;
        midCount++;
      } else if (freq >= 2600 && freq <= 16000) {
        highSum += val;
        highCount++;
      }
    }

    let sqSum = 0;
    for (let i = 0; i < this.timeBuffer.length; i++) {
      const centered = (this.timeBuffer[i] - 128) / 128;
      sqSum += centered * centered;
    }
    const rms = Math.sqrt(sqSum / this.timeBuffer.length);
    const volume = Math.min(1, rms * 2.4);

    return {
      bass: bassCount > 0 ? bassSum / bassCount : 0,
      mid: midCount > 0 ? midSum / midCount : 0,
      high: highCount > 0 ? highSum / highCount : 0,
      volume,
      frequencies: this.freqBuffer,
      waveform: this.timeBuffer,
    };
  }
}

export const audioEngine = new LuminaAudioEngine();
