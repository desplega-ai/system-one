// Browser hooks: a decision stream, the webcam, a hands-free mic, and element sizes.
import { type AudioPart, audio, type DecisionStreamOptions, decisionStream } from "@system-one/ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { createVad, encodeWav, FRAME_MS, SAMPLE_RATE, type Vad } from "./voice.ts";

/**
 * Runs a decision stream while `enabled` is true. The callbacks are read through a ref,
 * so `makeCall` always sees the current state.
 */
export function useDecisionStream<Call, Result>(options: DecisionStreamOptions<Call, Result> & { enabled: boolean }) {
  const latest = useRef(options);
  latest.current = options;
  const { enabled, everyMs, maxInFlight } = options;

  useEffect(() => {
    if (!enabled) return;
    const stream = decisionStream<Call, Result>({
      everyMs,
      maxInFlight,
      makeCall: () => latest.current.makeCall(),
      decide: (call, signal) => latest.current.decide(call, signal),
      onResult: (result, call) => latest.current.onResult(result, call),
      onError: (error, call) => latest.current.onError?.(error, call),
    });
    return () => stream.stop();
  }, [enabled, everyMs, maxInFlight]);
}

type DeviceStatus = "off" | "starting" | "on" | "error";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The webcam in a <video> element. Games crop the live video when they build a call.
 * It asks for 1280x720, because the browser default (640x480) leaves little to zoom into.
 */
export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  /** Each start and stop gets a number. A start that is no longer the newest gives up quietly. */
  const attempt = useRef(0);
  const [status, setStatus] = useState<DeviceStatus>("off");
  const [error, setError] = useState<string>();

  const stop = useCallback(() => {
    attempt.current++;
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("off");
  }, []);

  /**
   * Resolves true once the video plays. Dev StrictMode runs effects twice, so two starts can overlap:
   * the older one gives up, instead of failing with "play() was interrupted by a new load request".
   */
  const start = useCallback(async () => {
    const mine = ++attempt.current;
    setStatus("starting");
    setError(undefined);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (mine !== attempt.current) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const video = videoRef.current;
      if (!video) throw new Error("useWebcam: attach videoRef to a <video> element");
      media.current?.getTracks().forEach((t) => t.stop());
      media.current = stream;
      video.srcObject = stream;
      await video.play();
      if (mine !== attempt.current) return false;
      setStatus("on");
      return true;
    } catch (e) {
      if (mine !== attempt.current) {
        if (stream && media.current !== stream) stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      stop();
      setStatus("error");
      setError(message(e));
      return false;
    }
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { videoRef, status, error, start, stop };
}

// Runs in the audio thread. It groups the 128-sample blocks into frames of FRAME_MS and posts them.
const frameWorklet = `
class Frames extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frame = new Float32Array(options.processorOptions.frameSize);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      let i = 0;
      while (i < input.length) {
        const n = Math.min(this.frame.length - this.filled, input.length - i);
        this.frame.set(input.subarray(i, i + n), this.filled);
        this.filled += n;
        i += n;
        if (this.filled === this.frame.length) {
          this.port.postMessage(this.frame.slice());
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("frames", Frames);
`;

/** After a pause, the mic stays deaf this long, so the end of the app's own voice is not a clip. */
const RESUME_DELAY_MS = 300;

/**
 * Hands-free mic: cuts speech into WAV clips with a voice activity detector.
 * Call `start()` from a click: the browser lets an AudioContext run only after a user gesture.
 * While `paused` is true (the app thinks or talks), the mic input is dropped.
 */
export function useVoiceClips({ onClip, paused }: { onClip: (clip: AudioPart, durationMs: number) => void; paused: boolean }) {
  const latest = useRef({ onClip, paused });
  latest.current = { onClip, paused };
  const parts = useRef<{ ctx: AudioContext; stream: MediaStream; vad: Vad } | null>(null);
  const deafUntil = useRef(0);
  const [status, setStatus] = useState<DeviceStatus>("off");
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState(0);

  const stop = useCallback(() => {
    const current = parts.current;
    parts.current = null;
    current?.stream.getTracks().forEach((t) => t.stop());
    void current?.ctx.close();
    setLevel(0);
    setStatus("off");
  }, []);

  /** Resolves true once the mic listens. */
  const start = useCallback(async () => {
    setStatus("starting");
    setError(undefined);
    // Created inside the click, so the browser lets it run. The mic is resampled to 16 kHz.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const url = URL.createObjectURL(new Blob([frameWorklet], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, "frames", { processorOptions: { frameSize: (SAMPLE_RATE * FRAME_MS) / 1000 } });
      // The node must reach the output, or the browser may never run it. A gain of 0 keeps it silent.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(mute).connect(ctx.destination);

      const vad = createVad();
      let shownAt = 0;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (latest.current.paused || performance.now() < deafUntil.current) return;
        const clip = vad.push(e.data);
        if (performance.now() - shownAt > 100) {
          shownAt = performance.now();
          setLevel(vad.level);
        }
        if (clip) latest.current.onClip(audio(encodeWav(clip, SAMPLE_RATE), "audio/wav"), (clip.length / SAMPLE_RATE) * 1000);
      };
      parts.current = { ctx, stream, vad };
      setStatus("on");
      return true;
    } catch (e) {
      void ctx.close();
      stop();
      setStatus("error");
      setError(message(e));
      return false;
    }
  }, [stop]);

  // Coming out of a pause: stay deaf a moment, then start from a clean state.
  useEffect(() => {
    if (paused) return;
    deafUntil.current = performance.now() + RESUME_DELAY_MS;
    parts.current?.vad.reset();
  }, [paused]);

  useEffect(() => stop, [stop]);
  return { start, stop, status, error, level };
}

/** The width of an element in CSS pixels. CSS sets the size, and canvases read it to draw sharp. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The side of the largest square that fits the element, in CSS pixels. Square boxes give their width;
 * a box in full screen gives its height. */
export function useSquareSide<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [side, setSide] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSide(Math.round(Math.min(entry!.contentRect.width, entry!.contentRect.height))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, side] as const;
}
