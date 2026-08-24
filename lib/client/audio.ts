/// <reference lib="dom" />

import type { ActivityKind } from "../game/types.ts";
import {
  MOVEMENT_ARRANGEMENTS,
  type MovementArrangement,
  movementTonalCenter,
  musicDirectionKey,
  type MusicMovement,
  type MusicTarget,
} from "./music.ts";

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

const DEFAULT_MUSIC_TARGET: MusicTarget = {
  movement: "calm",
  intensity: 0,
  variant: 0,
};
const STEPS_PER_PHRASE = 32;
const PHRASES_PER_LOOP = 2;
export const MUSIC_PHRASE_SECONDS = STEPS_PER_PHRASE * 60 / 78 / 2;
export const MUSIC_SWING_RATIO = 0.58;

const RECOVERY_ARRANGEMENT: MovementArrangement = {
  tempo: 78,
  chordRoots: [50, 55, 48, 53],
  chordQualities: [[0, 3, 7, 10, 14], [0, 4, 7, 10, 14], [0, 4, 7, 11, 14], [
    0,
    4,
    7,
    9,
    14,
  ]],
  motif: [2, 3, 5, 7, 9, 7, 4, 2],
  bassPattern: [0, -1, 3, -1, 7, -1, 10, -1],
  melodyDensity: 0.8,
  tonalCenter: 64,
};
const BANKRUPTCY_ARRANGEMENT: MovementArrangement = {
  tempo: 78,
  chordRoots: [50, 55, 48, 50],
  chordQualities: [[0, 3, 7, 10, 14], [0, 4, 7, 10, 14], [0, 4, 7, 11, 14], [
    0,
    3,
    7,
    10,
    14,
  ]],
  motif: [9, 7, 5, 3, 2, 3, 5, 2],
  bassPattern: [0, -1, 3, -1, 7, -1, 10, -1],
  melodyDensity: 0.62,
  tonalCenter: 62,
};

function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function arrangementFor(movement: MusicMovement): MovementArrangement {
  if (movement === "recovery") return RECOVERY_ARRANGEMENT;
  if (movement === "bankruptcy") return BANKRUPTCY_ARRANGEMENT;
  return MOVEMENT_ARRANGEMENTS[movement];
}

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

function addBrush(
  samples: Float32Array,
  sampleRate: number,
  start: number,
  level: number,
  seed: number,
): void {
  const frameCount = Math.round(sampleRate * 0.11);
  const startFrame = Math.round(start * sampleRate);
  let noise = (seed + 1) * 0x9e3779b9;
  for (let offset = 0; offset < frameCount; offset += 1) {
    noise ^= noise << 13;
    noise ^= noise >>> 17;
    noise ^= noise << 5;
    const envelope = (1 - offset / frameCount) ** 3;
    const index = startFrame + offset;
    if (index >= samples.length) break;
    samples[index] += (noise / 0x80000000) * envelope * level;
  }
}

