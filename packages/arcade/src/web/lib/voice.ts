// Hands-free voice: a voice activity detector that cuts the mic input into clips, a WAV encoder,
// and speech output. The detector and the encoder are pure, so they run in tests.

/** The mic runs at 16 kHz mono: enough for speech, and 3 times smaller than 48 kHz. */
export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;

export type VadOptions = {
  /** Voice must last this long before a clip starts. */
  startMs: number;
  /** A clip ends after this much silence. */
  endSilenceMs: number;
  /** Shorter clips (a cough, a click) are dropped. */
  minSpeechMs: number;
  /** Longer clips are cut here. */
  maxSpeechMs: number;
  /** Audio kept from before the voice started, so the first syllable is not lost. */
  preRollMs: number;
  /** Silence kept at the end of a clip. */
  tailMs: number;
  /** The lowest RMS that counts as voice. Digital silence is exact zero, so the noise floor alone is not enough. */
  minThreshold: number;
  /** Voice must be this many times louder than the noise floor. */
  noiseFactor: number;
  /** The noise floor is the quietest frame in this window. Speech has short gaps, so they set it. */
  noiseWindowMs: number;
  /** No clip starts before this much audio has set the noise floor. */
  calibrationMs: number;
};

export const defaultVadOptions: VadOptions = {
  startMs: 60,
  endSilenceMs: 800,
  minSpeechMs: 400,
  maxSpeechMs: 12_000,
  preRollMs: 300,
  tailMs: 200,
  minThreshold: 0.01,
  noiseFactor: 3,
  noiseWindowMs: 2000,
  calibrationMs: 500,
};

export type Vad = {
  /** Feeds one frame of FRAME_MS. Returns the samples of a finished clip, or null. */
  push(frame: Float32Array): Float32Array | null;
  /** Forgets the current clip and the pre-roll. Keeps the noise floor. */
  reset(): void;
  /** RMS of the last frame, for a level meter. */
  readonly level: number;
  readonly threshold: number;
  readonly speaking: boolean;
};

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return frame.length > 0 ? Math.sqrt(sum / frame.length) : 0;
}

export function createVad(options: Partial<VadOptions> = {}): Vad {
  const o = { ...defaultVadOptions, ...options };
  const frames = (ms: number) => Math.max(1, Math.round(ms / FRAME_MS));
  const startFrames = frames(o.startMs);
  const preRollFrames = frames(o.preRollMs);

  const levels: number[] = [];
  let level = 0;
  // Idle: the recent frames (pre-roll plus a possible start). Speaking: the clip so far.
  let buffer: Float32Array[] = [];
  let speaking = false;
  let voicedRun = 0;
  let silentRun = 0;
  let voicedFrames = 0;

  const threshold = () => (levels.length < frames(o.calibrationMs) ? Infinity : Math.max(o.minThreshold, Math.min(...levels) * o.noiseFactor));
  const reset = () => {
    buffer = [];
    speaking = false;
    voicedRun = 0;
    silentRun = 0;
    voicedFrames = 0;
  };
  const finish = (keepFrames: number): Float32Array | null => {
    const clip = buffer.slice(0, keepFrames);
    const longEnough = voicedFrames * FRAME_MS >= o.minSpeechMs;
    reset();
    return longEnough ? concat(clip) : null;
  };

  return {
    push(frame) {
      level = rms(frame);
      levels.push(level);
      if (levels.length > frames(o.noiseWindowMs)) levels.shift();
      const voiced = level > threshold();
      if (!speaking) {
        buffer.push(frame);
        voicedRun = voiced ? voicedRun + 1 : 0;
        if (voicedRun >= startFrames) {
          speaking = true;
          voicedFrames = voicedRun;
          buffer = buffer.slice(-(preRollFrames + startFrames));
        } else if (buffer.length > preRollFrames + startFrames) buffer.shift();
        return null;
      }
      buffer.push(frame);
      if (voiced) {
        voicedFrames++;
        silentRun = 0;
      } else silentRun++;
      if (silentRun * FRAME_MS >= o.endSilenceMs) return finish(buffer.length - silentRun + Math.min(silentRun, frames(o.tailMs)));
      if (buffer.length * FRAME_MS >= o.maxSpeechMs) return finish(buffer.length);
      return null;
    },
    reset,
    get level() {
      return level;
    },
    get threshold() {
      return threshold();
    },
    get speaking() {
      return speaking;
    },
  };
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Mono 16-bit PCM WAV. Clef-Omni and the transcription model both read it. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export type SpeechLang = "en" | "es";

// Chrome can garbage-collect an utterance that nothing references, and then `end` never fires.
let speaking: SpeechSynthesisUtterance | null = null;

/** Says the text and resolves when it ends, fails, or takes too long. Resolves at once without voices. */
export async function speak(text: string, lang: SpeechLang): Promise<void> {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const voices = await loadVoices();
  if (voices.length === 0) return;
  const tag = lang === "es" ? "es-ES" : "en-US";
  const voice = voices.find((v) => v.lang === tag) ?? voices.find((v) => v.lang.startsWith(`${lang}-`));
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = tag;
    if (voice) utterance.voice = voice;
    speaking = utterance;
    const done = () => {
      clearTimeout(timer);
      if (speaking === utterance) speaking = null;
      resolve();
    };
    // About 14 characters a second, plus slack for the voice to start.
    const timer = setTimeout(done, 2000 + text.length * 90);
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  speaking = null;
}

/** The voice list is empty until the browser fires `voiceschanged`. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1000);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timer);
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}
