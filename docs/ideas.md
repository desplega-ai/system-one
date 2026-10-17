# Ideas: games and UIs on decision models

Draft, revision 3 (2026-10-17). Add comments anywhere.

## The goal: compare models

Each game is also a model benchmark. Models are the players. The server stores every call. Each game shows per-model stats (win rate, accuracy, latency, cost) and a ranking. The same game with a different model must be a one-line change.

## Status (2026-10-17)

Built in `packages/arcade` (see the README):

- **Arena** (idea 4): lockstep and real-time, presets, stalemate rule.
- **Attention** (new, from Taras): "what are you curious about?" on a 9x9 grid, with 3x zoom and a memory of 5 turns. Live webcam first, plus 6 generated pictures. It replaced the webcam games of idea 1 for now.
- **Voice** (ideas 2 + 3): a hands-free voice controller for `/acme`, a mock shop page with WebMCP-style tools. Clef-Omni hears the audio, the other models read a transcript, and missions score them. Hidden for now.
- **UI round** (2026-10-17, for an X video): dark theme, shadcn, logos, live previews on the home page, a player bar with keyboard keys, focus mode, full screen per view, and a Ranking tab with filters and sorting.
- **Arena plane** (new): a square field with 12 directions, walls, collisions and shots that fly for a few ticks.
- **Setup in words** (new): Jev turns "all Jevs on a plane, real-time" into the Arena setup with one decision call.

What we saw:

- **Grid probe:** 9x9 grid, red dot in a known cell, 12 cells per model, 240 calls, $0.023. No provider rejected 81 options, and no answer was off the list. One 81-option question was never less accurate than column + row. It costs more input tokens on Cloudflare (1,648 against 790).

  | Model | 81 options: exact / within 1 cell | Column + row: exact / within 1 |
  | --- | --- | --- |
  | clef-flash (Cloudflare, OpenRouter) | 12 / 12 | 12 / 12 |
  | clef | 7 / 11 | 7 / 11 |
  | clef-omni | 10 / 12 | 7 / 11 |
  | gpt-6-luna (all hosts), jev (all hosts) | 12 / 12 | 12 / 12 |

- **Attention, pictures:** all 3 judges (Clef Flash, Jev, Luna) went straight to the red umbrella in the market picture. Clef Flash and Jev start at the center cell (E5) when nothing stands out. With "stop exploring, you have seen enough", Luna stopped on its first turn while it rated the view "interesting". Tying each move to the interest fixed that. Models still go back and forth into the same cell, even with their memory.
- **Attention, live:** on a panning fake camera, every judge chose "stay" at level 0 most of the time. Jev is very sure of its cell (96% mean top probability), Clef Flash spreads (10%). 297 calls in 60 s cost $0.03.
- **A named cell pulls the answer to it.** Live, zoomed in, the state said "zoomed in 3x around C7" and the memory said "focus C7". Clef Flash then answered C7 (31 to 48%) on 38 answers in a row while the scene moved. At the whole frame its top cell had 5%. Without cell names and without memory, its focus moved on 24 of 34 zoomed answers, and Jev's on 38 of 66. Live mode now names no cell, and its grid always covers the whole frame. Still mode keeps its memory: worth testing whether the names there cause the E5 loops.
- **Setup in words:** Jev got 5 of 5 test sentences right (about 230 ms, $0.0001 each), once each question had a "not said" option. With "keep the current value" and the current models in the state, it kept 2 of 3 current models for "all Jevs". The same pull as the named cell above.
- **Voice:** a flat macOS voice saying "Quiero cancelar mi pedido ahora mismo" was "angry" for Clef-Omni (87%) and for Jev from the transcript (59 to 84%). So the words carry the mood here. The tone test with a real voice is still open.

## What we have to play with

Decision models do not write text. They read a state and return probabilities for typed questions. That shapes every idea below:

- **Fast.** One decision takes about 150 to 550 ms (table below).
- **Cheap.** A text decision costs about $0.00001 to $0.00005.
- **Many questions, one call.** One call can ask "where to go", "which language" and "what mood" together.
- **Probabilities, not words.** The UI can show a live meter. The game can use the number as a mechanic. The app can ask "did you mean X or Y?" when the model is unsure.
- **Images.** Up to 4 frames per call on Cloudflare. More on other hosts.
- **Audio.** Clef-Omni (Cloudflare) takes audio clips directly. We do not need speech-to-text for intent, mood or language. For a transcript, AI Gateway has 10 transcription models.

### Probe results (2026-10-16, this Mac, 3 samples per model)

