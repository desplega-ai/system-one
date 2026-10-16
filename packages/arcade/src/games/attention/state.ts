// What each judge sees and is asked. The images come from the page (web/lib/media.ts),
// so this file stays pure.
import { type Answers, type ImagePart, q, type StatePart } from "@system-one/ai";
import { cells, GRID } from "../../web/lib/media.ts";
import { depthOf, type Game, history, interestLevels, type Judge, MAX_ROUNDS, type Mode, type Move, movesFor } from "./engine.ts";

// Seen on 2026-10-16: with "stop exploring, you have seen enough", GPT-6 Luna stopped on its first
// turn while it rated the view "interesting". The texts now tie each move to the interest.
const moveText: Record<Mode, Record<Move, string>> = {
  still: {
    deeper: "look closer: zoom in 3x on the cell you picked",
    out: "step back to the wider view you came from, to look somewhere else",
    stop: "end the exploration, because nothing here is worth a closer look",
    stay: "keep this view",
  },
  live: {
    deeper: "look closer: zoom in 3x around the cell you picked",
    out: "look wider: zoom out 3x around the cell you picked",
    stop: "stop watching",
    stay: "keep this zoom, around the cell you picked",
  },
};

// The example names only the corners: a named cell pulls answers to it (see stateFor).
const gridText = `a ${GRID}x${GRID} grid. Column letters A to I are in the top margin, row numbers 1 to 9 in the left margin. A cell is named by its column, then its row: A1 is the top-left cell, I9 the bottom-right cell.`;
const cellOptions: Record<string, null> = Object.fromEntries(cells.map((c) => [c, null]));

/**
 * The context, then image 1 (the grid), then image 2 when the judge is zoomed in.
 * Still: image 1 is the judge's view, and image 2 the whole picture. Live: image 1 is always the whole
 * frame, so the judge sees the bigger picture every turn, and image 2 is its zoomed view.
 *
 * Live mode names no cell in the text and has no memory. Seen on 2026-10-16: with "zoomed in 3x around C7"
 * and memory lines like "focus C7", Clef Flash answered C7 at 31 to 48% on 38 answers in a row, while the
 * scene moved (at the whole frame its top cell was 5%). Without the names, its focus moved on 24 of 34
 * zoomed answers, and Jev's on 38 of 66 (before: 1 of 10).
 */
export function stateFor(game: Game, judge: Judge, images: { grid: ImagePart; second?: ImagePart }): StatePart[] {
  const depth = depthOf(judge, game.mode);
  const live = game.mode === "live";
  const imageText = live
    ? [
        `Image 1 is the whole camera frame, now, with ${gridText}`,
        images.second ? `Image 2 is your current view, zoomed in ${3 ** depth}x.` : null,
      ]
    : [
        `Image 1 is your current view with ${gridText}`,
        images.second ? "Image 2 is the whole picture. Your current view is the red box. Gray boxes are views you looked at before." : null,
      ];
  return [
    {
      task: live
        ? "You watch a live camera. Each turn, pick the cell of the whole frame you are most curious about right now, and choose how close to look. Things move, so look again every turn."
        : "You explore a picture to find what is most interesting in it. Zoom in on the details that make you curious. When you have seen a place, step back and look somewhere new. Your last turns are listed below.",
      images: imageText.filter(Boolean).join(" "),
      zoom:
        depth === 0
          ? `You see the whole ${live ? "frame" : "picture"}.`
          : live
            ? `You are zoomed in ${3 ** depth}x.`
            : `You are zoomed in ${3 ** depth}x (level ${depth}), at ${judge.trail.join(" > ")}.`,
      ...(live ? {} : { turn: game.round + 1, maxTurns: MAX_ROUNDS }),
      ...(live ? {} : { yourLastTurns: history(judge) }),
    },
    images.grid,
    ...(images.second ? [images.second] : []),
  ];
}

export function questionsFor(judge: Judge, mode: Mode, sourcePx: number) {
  const moves = movesFor(judge, sourcePx, mode);
  return {
    cell: q.choice<string>(
      mode === "live" ? "Which cell of image 1 (the whole frame) are you most curious about right now?" : "Which cell of image 1 shows the detail you are most curious about?",
      cellOptions,
    ),
    move: q.choice<string>("What do you want to do next?", Object.fromEntries(moves.map((m) => [m, moveText[mode][m]]))),
    interest: q.score("How interesting is what you are looking at?", interestLevels),
  };
}

export type AttentionQuestions = ReturnType<typeof questionsFor>;
export type AttentionAnswers = Answers<AttentionQuestions>;
