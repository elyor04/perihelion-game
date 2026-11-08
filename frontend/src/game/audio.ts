// Every sound is synthesised with WebAudio; no audio files ship with the game.
// The background music is sparse bell notes from a pentatonic scale (there is
// no continuous drone); effects are short envelopes on oscillators and
// filtered noise.

export type Sfx =
  | "ui" | "uiBack" | "launch" | "crash" | "rock" | "horizon" | "lost" | "warp"
  | "nearMiss" | "gate" | "star" | "recall";

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private echo: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private musicStarted = false;
  private bellTimer = 0;
  private lastTick = 0;
  private vol = { master: 0.8, music: 0.5, sfx: 0.8 };

  /** Create or resume the context. Must run inside a user gesture the first time. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build();
    }
    this.resume();
    this.startMusic();
  }

  /** iOS reports "interrupted" after a call or Siri; anything but running/closed needs a resume. */
  resume() {
    const c = this.ctx;
    if (c && c.state !== "running" && c.state !== ("closed" as AudioContextState)) void c.resume().catch(() => {});
  }

  suspend() {
    const c = this.ctx;
    if (c && c.state === "running") void c.suspend().catch(() => {});
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    const c = this.ctx;
    if (!c || !this.master || !this.music || !this.sfx) return;
    const t = c.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.music.gain.setTargetAtTime(music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
  }

  private build() {
    const c = this.ctx!;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.connect(comp);
    this.music = c.createGain();
    this.music.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    // A feedback delay gives the bells some space.
    this.echo = c.createDelay(1.5);
    this.echo.delayTime.value = 0.42;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    this.echo.connect(tone);
    tone.connect(fb);
    fb.connect(this.echo);
    tone.connect(this.master);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.vol.master, this.vol.music, this.vol.sfx);
  }

  /** The only background music: sparse bell notes, no continuous bed. */
  private startMusic() {
    if (!this.ctx || this.musicStarted || !this.music) return;
    this.musicStarted = true;
    this.scheduleBell();
  }

  private scheduleBell() {
    window.clearTimeout(this.bellTimer);
    this.bellTimer = window.setTimeout(() => {
      if (this.ctx?.state === "running") {
        const note = PENTA[Math.floor(Math.random() * PENTA.length)];
        this.bell(440 * Math.pow(2, (note - 9) / 12), 0.05, this.music!, 3.5);
      }
      this.scheduleBell();
    }, 3500 + Math.random() * 6000);
  }

  private bell(freq: number, gain: number, out: AudioNode, decay = 1.6, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    env.connect(out);
    if (this.echo) env.connect(this.echo);
    for (const [mult, g] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
      const o = c.createOscillator();
      o.frequency.value = freq * mult;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(env);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  private noiseHit(dur: number, type: BiquadFilterType, from: number, to: number, gain: number, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, gain: number, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfx!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A soft click while aiming; pitch follows power. Rate limited. */
  aimTick(power: number) {
    const c = this.ctx;
    if (!c || c.state !== "running") return;
    const now = performance.now();
    if (now - this.lastTick < 45) return;
    this.lastTick = now;
    this.tone("sine", 300 + power * 700, 280 + power * 650, 0.04, 0.05);
  }

  play(s: Sfx, arg = 0) {
    const c = this.ctx;
    if (!c || c.state !== "running" || !this.sfx) return;
    switch (s) {
      case "ui":
        this.tone("sine", 880, 660, 0.06, 0.08);
        break;
      case "uiBack":
        this.tone("sine", 520, 380, 0.07, 0.07);
        break;
      case "launch":
        this.noiseHit(0.45, "bandpass", 2400, 300, 0.35);
        this.tone("sine", 120 + arg * 120, 50, 0.25, 0.4);
        break;
      case "recall":
        this.tone("triangle", 600, 200, 0.2, 0.12);
        break;
      case "crash":
        this.noiseHit(0.7, "lowpass", 1800, 80, 0.7);
        this.tone("sine", 90, 30, 0.5, 0.6);
        break;
      case "rock":
        this.noiseHit(0.35, "highpass", 900, 3000, 0.45);
        this.noiseHit(0.5, "lowpass", 1200, 100, 0.4, 0.03);
        break;
      case "horizon":
        this.tone("sine", 420, 32, 1.1, 0.4);
        this.tone("sawtooth", 210, 20, 1.0, 0.06);
        break;
      case "lost":
        this.tone("sine", 300, 900, 0.5, 0.08);
        break;
      case "warp":
        this.tone("sine", 200, 1400, 0.18, 0.18);
        this.tone("sine", 1400, 300, 0.3, 0.12, 0.18);
        this.noiseHit(0.4, "bandpass", 600, 4000, 0.15);
        break;
      case "nearMiss":
        this.tone("sine", 1760, 1900, 0.25, 0.05);
        this.tone("sine", 2217, 2400, 0.25, 0.04, 0.03);
        break;
      case "gate": {
        const root = 392;
        [0, 4, 7, 11, 14].forEach((st, i) => this.bell(root * Math.pow(2, st / 12), 0.12, this.sfx!, 2.4, i * 0.07));
        break;
      }
      case "star":
        this.bell(660 * Math.pow(2, (arg * 4) / 12), 0.16, this.sfx, 1.8);
        break;
    }
  }

  /** The flight hum follows the comet's speed (0..1); null stops it. */
  flight(speed: number | null) {
    const c = this.ctx;
    if (!c || !this.sfx) return;
    if (speed === null) {
      if (this.hum) {
        const h = this.hum;
        h.gain.gain.setTargetAtTime(0, c.currentTime, 0.08);
        h.osc.stop(c.currentTime + 0.5);
        this.hum = null;
      }
      return;
    }
    if (!this.hum) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 3;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfx);
      osc.start();
      this.hum = { osc, gain, filter };
    }
    const t = c.currentTime;
    this.hum.osc.frequency.setTargetAtTime(48 + speed * 70, t, 0.05);
    this.hum.filter.frequency.setTargetAtTime(160 + speed * 900, t, 0.05);
    this.hum.gain.gain.setTargetAtTime(0.03 + speed * 0.05, t, 0.05);
  }
}
