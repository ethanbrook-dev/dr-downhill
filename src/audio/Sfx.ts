/**
 * All sound is synthesised with WebAudio: wind, carving hiss, honks,
 * pickups and a little creepy circus loop. No audio files needed.
 */

const NOTE = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

// A minor oom-pah circus tune (original). -1 = rest.
const MELODY = [
  76, 75, 76, 72, 69, -1, 72, 76, 74, 73, 74, 71, 68, -1, 71, 74,
  76, 75, 76, 72, 69, 72, 76, 81, 80, 76, 74, 71, 69, -1, -1, -1,
];
const BASS_ROOTS = [45, 45, 40, 40, 45, 45, 40, 45];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private carveGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private musicOn = false;
  private nextNoteTime = 0;
  private step = 0;
  tempo = 150;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: band-passed noise whose level tracks speed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Carving: high-passed noise when edging hard.
    const carve = ctx.createBufferSource();
    carve.buffer = this.noise;
    carve.loop = true;
    carve.playbackRate.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    carve.connect(hp).connect(this.carveGain).connect(this.master);
    carve.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.3);
    if (on && this.nextNoteTime < this.ctx.currentTime) this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  /** Per-frame: continuous sounds and the music scheduler. */
  update(speedN: number, carve: number, airborne: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + speedN * 0.35, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + speedN * 900, t, 0.1);
    this.carveGain.gain.setTargetAtTime(airborne ? 0 : Math.min(0.25, carve * 0.3), t, 0.05);

    if (!this.musicOn) return;
    const stepDur = 60 / this.tempo / 2;
    while (this.nextNoteTime < t + 0.15) {
      this.playStep(this.step, this.nextNoteTime, stepDur);
      this.step = (this.step + 1) % MELODY.length;
      this.nextNoteTime += stepDur;
    }
  }

  private playStep(i: number, when: number, dur: number): void {
    const m = MELODY[i];
    if (m > 0) this.tone(NOTE(m), when, dur * 0.9, 'square', 0.18, this.musicGain);
    const root = BASS_ROOTS[Math.floor(i / 4) % BASS_ROOTS.length];
    if (i % 2 === 0) this.tone(NOTE(root - 12 + (i % 4 === 0 ? 0 : 7)), when, dur * 0.8, 'triangle', 0.5, this.musicGain);
    else this.tone(NOTE(root + 3), when, dur * 0.5, 'square', 0.08, this.musicGain);
  }

  private tone(freq: number, when: number, dur: number, type: OscillatorType, vol: number, dest?: AudioNode, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  private noiseBurst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  private get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  coin(): void {
    const t = this.now;
    this.tone(1046, t, 0.08, 'square', 0.12);
    this.tone(1568, t + 0.06, 0.14, 'square', 0.12);
  }

  powerup(): void {
    const t = this.now;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.07, 0.15, 'triangle', 0.3));
  }

  jump(): void {
    this.tone(260, this.now, 0.25, 'sine', 0.25, undefined, 620);
  }

  land(intensity: number): void {
    this.noiseBurst(0.25, 900, Math.min(0.6, 0.15 + intensity * 0.02));
  }

  crash(): void {
    const t = this.now;
    this.noiseBurst(0.5, 1200, 0.8);
    this.tone(120, t, 0.35, 'sine', 0.7, undefined, 45);
    this.tone(880, t + 0.05, 0.3, 'sawtooth', 0.08, undefined, 220);
  }

  /** Squeaky bulb horn: the clowns' calling card. */
  honk(pitch = 1): void {
    const t = this.now;
    for (const [f, d] of [
      [420, 0],
      [425, 0],
    ]) {
      this.tone(f * pitch, t + d, 0.16, 'sawtooth', 0.12, undefined, 330 * pitch);
    }
    this.tone(320 * pitch, t + 0.17, 0.2, 'sawtooth', 0.12, undefined, 250 * pitch);
  }

  /** Low rolling thunder: a cookie boulder is coming down the hill behind you. */
  rumble(vol = 1): void {
    const t = this.now;
    this.noiseBurst(0.6, 180, 0.5 * vol);
    this.tone(55, t, 0.6, 'sine', 0.5 * vol, undefined, 38);
  }

  /** Descending "ha-ha-ha" for the clowns. */
  laugh(): void {
    const t = this.now;
    for (let i = 0; i < 5; i++) this.tone(520 - i * 45, t + i * 0.13, 0.11, 'sawtooth', 0.14, undefined, 380 - i * 45);
  }

  /** Deep angry honk and rising siren when the main clown enrages. */
  enrage(): void {
    const t = this.now;
    this.tone(180, t, 0.5, 'sawtooth', 0.35, undefined, 90);
    this.tone(185, t, 0.5, 'square', 0.15, undefined, 95);
    for (let i = 0; i < 3; i++) this.tone(500, t + 0.45 + i * 0.3, 0.28, 'square', 0.12, undefined, 900);
  }

  gameOver(): void {
    const t = this.now;
    [392, 370, 349, 262].forEach((f, i) => this.tone(f, t + i * 0.28, i === 3 ? 0.9 : 0.26, 'triangle', 0.35, undefined, i === 3 ? 180 : undefined));
  }

  click(): void {
    this.tone(660, this.now, 0.06, 'square', 0.1);
  }
}
