import { describe, expect, test } from "bun:test";
import { createVad, encodeWav, FRAME_MS, SAMPLE_RATE } from "../src/web/lib/voice.ts";

const frameSize = (SAMPLE_RATE * FRAME_MS) / 1000;
const silence = () => new Float32Array(frameSize);
const tone = (amplitude: number) => Float32Array.from({ length: frameSize }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));

/** Feeds `ms` of frames and returns the clips that came out. */
function feed(vad: ReturnType<typeof createVad>, ms: number, make: () => Float32Array): Float32Array[] {
  const clips: Float32Array[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    const clip = vad.push(make());
    if (clip) clips.push(clip);
  }
  return clips;
}
const durationMs = (clip: Float32Array) => (clip.length / SAMPLE_RATE) * 1000;

describe("createVad", () => {
  test("digital silence never starts a clip", () => {
    const vad = createVad();
    expect(feed(vad, 3000, silence)).toEqual([]);
    expect(vad.threshold).toBe(0.01);
  });

  test("one utterance gives one clip with the pre-roll and a short tail", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    expect(feed(vad, 1000, () => tone(0.2))).toEqual([]);
    expect(vad.speaking).toBe(true);
    const clips = feed(vad, 1000, silence);
    expect(clips).toHaveLength(1);
    // 300 ms pre-roll + 1000 ms voice + 200 ms tail.
    expect(durationMs(clips[0]!)).toBeCloseTo(1500, -1);
    expect(vad.speaking).toBe(false);
  });

  test("short pauses between words do not end the clip", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    for (let i = 0; i < 3; i++) {
      expect(feed(vad, 400, () => tone(0.2))).toEqual([]);
      expect(feed(vad, 300, silence)).toEqual([]);
    }
    expect(feed(vad, 1000, silence)).toHaveLength(1);
  });

  test("a sound shorter than minSpeechMs is dropped", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    feed(vad, 200, () => tone(0.2));
    expect(feed(vad, 1000, silence)).toEqual([]);
  });

  test("a long utterance is cut at maxSpeechMs", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    // Syllables: 200 ms of voice, then a 60 ms gap. Speech always has gaps like these.
    let t = 0;
    const clips = feed(vad, 13_000, () => ((t += FRAME_MS) % 260 < 200 ? tone(0.2) : silence()));
    expect(clips).toHaveLength(1);
    expect(durationMs(clips[0]!)).toBeCloseTo(12_000, -2);
  });

  test("a sound with no gaps for longer than the noise window counts as noise", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    const clips = feed(vad, 5000, () => tone(0.2));
    expect(clips).toHaveLength(1);
    expect(durationMs(clips[0]!)).toBeLessThan(3000);
  });

  test("steady noise raises the threshold, so the noise is not a clip", () => {
    const vad = createVad();
    expect(feed(vad, 3000, () => tone(0.02))).toEqual([]);
    expect(vad.threshold).toBeGreaterThan(0.04);
    // Voice well above the noise still counts.
    feed(vad, 600, () => tone(0.3));
    expect(feed(vad, 1000, () => tone(0.02))).toHaveLength(1);
  });

  test("nothing starts during calibration", () => {
    const vad = createVad();
    expect(feed(vad, 300, () => tone(0.2))).toEqual([]);
    expect(vad.speaking).toBe(false);
  });

  test("reset forgets the clip in progress", () => {
    const vad = createVad();
    feed(vad, 1000, silence);
    feed(vad, 800, () => tone(0.2));
    vad.reset();
    expect(feed(vad, 1000, silence)).toEqual([]);
  });
});

describe("encodeWav", () => {
  test("writes a mono 16-bit header and clamps the samples", () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 2, -2]), 16_000);
    const view = new DataView(wav.buffer);
    const text = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to));
    expect(wav.length).toBe(44 + 10);
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 16)).toBe("WAVEfmt ");
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 40)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16383, -16384, 32767, -32768]);
  });
});
