import { toBase64 } from "./image.ts";

/** An audio clip in the state. Create it with `audio()`. Only Cloudflare Clef-Omni accepts audio. */
export class AudioPart {
  constructor(
    /** For example "audio/wav", "audio/webm" or "audio/mp4". */
    readonly mediaType: string,
    readonly base64: string,
  ) {}

  get dataUrl(): string {
    return `data:${this.mediaType};base64,${this.base64}`;
  }
}

/**
 * Wraps an audio clip as a state part.
 * Accepts a base64 data URL, or raw bytes plus their media type. Media type parameters such as
 * ";codecs=opus" (from MediaRecorder) are dropped, because Clef-Omni rejects them.
 * Clef-Omni accepts WAV, WebM (Opus) and MP4 (AAC), checked 2026-10-16.
 */
export function audio(data: string): AudioPart;
export function audio(data: Uint8Array | ArrayBuffer, mediaType: string): AudioPart;
export function audio(data: Uint8Array | ArrayBuffer | string, mediaType?: string): AudioPart {
  if (typeof data === "string") {
    const match = /^data:(audio\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*);base64,(.+)$/i.exec(data);
    if (!match) throw new TypeError("audio(): expected a base64 data URL with an audio/* media type");
    return new AudioPart(essence(match[1]!), match[2]!);
  }
  if (!mediaType?.toLowerCase().startsWith("audio/")) throw new TypeError('audio(): pass the media type of the bytes, for example "audio/wav"');
  return new AudioPart(essence(mediaType), toBase64(data instanceof Uint8Array ? data : new Uint8Array(data)));
}

/** "audio/webm;codecs=opus" -> "audio/webm" */
function essence(mediaType: string): string {
  return mediaType.split(";")[0]!.trim().toLowerCase();
}