export function renderMusicLoop(
  sampleRate: number,
  target: MusicTarget = DEFAULT_MUSIC_TARGET,
): Float32Array {
  const arrangement = arrangementFor(target.movement);
  const eighthNoteSeconds = 60 / arrangement.tempo / 2;
  const phraseCount = target.movement === "bankruptcy" ? 1 : PHRASES_PER_LOOP;
  const steps = STEPS_PER_PHRASE * phraseCount;
  const samples = new Float32Array(
    Math.ceil(steps * eighthNoteSeconds * sampleRate),
  );
  for (let step = 0; step < steps; step += 1) {
    const phrase = Math.floor(step / STEPS_PER_PHRASE);
    const phraseStep = step % STEPS_PER_PHRASE;
    const chordIndex = Math.floor(phraseStep / 8) %
      arrangement.chordRoots.length;
    const root = arrangement.chordRoots[chordIndex];
    const quality = arrangement.chordQualities[chordIndex];
    const swingDelay = step % 2 === 1
      ? eighthNoteSeconds * (MUSIC_SWING_RATIO * 2 - 1)
      : 0;
    const start = step * eighthNoteSeconds + swingDelay;
    const motifIndex = (phraseStep + target.variant * 2 + phrase) %
      arrangement.motif.length;
    const seededGate = (phraseStep * 5 + target.variant * 3 + phrase) % 8 / 8;
    if (seededGate < arrangement.melodyDensity) {
      const inversion = (target.variant + chordIndex + phrase) % quality.length;
      const pitch = root + arrangement.motif[motifIndex] +
        (quality[inversion] >= 12 ? 0 : quality[inversion] % 3);
      addMusicTone(
        samples,
        sampleRate,
        midiFrequency(pitch + 12),
        start,
        eighthNoteSeconds * 1.15,
        0.068 + target.intensity * 0.008,
        "triangle",
      );
    }
    const bassOffset =
      arrangement.bassPattern[phraseStep % arrangement.bassPattern.length];
    if (bassOffset >= 0) {
      addMusicTone(
        samples,
        sampleRate,
        midiFrequency(root - 12 + bassOffset),
        start,
        eighthNoteSeconds * 1.55,
        0.115 + target.intensity * 0.008,
        "sine",
      );
    }
    if ([0, 3, 6].includes(phraseStep % 8)) {
      quality.slice(1, 5).forEach((interval, index) =>
        addMusicTone(
          samples,
          sampleRate,
          midiFrequency(root + interval + 12),
          start,
          eighthNoteSeconds * 1.35,
          0.018 - index * 0.0025,
          "triangle",
        )
      );
    }
    if (phraseStep % 8 === 2 || phraseStep % 8 === 6) {
      addBrush(
        samples,
        sampleRate,
        start,
        0.012 + target.intensity * 0.002,
        target.variant * 97 + step,
      );
    }
  }
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.tanh(samples[index]);
  }
  return samples;
}