| Model | Text tick (median) | 4 frames | 6 parallel calls | Frames: motion right? |
| --- | --- | --- | --- | --- |
| cloudflare clef-flash | 149 ms | 483 ms | 308 ms, 0 failed | yes (89%) |
| openai gpt-6-luna | 158 ms | 440 ms | 1044 ms, 0 failed | yes (100%) |
| gateway gpt-6-luna-decisions | 174 ms | 647 ms | 463 ms, 0 failed | yes (100%) |
| typesafe jev-latest | 217 ms | 235 ms | 252 ms, 0 failed | yes (100%) |
| openrouter jev-latest | 279 ms | 282 ms | 356 ms, 0 failed | yes (100%) |
| cloudflare clef-omni | 307 ms | 456 ms | 241 ms, 0 failed | **no** ("not moving") |
| gateway jev-1.14.0 | 358 ms | 325 ms | 370 ms, 0 failed | yes (100%) |
| cloudflare clef | 413 ms | 375 ms | 912 ms, 0 failed | yes (93%) |
| openrouter gpt-6-luna-decisions | 418 ms | 272 ms | 287 ms, 0 failed | yes (100%) |
| openrouter clef-flash | 564 ms | 497 ms | 1296 ms, 0 failed | yes (89%) |

"Text tick" is an arena turn: a small JSON state, 3 questions. "4 frames" is four 320 px PNGs of a moving red square.

Other findings:

- **Clef-Omni audio works well.** Three clips from macOS `say`, one call each, 3 questions per call:
  - "Take me to my account settings" gave `settings` 97%, `calm` 96%, `english` 95% (552 ms).
  - "This is ridiculous... cancel my order" gave `orders` 84%, `angry` 96% (775 ms).
  - A Spanish request for summer photos gave `photos` 82%, `spanish` 94% (254 ms).
- **Unknown: does Clef-Omni hear tone, or only words?** The angry clip used angry words in a flat voice. We need a real recording: the same neutral sentence, said calmly and then angrily.
- **Clef-Omni video takes MP4 and WebM, but it missed the motion.** It said "not moving" (47%). Four frames as images worked on 9 of 10 models. So for webcam input, send frames, not video.
- **Same state, different temperaments.** In the arena tick, P(fire) was 99% for gpt-6-luna, about 60% for Jev and 27% for Clef-Omni. Clef chose to stay. That gives arena agents personality for free.
- **4 frames cost:** Jev 1,623 tokens ($0.000068), gpt-6-luna 536 ($0.000054), clef-flash 580 ($0.000022). At 2 calls per second that is $0.16 to $0.49 per hour.
- **Transcription on AI Gateway:** 10 models, through `transcribe()` in AI SDK 7. The cheapest are `microsoft/mai-transcribe-2` and `spacexai/grok-stt`, at about $0.10 per hour of audio. OpenRouter has no transcription models, only chat models that read audio.

### Limits to design around

- No text output. For a reply, a caption or a transcript, use generation (`@system-one/ai/generate`).
- No identity matching. The models classify what they see. They do not compare faces.
- Bounding boxes (where is X in the image) exist only on Jev 1.14 (`box` question). Our adapter does not support `box` yet.
- Clef reads only about the first 2,000 tokens of text state.
- A refusal on one question throws for the whole call. A game tick must not crash, so we should return refusal as an answer first.
- Unknown: the maximum number of options in one choice question. We need to test 20 to 100.

## Shared shell (build once)

One Bun app (`packages/arcade`) with one page per game. `Bun.serve` serves the pages and the API routes. The API keys stay on the server.

Shared parts that every game reuses:

- Model picker: one or more models per run.
- Probability bars that animate between answers.
- A HUD with latency, tokens and cost per call and per run.
- A per-model board: the ranking for the current game.
- `useWebcamFrames(count, everyMs)`: grabs N frames as images.
- `useMicClip()`: push to talk, returns an audio clip.
- Smoothing: an average over the last few answers plus a margin before a switch, so a theme or a choice does not flicker.

### Adapter work first

- **Audio.** An `audio()` input part for Clef-Omni (like `image()`). A `transcribe()` helper in `@system-one/ai/generate` that uses AI Gateway, with usage and cost like the other calls. No `video()` part for now, because frames work better.
- **Refusal as an answer** variant, not a throw.
- **A JSON form of a call** (questions plus images and audio as data URLs), so the browser can send it to the server.
- Maybe the `box` question for Jev 1.14.

### Decision stream

