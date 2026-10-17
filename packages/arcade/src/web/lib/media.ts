// Turns an image or a webcam video into the square, gridded views that the models see.
import { image, type ImagePart } from "@system-one/ai";

/** A square part of the square source, in 0..1 of its side. */
export type View = { x: number; y: number; size: number };
export const fullView: View = { x: 0, y: 0, size: 1 };

export type Source = HTMLImageElement | HTMLVideoElement;

// The grid layout. The 2026-10-16 probe (docs/ideas.md) found that every model can name the cell
// of a red dot on this layout: columns A to I in the top margin, rows 1 to 9 in the left margin.
export const GRID = 9;
const CELL_PX = 64;
const MARGIN_PX = 28;
export const columns = Array.from({ length: GRID }, (_, i) => String.fromCharCode(65 + i));
/** "C4" is column C (the third), row 4. */
export const cellName = (col: number, row: number) => `${columns[col]}${row + 1}`;
/** All cells, row by row: A1, B1, ... I9. */
export const cells = Array.from({ length: GRID * GRID }, (_, i) => cellName(i % GRID, Math.floor(i / GRID)));

/** Width and height in source pixels, 0 until a video has its first frame. */
export function sourceSize(src: Source): { width: number; height: number } {
  return src instanceof HTMLVideoElement ? { width: src.videoWidth, height: src.videoHeight } : { width: src.naturalWidth, height: src.naturalHeight };
}

const isWebcam = (src: Source): src is HTMLVideoElement => src instanceof HTMLVideoElement && src.srcObject !== null;

/**
 * The square the game plays on, in source pixels. The webcam uses its center square (it fills the frame,
 * and the sides matter least). A picture or a video file fits whole inside the square, with black bars,
 * so a tall or wide file loses nothing: the square can reach outside the source.
 */
export function squareOf(src: Source): { x: number; y: number; side: number } {
  const { width, height } = sourceSize(src);
  const side = isWebcam(src) ? Math.min(width, height) : Math.max(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

/**
 * Draws a view of the source as a `side` px square at (dx, dy).
 * The webcam is mirrored, like a mirror: the screen, the squares and the models all see the same flipped
 * picture, so a cell on screen is the cell the model names. Text on camera reads backwards for the models.
 */
export function drawView(ctx: CanvasRenderingContext2D, src: Source, view: View, dx: number, dy: number, side: number) {
  const square = squareOf(src);
  const size = view.size * square.side;
  const sy = square.y + view.y * square.side;
  // Only the webcam (a live stream) is mirrored. A picture or a video file plays as it is, with black bars
  // where the square reaches outside it. The source rectangle is clipped to the source by hand.
  if (!isWebcam(src)) {
    const { width, height } = sourceSize(src);
    const sx = square.x + view.x * square.side;
    const scale = side / size;
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(width, sx + size);
    const y1 = Math.min(height, sy + size);
    ctx.fillStyle = "#000000";
    ctx.fillRect(dx, dy, side, side);
    if (x1 > x0 && y1 > y0) ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * scale, dy + (y0 - sy) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    return;
  }
  // In the mirrored picture, a view at x comes from 1 - x - size in the camera frame.
  ctx.save();
  ctx.translate(dx + side, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(src, square.x + (1 - view.x - view.size) * square.side, sy, size, size, 0, 0, side, side);
  ctx.restore();
}

/** Image 1 for the model: the view with grid lines and the cell labels in the margins. */
export function gridImage(src: Source, view: View): ImagePart {
  const inner = GRID * CELL_PX;
  const { canvas, ctx } = makeCanvas(MARGIN_PX + inner);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawView(ctx, src, view, MARGIN_PX, MARGIN_PX, inner);

  // A dark line and a light line next to it, so the grid shows on dark and on light pictures.
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const p = MARGIN_PX + i * CELL_PX + 0.5;
    for (const [color, offset] of [["rgba(0,0,0,0.45)", 0], ["rgba(255,255,255,0.45)", 1]] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p + offset, MARGIN_PX);
      ctx.lineTo(p + offset, MARGIN_PX + inner);
      ctx.moveTo(MARGIN_PX, p + offset);
      ctx.lineTo(MARGIN_PX + inner, p + offset);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#111111";
  ctx.font = "bold 17px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GRID; i++) {
    const center = MARGIN_PX + i * CELL_PX + CELL_PX / 2;
    ctx.fillText(columns[i]!, center, MARGIN_PX / 2);
    ctx.fillText(String(i + 1), MARGIN_PX / 2, center);
  }
  return image(canvas.toDataURL("image/jpeg", 0.85));
}

/** A plain view, for the live mode's image 2: what the judge looks at, up close. */
export function cropImage(src: Source, view: View, side = 448): ImagePart {
  const { canvas, ctx } = makeCanvas(side);
  drawView(ctx, src, view, 0, 0, side);
  return image(canvas.toDataURL("image/jpeg", 0.85));
}

/** Image 2 for the model: the whole square, the current view in red and the earlier views in gray. */
export function overviewImage(src: Source, current: View, earlier: readonly View[], side = 384): ImagePart {
  const { canvas, ctx } = makeCanvas(side);
  drawView(ctx, src, fullView, 0, 0, side);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(150,150,150,0.95)";
  for (const view of earlier) ctx.strokeRect(view.x * side, view.y * side, view.size * side, view.size * side);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#e01b1b";
  ctx.strokeRect(current.x * side, current.y * side, current.size * side, current.size * side);
  return image(canvas.toDataURL("image/jpeg", 0.85));
}

function makeCanvas(side: number) {
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas");
  return { canvas, ctx };
}
