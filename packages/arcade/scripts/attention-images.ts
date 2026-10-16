// Generates the preset images of the Attention game through AI Gateway (about $0.007 each).
// Run once from the repo root, then commit the JPEGs: bun packages/arcade/scripts/attention-images.ts
// Existing images are kept. Pass --force to make them again.
import { mkdirSync } from "node:fs";
import { cheapModels, gatewayCostUsd, generateImage } from "@system-one/ai/generate";
import { $ } from "bun";
import { attentionImages } from "../src/games/attention/images.ts";

const dir = new URL("../src/games/attention/images/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const force = process.argv.includes("--force");

for (const { id, prompt } of attentionImages) {
  const out = `${dir}${id}.jpg`;
  if (!force && (await Bun.file(out).exists())) {
    console.log(`${id}: exists`);
    continue;
  }
  // 1024 px is the largest square Recraft V4.1 Flash makes (2048x2048 fails, checked 2026-10-16).
  const result = await generateImage({ model: cheapModels.image, prompt, size: "1024x1024" });
  const raw = `${dir}${id}.raw`;
  await Bun.write(raw, result.image.uint8Array);
  await $`ffmpeg -y -loglevel error -i ${raw} -q:v 3 ${out}`;
  await $`rm ${raw}`;
  const size = (await $`sips -g pixelWidth -g pixelHeight ${out}`.text()).match(/\d+/g)?.slice(-2).join("x");
  console.log(`${id}: ${size}, ${Math.round(Bun.file(out).size / 1024)} KB, $${gatewayCostUsd(result.providerMetadata) ?? "?"}`);
}
