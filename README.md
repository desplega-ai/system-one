# system-one

Bun workspace with two packages:

- `packages/ai` (`@system-one/ai`): one typed API over the System One / decision model providers. You send a state (text, JSON, images, audio) and typed questions. You get typed answers with probabilities.
- `packages/arcade`: a React app where decision models play games against each other, and a server that stores every call and ranks the models. The first game is the Arena.

```sh
bun install
cp .env.example .env   # fill in the keys you have
bun test               # unit tests, no network
bun run typecheck
bun run smoke          # live calls to every provider that has credentials
bun run dev            # the arcade on http://localhost:3300
```

Game ideas and probe results are in `docs/ideas.md`.

## Decisions

```ts
import { image, openrouter, q } from "@system-one/ai";

const jev = openrouter("~typesafe/jev-latest");
const sprite = image(await Bun.file("door.png").bytes());

const { answers, usage } = await jev.decide({
  state: ["Player state:", { hp: 3, holding: "rusty key" }, sprite],
  questions: {
    triesDoor: q.boolean("Is the player about to try the door?", { yes: "moves to the door", no: "anything else" }),
    mood: q.choice("What is the tone?", ["tense", "calm", "funny"]),
    item: q.choice("Which item matters most?", { key: "opens the door", torch: null }),
    danger: q.score("How dangerous is it?", ["safe", "risky", "deadly"]),
  },
});

const { triesDoor, mood, item, danger } = answers;
// Any answer can be a refusal. Check the type first. The other answers still count.
if (triesDoor.type === "refusal") triesDoor.reason; // string | undefined
if (triesDoor.type === "boolean") triesDoor.probability; // number, P(yes)
if (mood.type === "choice") mood.choice; // "tense" | "calm" | "funny"
if (item.type === "choice") item.probabilities.key; // number
if (danger.type === "score") danger.level; // "safe" | "risky" | "deadly" (most probable level)
if (danger.type === "score") danger.score; // 0..2, probability-weighted

usage.inputTokens; // also outputTokens, totalTokens
usage.costUsd; // number | undefined
usage.costSource; // "provider" | "list-price" | undefined
```

Every provider returns the same `DecisionModel`, so you can swap the model and keep the call. Failures throw `DecisionError` with `code` set to `http`, `missing_credentials` or `bad_response`. On `bad_response` the provider answered and billed the call, so `error.details.usage` holds its usage.

Cost: OpenRouter and AI Gateway report it (`costSource: "provider"`). OpenAI, Cloudflare and TypeSafe report only tokens, so the cost comes from the list prices in `packages/ai/src/pricing.ts` (`costSource: "list-price"`). Those estimates leave out the Cloudflare free tier and OpenAI regional or long-context premiums. A model with no list price gets `costUsd: undefined`.

| Provider | Factory | Env | Images | Status |
| --- | --- | --- | --- | --- |
| OpenRouter | `openrouter(id)` | `OPENROUTER_API_KEY` | most models | live-tested |
| OpenAI | `openai("gpt-6-luna")` | `OPENAI_API_KEY` | yes, up to 128 | live-tested |
| Cloudflare Workers AI | `cloudflare("@cf/cloudflare/clef-flash")` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | up to 4 | live-tested |
| Vercel AI Gateway | `gateway(id)` | `AI_GATEWAY_API_KEY` | some models | live-tested |
| TypeSafe | `typesafe("jev-latest")` | `TYPESAFE_API_KEY` | PNG/JPEG | live-tested |

Known model ids (with image support) are in `packages/ai/src/models.ts` and show up in autocomplete.

Audio: `audio(dataUrl)` or `audio(bytes, "audio/webm")` adds a clip to the state. Only Cloudflare Clef-Omni accepts audio (WAV, WebM and MP4 work). Other providers throw a `TypeError` before any request.

JSON: `callToJson(call)` turns a call into plain JSON (images and audio become `{"$image": dataUrl}` and `{"$audio": dataUrl}`), so a browser can send it to a server. `callFromJson(json)` reads it back. It checks the questions and the size limits in `callLimits`, and throws a `TypeError` for bad input.

Streams: `decisionStream({ makeCall, decide, everyMs, maxInFlight, onResult })` starts a call every `everyMs` and does not wait for the previous answer. It drops a result that arrives after a newer one, and skips a tick when `maxInFlight` calls are open or `makeCall()` returns `null`. `stop()` aborts the open calls.

Gotchas:

- Images must be 280 to 1568 px per side for Jev (TypeSafe), on any host.
- Clef reads about the first 2,000 tokens of text state and silently drops the rest.
- A text-only model rejects images with a 400 error.
- OpenAI predicates take no yes/no criteria, so `q.boolean` criteria go into the instructions there.

## Generation

`@system-one/ai/generate` re-exports `generateText`, `streamText`, `generateImage` and `transcribe` from the Vercel AI SDK. It also has `cheapModels`, a list of cheap AI Gateway model ids. Plain string ids go to AI Gateway, which needs `AI_GATEWAY_API_KEY`.

