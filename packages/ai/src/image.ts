export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

/** An image in the state. Create it with `image()`. */
export class ImagePart {
  constructor(
    readonly mediaType: ImageMediaType,
    readonly base64: string,
  ) {}

  get dataUrl(): string {
    return `data:${this.mediaType};base64,${this.base64}`;
  }
}

/**
 * Wraps a PNG, JPEG or WebP image as a state part.
 * Accepts raw bytes (the type is read from the file header) or a base64 data URL.
 */
export function image(data: Uint8Array | ArrayBuffer | string): ImagePart {
  if (typeof data === "string") {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(data);
    if (!match) throw new TypeError("image(): expected a base64 data URL for a PNG, JPEG or WebP image");
    return new ImagePart(match[1]!.toLowerCase() as ImageMediaType, match[2]!);
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new ImagePart(sniffMediaType(bytes), toBase64(bytes));
}

function sniffMediaType(b: Uint8Array): ImageMediaType {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  throw new TypeError("image(): bytes are not a PNG, JPEG or WebP image");
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