export function notificationFrequencies(
  tone: NotificationTone,
  movement: MusicMovement = "calm",
): number[] {
  const center = movementTonalCenter(movement);
  const intervals = tone === "positive"
    ? [12, 16]
    : tone === "attention"
    ? [7, 3]
    : [9];
  return intervals.map((interval) => midiFrequency(center + interval));
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
  #activeMusic?: MusicPlayback;
  #pendingMusic?: MusicPlayback;
  #transitionTimer?: ReturnType<typeof setTimeout>;
  #musicTarget: MusicTarget = DEFAULT_MUSIC_TARGET;
  #musicEnabled = false;
  #musicVolume = 35;
  #terminalSilenced = false;

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
    const frequencies = notificationFrequencies(
      tone,
      this.#activeMusic?.target.movement ?? this.#musicTarget.movement,
    );
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
    if (
      this.#musicEnabled === enabled &&
      (enabled ? this.#activeMusic !== undefined : true)
    ) {
      return;
    }
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
    if (!this.#terminalSilenced) this.#startMusic(this.#musicTarget);
  }

  setMusicTarget(target: MusicTarget): void {
    const recovery = this.#pendingMusic?.target.movement === "recovery"
      ? this.#pendingMusic.target
      : this.#activeMusic?.target.movement === "recovery"
      ? this.#activeMusic.target
      : undefined;
    if (recovery?.nextMovement === target.movement) {
      this.#musicTarget = target;
      return;
    }
    if (musicDirectionKey(target) === musicDirectionKey(this.#musicTarget)) {
      return;
    }
    this.#musicTarget = target;
    if (target.movement !== "bankruptcy") this.#terminalSilenced = false;
    if (!this.#musicEnabled || !this.#context || !this.#musicGain) return;
    this.#queueMusic(target);
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

  #createMusic(target: MusicTarget, start: number): MusicPlayback | undefined {
    if (!this.#context || !this.#musicGain) return undefined;
    const samples = renderMusicLoop(this.#context.sampleRate, target);
    const buffer = this.#context.createBuffer(
      1,
      samples.length,
      this.#context.sampleRate,
    );
    buffer.getChannelData(0).set(samples);
    const source = this.#context.createBufferSource();
    const gain = this.#context.createGain();
    source.buffer = buffer;
    source.loop = target.movement !== "bankruptcy";
    source.connect(gain);
    gain.connect(this.#musicGain);
    source.start(start);
    return {
      source,
      gain,
      target,
      startedAt: start,
      duration: buffer.duration,
    };
  }

  #startMusic(target: MusicTarget): void {
    if (this.#activeMusic || !this.#context) return;
    const playback = this.#createMusic(target, this.#context.currentTime);
    if (!playback) return;
    playback.gain.gain.value = 1;
    this.#activeMusic = playback;
    if (target.movement === "bankruptcy") this.#scheduleTerminalStop(playback);
  }

  #queueMusic(target: MusicTarget): void {
    if (!this.#context || !this.#musicGain) return;
    if (!this.#activeMusic) {
      this.#startMusic(target);
      return;
    }
    if (
      musicDirectionKey(target) === musicDirectionKey(this.#activeMusic.target)
    ) return;
    this.#cancelPendingMusic();
    const now = this.#context.currentTime;
    const elapsed = Math.max(0, now - this.#activeMusic.startedAt);
    const boundary = now + MUSIC_PHRASE_SECONDS -
      elapsed % MUSIC_PHRASE_SECONDS;
    const crossfade = 60 / 78;
    const pending = this.#createMusic(target, boundary);
    if (!pending) return;
    pending.gain.gain.setValueAtTime(0.0001, boundary);
    pending.gain.gain.linearRampToValueAtTime(1, boundary + crossfade);
    const active = this.#activeMusic;
    active.gain.gain.cancelScheduledValues(now);
    this.#activeMusic.gain.gain.setValueAtTime(
      active.gain.gain.value,
      now,
    );
    active.gain.gain.linearRampToValueAtTime(
      0.0001,
      boundary + crossfade,
    );
    this.#pendingMusic = pending;
    this.#transitionTimer = globalThis.setTimeout(() => {
      active.source.stop();
      active.gain.disconnect();
      this.#activeMusic = pending;
      this.#pendingMusic = undefined;
      this.#transitionTimer = undefined;
      if (target.movement === "recovery" && target.nextMovement) {
        this.#queueMusic({
          movement: target.nextMovement,
          intensity: target.nextMovement === "growth" ? 1 : 0,
          variant: target.variant,
        });
      } else if (target.movement === "bankruptcy") {
        this.#scheduleTerminalStop(pending);
      }
    }, Math.max(0, (boundary + crossfade - now) * 1_000));
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
    this.#cancelPendingMusic();
    const active = this.#activeMusic;
    this.#activeMusic = undefined;
    if (active && this.#context) {
      const stopAt = this.#context.currentTime + 0.5;
      active.source.stop(stopAt);
      globalThis.setTimeout(() => active.gain.disconnect(), 550);
    }
  }

  #cancelPendingMusic(): void {
    if (this.#transitionTimer !== undefined) {
      globalThis.clearTimeout(this.#transitionTimer);
      this.#transitionTimer = undefined;
    }
    if (this.#pendingMusic) {
      try {
        this.#pendingMusic.source.stop();
      } catch {
        // A source may already have ended while the page was suspended.
      }
      this.#pendingMusic.gain.disconnect();
      this.#pendingMusic = undefined;
    }
    if (this.#activeMusic && this.#context) {
      const now = this.#context.currentTime;
      this.#activeMusic.gain.gain.cancelScheduledValues(now);
      this.#activeMusic.gain.gain.setValueAtTime(1, now);
    }
  }

  #scheduleTerminalStop(playback: MusicPlayback): void {
    if (!this.#context) return;
    const remaining = Math.max(
      0,
      playback.startedAt + playback.duration - this.#context.currentTime,
    );
    this.#transitionTimer = globalThis.setTimeout(() => {
      playback.gain.disconnect();
      if (this.#activeMusic === playback) this.#activeMusic = undefined;
      this.#terminalSilenced = true;
      this.#transitionTimer = undefined;
    }, remaining * 1_000);
  }
}

interface MusicPlayback {
  source: AudioBufferSourceNode;
  gain: GainNode;
  target: MusicTarget;
  startedAt: number;
  duration: number;
}