Token counts are on `result.usage`. `gatewayCostUsd(result.providerMetadata)` returns the USD cost that AI Gateway reports, also for `transcribe`. For `streamText`, await `providerMetadata` first.

```ts
import { cheapModels, gatewayCostUsd, generateText } from "@system-one/ai/generate";

const result = await generateText({ model: cheapModels.text, prompt: "Name a haunted tavern." });
result.text;
result.usage.totalTokens;
gatewayCostUsd(result.providerMetadata); // e.g. 0.000000586
```

## Arcade

`bun run dev` starts the arcade with hot reload. `bun run start` runs it in production mode. Run both from the repo root, so Bun loads `.env`.

Games run in the browser and call the server. The server holds the keys, checks the budget, and stores every call in SQLite (`data/arcade.sqlite`):

| Route | Does |
| --- | --- |
| `GET /api/models` | models with credentials: key, label, provider, inputs |
| `POST /api/runs` | `{game, config}` -> `{id}` |
| `POST /api/decide` | `{runId, model, call}` -> `{answers, usage, latencyMs, model}`. `call` is `callToJson()` output. |
| `POST /api/transcribe` | `{runId, audio}` (a data URL) -> `{text, language, usage, latencyMs}` |
| `POST /api/generate` | `{runId, prompt, system?}` -> `{text, usage, latencyMs}`. The cheap text model (`mistral/mistral-nemo`), only for inputs that a decision cannot give. |
| `POST /api/runs/:id/scores` | `{scores: [{model, metric, value}]}` |
| `GET /api/rankings?game=` | mean and sum per model and metric |
| `GET /api/budget` | the caps and today's spend |

Errors are `{error: {code, message}}`: 400 for bad input, 429 `budget_exceeded`, 502 for a provider error.

The database has 3 tables: `runs`, `calls` (every decide, transcribe and generate call, with tokens, cost, latency and error code) and `scores` (one row per agent and metric). Images and audio are stored only as a sha256 hash and a size.

Budget: `SYSTEM_ONE_BUDGET='{"dailyUsd":1,"providers":{"openai":0.25}}'` caps the spend per UTC day, in total and per provider. The default is `{"dailyUsd":1}`. A call over a cap fails with 429, and the Arena pauses.

Arena: 2 to 6 models on a circle. Each turn every model answers `move`, `target` and `fire`. Two clocks:

- **Lockstep**: every model decides, then the turn resolves. It measures judgment.
- **Real-time**: each model calls again as soon as its answer lands, and acts on each new answer. Fast models act more often. It measures speed and judgment.

Each clock has its own ranking (`arena-lockstep`, `arena-realtime`). If nobody fires for N turns in a row (default 10, "Draw after" in the setup), the match ends in a draw and nobody wins. The models know this rule and see the count. Draws and the share of "stay" moves show up in the rankings.

Presets are named setups worth watching (or recording). Pick one in the setup, or open `#/arena/<id>`. They live in `packages/arcade/src/games/arena/presets.ts`. Models are not fully deterministic, so a preset repeats the setup and the seed, not always the match.

| Preset | Setup | Seen so far |
| --- | --- | --- |
| `standoff` | Clef vs Jev, lockstep, top answers | Both stay put and never fire. Draw after 10 quiet turns. Jev's P(fire) sits near 50%, so in real-time it sometimes fires and wins. |
| `trigger-happy` | GPT-6 Luna vs Clef vs Jev, real-time, top answers | Clef and Jev stay put all match. Luna fires from its first answer, but OpenAI's first answers are slow (up to 12 s), so Luna acts less often. |
| `speed-duel` | Clef Flash vs Clef, real-time, sampling | Clef Flash answers in about 180 ms against 340 ms and acts about 1.8 times as often. |
| `luna-hosts` | GPT-6 Luna via OpenAI, OpenRouter and AI Gateway, real-time, sampling | One match: OpenAI direct (230 ms) won, OpenRouter (300 ms) fell first. |
| `mirror` | Jev vs Jev, lockstep, sampling | Same model, so only the dice decide. |
| `free-for-all` | 6 different models, lockstep, sampling | |

### Attention

What are the models curious about? 1 to 3 judges explore the same input, each on its own path. Each turn a judge sees its view with a 9x9 grid (cells `A1` to `I9`) and answers 3 questions:

- `cell`: the cell it is most curious about (81 options).
- `move`: zoom in 3x around that cell, step back, or stop (live mode: stay).
- `interest`: boring, mild, interesting or fascinating.