A webcam or a drawing needs a steady flow of answers, not one call after another. A stream fires a call every N ms and does not wait for the previous answer:

- Each call gets a sequence number. The UI applies an answer only when it is newer than the last applied answer. A late answer is dropped.
- A limit of K calls in flight. When K calls are open, the stream skips that tick. This protects the budget and the rate limits.
- Cost is rate times cost per call. Every 250 ms is 4 calls per second.

### Storage

`bun:sqlite`, one local file (gitignored). If we deploy to Cloudflare later, D1 takes the same SQL. Three tables, reused by every game:

```
runs    id, game, created_at, config (json: models, settings, generated content)
calls   id, run_id, kind (decide | generate | image | transcribe),
        provider, model, started_at, latency_ms,
        input_tokens, output_tokens, cost_usd, cost_source,
        input (json, redacted), output (json), error_code
scores  run_id, model, metric, value  (wins, accuracy, strokes, rating, ...)
```

- The server writes one `calls` row for every call, also for failed calls. Generation and transcription use the same table, so the budget sees all spend.
- Rankings are SQL over `scores`. Example: win rate per model in the arena.
- Redaction: the server stores images and audio as a sha256 hash plus their size. Text and JSON state stay. A game can mark a field as private, and the server then stores only its hash.

### Budget caps

One env with JSON, read by the server:

```sh
SYSTEM_ONE_BUDGET='{"dailyUsd":1,"providers":{"openai":0.25,"cloudflare":0.5}}'
```

- Before each call, the server sums today's `cost_usd` from `calls`, in total and for that provider. Over a cap, the call fails with a `budget_exceeded` error.
- A model with no known price (`costUsd: undefined`) cannot be counted. While a cap is set, the server blocks such models.

## Generate + decide

Generation adds variety. Decisions make the fast, typed choice that we can compare. So generation makes fresh content each round, and decisions play it:

- **Guard:** a new guard persona and secret weakness each run. AI Gateway speech models can also give the guard a voice.
- **Arena:** random events and power-ups ("a shield drops at B4").
- **Hidden Picture:** a new hidden image and board each round.
- **Sketch puzzles:** new word pairs.

For a fair comparison, we generate once per round and give the same content to every model. The run stores the content, so we can replay it.

## Your ideas, iterated

### 1. Webcam reading (was: face recognition)

I suggest we drop identity recognition ("who is this"). These models cannot match faces reliably. It is also biometric data, which brings consent and storage rules. Expression, gesture, pose and attention work well, and they make better games:

- **Mime It.** The game shows a word. You act it out. The model judges `q.boolean("Is the person acting out 'swimming'?")` from 4 frames. P(yes) is your score.
- **Rock Paper Scissors** against the model. The game picks its move before the model reads your hand, so it is fair.
- **Don't Smile.** A live P(smiling) meter. You lose above 80%.
- **Simon Says.** "Touch your nose." The model scores whether you do it within 2 seconds.

Calls: a decision stream, 2 to 4 calls per second with frames. Use Jev or clef-flash. Cost is $0.16 to $0.49 per hour.

To put a hat on a face, we need its position. The Jev 1.14 `box` question can give it, but at about 300 ms it is too slow for smooth tracking. A local library (for example MediaPipe) can track the face at 30 fps. The model then only says what the face means.

Size: M. Most of the work is the frame grabber and the game feel.

### 2 + 3. Voice-driven mock app (merged)

Ideas 2 and 3 are one call. The probe shows that Clef-Omni returns destination, language and mood from one audio clip in 250 to 780 ms. So one mock app does both:

- **Navigate.** Choice over the actions on the current screen ("open settings", "show orders", "go back"). We know the screen, so we list the actions as options. This is simple and reliable.
- **Adapt.** Language switches the UI strings. Mood picks the theme. An `urgency` score can make the main action bigger. For example: an angry user sees a large "Cancel order" button.
- **Ask when unsure.** If the top choice is under 60%, or the top two are close, show "Did you mean Settings or Help?". Probabilities give us this for free.

A "real computer use" variant: send a screenshot plus the request to Jev 1.14 with a `box` question ("the element the user wants"). Then we click the center of the box. That needs `transcribe()` (Clef-Omni cannot return text) and `box` support. It makes a better demo, but it is slower and less reliable. I suggest we start with the action list.

Size: M.

### 4. Arena

N agents stand on the edge of a circle. Each tick, each agent gets the state and answers 3 questions:

```ts
move: q.choice("Where to move along the edge?", ["clockwise", "stay", "counterclockwise"]),
target: q.choice("Who to shoot at?", ["blue", "green", "nobody"]),
fire: q.boolean("Fire this turn?"),
```

