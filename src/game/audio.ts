/**
 * Synthesised engine + effects. No audio assets: a sawtooth pair for the
 * engine, filtered noise for wind/road roar, and short blips for pickups.
 * Everything is created lazily on the first user gesture.
 */
export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws through a moving low-pass.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 3;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'square';
      osc.frequency.value = 70;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.22;
      osc.connect(g);
      g.connect(this.engineGain as GainNode);
      osc.start();
      this.engineOsc.push(osc);
    }

    // Road / wind noise.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    noise.start();

    // Police siren, gain 0 until a chase is active.
    const siren = ctx.createOscillator();
    siren.type = 'square';
    siren.frequency.value = 660;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = 'lowpass';
    sirenFilter.frequency.value = 1800;
    siren.connect(sirenFilter);
    sirenFilter.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    siren.start();
    this.sirenOsc = siren;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  /** @param speedRatio 0 → 1, @param active whether the run is live */
  update(speedRatio: number, active: boolean, nitro: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineGain || !this.engineFilter || !this.windGain) return;
    const t = ctx.currentTime;
    const base = 58 + speedRatio * 150 + (nitro ? 40 : 0);
    for (let i = 0; i < this.engineOsc.length; i++) {
      const osc = this.engineOsc[i] as OscillatorNode;
      osc.frequency.setTargetAtTime(base * (i === 0 ? 1 : 0.5), t, 0.08);
    }
    this.engineFilter.frequency.setTargetAtTime(500 + speedRatio * 2600, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.16 : 0.04, t, 0.12);
    this.windGain.gain.setTargetAtTime(active ? 0.02 + speedRatio * 0.12 : 0, t, 0.15);
  }

  setSiren(active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sirenGain || !this.sirenOsc) return;
    const t = ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(active ? 0.035 : 0, t, 0.2);
    if (active) {
      this.sirenOsc.frequency.setValueAtTime(560, t);
      this.sirenOsc.frequency.linearRampToValueAtTime(880, t + 0.28);
      this.sirenOsc.frequency.linearRampToValueAtTime(560, t + 0.56);
    }
  }

  blip(freq = 880, duration = 0.09, type: OscillatorType = 'square', gain = 0.16): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  coin(): void {
    this.blip(1180, 0.07);
    window.setTimeout(() => this.blip(1760, 0.09), 55);
  }

  crash(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.55);
    this.blip(120, 0.28, 'sawtooth', 0.2);
  }

  nearMiss(): void {
    this.blip(220, 0.16, 'sawtooth', 0.1);
  }

  nitroWhoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(4200, ctx.currentTime + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.75);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