- **Live webcam** (`#/attention`, the default): the grid always covers the whole frame, so a judge sees the bigger picture every turn and can look anywhere, also when zoomed in. Zoom (1x, 3x, 9x) is centered on the chosen cell, and the zoomed view comes as a second image. Each judge calls again every 500 ms at most. The page draws each judge's view and focus cell on the video, and a live zoomed crop per judge. A session lasts 60 s and costs a few cents. The webcam is mirrored for the screen and for the models, so a cell on screen is the cell the model names.
- **Pictures** (`#/attention/<id>`): sub-squares. The grid covers the judge's view, and "deeper" zooms 3x into a cell, so the next grid splits that part again. The judge sees its last 5 turns, and below the top level the whole picture with its view in red and its earlier views in gray. 6 generated scenes in `packages/arcade/src/games/attention/images/`, made once with `bun packages/arcade/scripts/attention-images.ts`. Lockstep rounds, up to 12. Use them to compare models on the same input.

Live mode names no cell in the text and has no memory. A named cell pulls the next answer to it: with "zoomed in 3x around C7", Clef Flash kept answering C7 for 38 answers while the scene moved.

Rankings: `attention-live` and `attention-still`, with max and mean depth, step-backs, interest, decisiveness (the mean top-cell probability), regions and turns.

A probe on 2026-10-16 found that every model can name the cell of a red dot on this grid (12 of 12 for most models, 11 of 12 for Clef). No provider rejected 81 options.

### Voice and the Acme page

`/acme` is a mock shop app as a real page. Its state changes only through its tools: each screen registers its own tools, plus `go_to`, `go_back`, `set_language` and `set_theme`. The page exposes them 3 ways:

- **WebMCP:** `document.modelContext.registerTool()` (or `navigator.modelContext` on older Chromium), when the browser has it. `agent-browser webmcp list` shows them.
- **postMessage**, for the voice game, which shows the page in an inert iframe.
- **Clicks:** open `/acme` alone, tap the phone or call a tool from the list, and play the AI yourself.

The voice game (`#/voice`) is hands-free: Start opens the mic, then a voice activity detector cuts your speech into clips. For each clip:

1. grok-stt transcribes it once.
2. Each listener answers `action` (one option per tool, and one per value of an enum input, for example `go_to.orders`), `language` and `mood`. Clef-Omni can hear the audio. The other listeners read the transcript.
3. The first listener drives: the game calls `set_language` and `set_theme` from the detected language and mood, then the chosen tool. A text input (a search query, a chat message) comes from the cheap text model, from the transcript. The page's reply is spoken with the browser's speech synthesis.

Missions ("Ask the app to cancel this order. Speak Spanish. Sound angry.") come from the tools of the current screen and give each listener scores: `voice-missions`, with action, language and mood accuracy, latency (from the end of the clip, transcription included) and cost. Free mode is not scored, and asks "Did you mean X or Y?" when the driver is unsure.

The webcam and the mic need a secure page: localhost, or HTTPS when deployed (Caddy gives HTTPS).

### Testing with fake devices

agent-browser can start Chrome with a fake camera and mic:

```sh
# A camera: an MJPEG clip that pans across a picture.
ffmpeg -y -loop 1 -i packages/arcade/src/games/attention/images/market.jpg \
  -vf "scale=2560:-2,crop=1280:720:x='t*40':y=200" -t 30 -r 15 -pix_fmt yuvj420p -f mjpeg /tmp/scene.mjpeg
agent-browser --args "--use-fake-ui-for-media-stream,--use-fake-device-for-media-stream,--use-file-for-fake-video-capture=/tmp/scene.mjpeg" open "http://localhost:3300/#/attention"

# A mic: requests from `say`, with silence between them. Chrome loops the file.
say -o /tmp/a.aiff "Show me my orders please"
say -o /tmp/b.aiff "Search for the desk lamp"
ffmpeg -y -f lavfi -t 2 -i anullsrc=r=48000:cl=mono -i /tmp/a.aiff -i /tmp/b.aiff \
  -filter_complex "[1]aresample=48000,apad=pad_dur=9[a];[2]aresample=48000,apad=pad_dur=9[b];[0][a][b]concat=n=3:v=0:a=1" \
  -ac 1 -map_metadata -1 -fflags +bitexact -c:a pcm_s16le /tmp/voice.wav
agent-browser --args "--use-fake-ui-for-media-stream,--use-fake-device-for-media-stream,--use-file-for-fake-audio-capture=/tmp/voice.wav,--disable-features=AudioServiceOutOfProcess" open "http://localhost:3300/#/voice"
```

Close agent-browser first (`agent-browser close`): `--args` applies only when it launches Chrome. On macOS the fake mic stays silent without `--disable-features=AudioServiceOutOfProcess`, because the sandboxed audio service cannot read the file.

### Docker

```sh
docker build -t system-one-arcade .
docker run -p 3300:3000 --env-file .env -v arcade-data:/data system-one-arcade
```

`.dockerignore` keeps `.env` out of the image. Pass the keys at run time. Before you put the arcade on a public domain, add auth in front of it (for example Caddy `basic_auth`), because the keys pay for every call.

