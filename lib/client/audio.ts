/// <reference lib="dom" />

import type { ActivityKind } from "../game/types.ts";

export type NotificationTone = "positive" | "attention" | "neutral";

export function notificationToneFor(
  kind: ActivityKind,
): NotificationTone | undefined {
  if (
    [
      "deal_won",
      "customer_renewed",
      "customer_expanded",
      "unlock_earned",
    ].includes(kind)
  ) return "positive";
  if (
    [
      "task_overdue",
      "ticket_sla_breached",
      "customer_at_risk",
      "customer_churned",
      "crisis_entered",
      "bankruptcy_declared",
    ].includes(kind)
  ) return "attention";
  if (["lead_created", "ticket_created"].includes(kind)) return "neutral";
  return undefined;
}

const LOUNGE_NOTES = [
  [130.81, 196, 246.94, 329.63],
  [146.83, 220, 261.63, 349.23],
  [98, 196, 246.94, 293.66],
  [110, 164.81, 207.65, 293.66],
] as const;
const EIGHTH_NOTE_SECONDS = 60 / 78 / 2;

function addMusicTone(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
  start: number,
  duration: number,
  level: number,
  type: "sine" | "triangle",
): void {
  const frameCount = Math.ceil(duration * sampleRate);
  const attackFrames = Math.max(1, Math.round(0.025 * sampleRate));
  const startFrame = Math.round(start * sampleRate);
  for (let offset = 0; offset < frameCount; offset += 1) {
    const progress = offset / frameCount;
    const envelope = offset < attackFrames
      ? offset / attackFrames
      : (1 - progress) ** 2;
    const phase = 2 * Math.PI * frequency * offset / sampleRate;
    const wave = type === "triangle"
      ? 2 / Math.PI * Math.asin(Math.sin(phase))
      : Math.sin(phase);
    const index = (startFrame + offset) % samples.length;
    samples[index] += wave * envelope * level;
  }
}

export function renderMusicLoop(sampleRate: number): Float32Array {
  const steps = LOUNGE_NOTES.length * 8;
  const samples = new Float32Array(
    Math.ceil(steps * EIGHTH_NOTE_SECONDS * sampleRate),
  );
  for (let step = 0; step < steps; step += 1) {
    const chord = LOUNGE_NOTES[Math.floor(step / 8) % LOUNGE_NOTES.length];
    const start = step * EIGHTH_NOTE_SECONDS;
    addMusicTone(
      samples,
      sampleRate,
      chord[step % chord.length],
      start,
      EIGHTH_NOTE_SECONDS * 1.6,
      0.12,
      "triangle",
    );
    if (step % 4 === 0) {
      addMusicTone(
        samples,
        sampleRate,
        chord[0] / 2,
        start,
        EIGHTH_NOTE_SECONDS * 2.8,
        0.16,
        "sine",
      );
    }
  }
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.tanh(samples[index]);
  }
  return samples;
}

export function musicGainForVolume(volume: number): number {
  const normalized = Math.max(0, Math.min(100, volume)) / 100;
  if (normalized === 0) return 0;
  const decibels = -42 + normalized * 39;
  return 10 ** (decibels / 20);
}

export class SoundDesign {
  #context?: AudioContext;
  #musicGain?: GainNode;
  #musicSource?: AudioBufferSourceNode;
  #musicEnabled = false;
  #musicVolume = 35;

  async enable(): Promise<boolean> {
    if (!this.#context) {
      this.#context = new AudioContext();
      this.#musicGain = this.#context.createGain();
      this.#musicGain.gain.value = 0;
      this.#musicGain.connect(this.#context.destination);
    }
    if (this.#context.state === "suspended") await this.#context.resume();
    return this.#context.state === "running";
  }

  async ping(tone: NotificationTone): Promise<void> {
    if (!await this.enable() || !this.#context) return;
    const frequencies = tone === "positive"
      ? [523.25, 659.25]
      : tone === "attention"
      ? [392, 329.63]
      : [440];
    const start = this.#context.currentTime;
    frequencies.forEach((frequency, index) =>
      this.#playTone(
        frequency,
        start + index * 0.08,
        0.16,
        tone === "attention" ? 0.045 : 0.035,
        "sine",
        this.#context!.destination,
      )
    );
  }

  async setMusic(enabled: boolean): Promise<void> {
    this.#musicEnabled = enabled;
    if (!enabled) {
      this.#stopMusic();
      return;
    }
    if (!await this.enable() || !this.#context || !this.#musicGain) return;
    this.#musicGain.gain.cancelScheduledValues(this.#context.currentTime);
    this.#musicGain.gain.setTargetAtTime(
      musicGainForVolume(this.#musicVolume),
      this.#context.currentTime,
      0.8,
    );
    this.#startMusicLoop();
  }

  setMusicVolume(volume: number): void {
    this.#musicVolume = Math.max(0, Math.min(100, Math.round(volume)));
    if (!this.#context || !this.#musicGain || !this.#musicEnabled) return;
    this.#musicGain.gain.cancelScheduledValues(this.#context.currentTime);
    this.#musicGain.gain.setTargetAtTime(
      Math.max(0.0001, musicGainForVolume(this.#musicVolume)),
      this.#context.currentTime,
      0.08,
    );
  }

  async setPageVisible(visible: boolean): Promise<void> {
    if (visible && this.#context && this.#musicEnabled) {
      await this.#context.resume();
    }
  }

  destroy(): void {
    this.#stopMusic();
    void this.#context?.close();
    this.#context = undefined;
    this.#musicGain = undefined;
  }

  #startMusicLoop(): void {
    if (this.#musicSource || !this.#context || !this.#musicGain) return;
    const samples = renderMusicLoop(this.#context.sampleRate);
    const buffer = this.#context.createBuffer(
      1,
      samples.length,
      this.#context.sampleRate,
    );
    buffer.getChannelData(0).set(samples);
    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.#musicGain);
    source.start();
    this.#musicSource = source;
  }

  #playTone(
    frequency: number,
    start: number,
    duration: number,
    level: number,
    type: OscillatorType,
    destination: AudioNode,
  ): void {
    if (!this.#context) return;
    const oscillator = this.#context.createOscillator();
    const gain = this.#context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  #stopMusic(): void {
    if (this.#context && this.#musicGain) {
      this.#musicGain.gain.cancelScheduledValues(this.#context.currentTime);
      this.#musicGain.gain.setTargetAtTime(
        0.0001,
        this.#context.currentTime,
        0.08,
      );
    }
  }
}