Design points:

- **Two clock modes.**
  - **Lockstep:** the server waits for all agents, then resolves. This is fair. It measures judgment only.
  - **Real-time:** each agent acts when its answer lands. Fast models act 2 to 4 times more often. It measures speed times judgment, which is the more interesting benchmark.
- **Sample, do not take the top answer.** Sampling from the probabilities stops standoffs where everyone waits forever.
- **Put geometry into the state.** Give "blue is in your line of fire, distance 4", not raw coordinates. Gut feeling: the models judge well but calculate badly. We should test both.
- **Choices can be any finite set.** Grid cells ("B4"), points on a coarse grid, or 8 or 16 angle buckets. A choice over cells also gives a heatmap of where the agent wants to go. The spectator view can show it.
- **Aim.** Start with target by id plus an accuracy roll. Angle buckets can be a harder mode with projectiles that travel and can be dodged.
- **Spectator view.** Show each agent's probability bars above its head. That is most of the fun to watch.
- **Cost.** The probe tick took 358 to 472 tokens ($0.000014 to $0.000044). A match with 6 agents and 200 ticks costs about 2 to 5 cents.
- **Boxhead variant.** Use a top-down grid, all vs all, or survivors against scripted zombies. The tick stays the same, with 8 move directions or a target cell.

Risk: 6 parallel calls worked on every provider. Many minutes at several calls per second are untested.

Size: M for lockstep on a canvas, plus S for real-time.

## New ideas

### 5. Persuade the Guard

A guard blocks a door. Each line you type (or say) updates P(lets you pass) on a big meter. You win above 90% within 6 lines.

- Calls: state = guard role, secret weakness, chat log. Questions: `pass` (boolean) and `suspicion` (score).
- Each model is a different guard. Their temperaments differ for free.
- The voice mode uses Clef-Omni, so your tone counts (if it hears tone at all, see above).
- Prompt injection ("ignore your rules") is part of the game. A `cheating` boolean can make the guard angry.
- Comparison: the board shows how many lines each model needs before it lets you pass.

Size: S. This is the fastest way to test whether the meter feels fun.

### 6. Sketch puzzles (replaces Sketch Guess)

Two puzzles where the drawing tests the models:

- **Fewest Strokes.** The game picks a word. Each stroke fires a decision for every model in the run. Reach 80% for the word in the fewest strokes. The board shows which model recognizes the drawing first.
- **Split the Jury.** Generation picks two close words (cat, fox). Draw one picture that makes model A say cat and model B say fox. The puzzle is the difference between the models.

A stroke triggers the call, not a timer, so the cost follows the drawing.

Size: S.

### 7. Hidden Picture (Guess Who with an oracle)

The server generates a hidden image (`cheapModels.image`, $0.007). You ask free-form yes/no questions about it ("is it outdoors?", "is anyone wearing a hat?"). The model answers from the image with a probability ("72% yes"). You guess the subject in as few questions as possible.

- Board variant: generate 24 characters. Each answer greys out the characters that do not match. The model checks every card in parallel.
- It uses generation and decisions together.

Size: M.

### More seeds

- **Focus light.** Webcam and mic every 10 s: "at the desk?", "on a call?", "focused?". The result drives a status light or a Slack status.
- **Gesture remote.** Control the voice mock app with gestures (thumbs up = confirm).
- **Rogue-lite monsters.** Each monster's turn is a decision, with its own temperament in the instructions.
- **Spot the Scam.** Show an email or a screenshot. Players and models each give P(scam). Then we show the answer.

## Suggested order

1. Adapter work: `audio()`, `transcribe()`, refusal as an answer, a JSON form of a call.
2. Shell: server routes, storage, budget caps, decision stream.
3. Persuade the Guard (5). It is small, and it tests the shell, the storage and the board from end to end.
4. Arena (4), lockstep first, then real-time.
5. Voice mock app (2 + 3), after you record the tone test.
6. Hidden Picture (7).
7. Webcam games (1) and sketch puzzles (6). Both need the decision stream.

## Open questions

- **Frontend.** React (Bun bundles TSX from HTML imports) or plain TS with canvas? The arena needs a canvas either way.
- **Where it runs.** Local only, or deployed (for example on Cloudflare)? A deploy needs auth, because the keys pay for every call.
- **Players.** Single player against models, or other humans too (WebSockets)?
- **Rankings.** A simple win rate per model and game, or one rating (for example Elo) across all games?
