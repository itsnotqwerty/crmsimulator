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

export function musicGainForVolume(volume: number): number {
  const normalized = Math.max(0, Math.min(100, volume)) / 100;
  if (normalized === 0) return 0;
  const decibels = -42 + normalized * 39;
  return 10 ** (decibels / 20);
}

export class SoundDesign {
  #context?: AudioContext;
  #musicGain?: GainNode;
  #timer?: ReturnType<typeof setInterval>;
  #nextNoteAt = 0;
  #step = 0;
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
    this.#nextNoteAt = this.#context.currentTime + 0.05;
    this.#step = 0;
    this.#scheduleMusic();
    if (this.#timer === undefined) {
      this.#timer = globalThis.setInterval(() => this.#scheduleMusic(), 250);
    }
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
    if (!this.#context) return;
    if (!visible) {
      await this.#context.suspend();
    } else if (this.#musicEnabled) {
      await this.#context.resume();
      this.#nextNoteAt = this.#context.currentTime + 0.05;
    }
  }

  destroy(): void {
    this.#stopMusic();
    void this.#context?.close();
    this.#context = undefined;
    this.#musicGain = undefined;
  }

  #scheduleMusic(): void {
    if (!this.#musicEnabled || !this.#context || !this.#musicGain) return;
    const eighthNote = 60 / 78 / 2;
    while (this.#nextNoteAt < this.#context.currentTime + 0.5) {
      const chord =
        LOUNGE_NOTES[Math.floor(this.#step / 8) % LOUNGE_NOTES.length];
      const note = chord[this.#step % chord.length];
      this.#playTone(
        note,
        this.#nextNoteAt,
        eighthNote * 1.6,
        0.12,
        "triangle",
        this.#musicGain,
      );
      if (this.#step % 4 === 0) {
        this.#playTone(
          chord[0] / 2,
          this.#nextNoteAt,
          eighthNote * 2.8,
          0.16,
          "sine",
          this.#musicGain,
        );
      }
      this.#nextNoteAt += eighthNote;
      this.#step += 1;
    }
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
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
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
