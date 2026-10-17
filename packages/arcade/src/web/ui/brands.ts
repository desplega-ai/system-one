// Logos for the hosts (where a call goes) and the makers (who trained the model).
// SVGs from LobeHub's static icon set (MIT), made white for the dark theme. TypeSafe's is its site icon.
import cloudflare from "../logos/cloudflare.svg";
import openai from "../logos/openai.svg";
import openrouter from "../logos/openrouter.svg";
import typesafe from "../logos/typesafe.png";
import vercel from "../logos/vercel.svg";

export type Brand = { key: string; name: string; logo: string };

/** The hosts, in the order the model menus group them. Keys are the registry prefixes ("openai:gpt-6-luna"). */
export const hosts: Brand[] = [
  { key: "cloudflare", name: "Cloudflare", logo: cloudflare },
  { key: "openai", name: "OpenAI", logo: openai },
  { key: "typesafe", name: "TypeSafe", logo: typesafe },
  { key: "openrouter", name: "OpenRouter", logo: openrouter },
  { key: "gateway", name: "AI Gateway", logo: vercel },
];

const byKey = new Map(hosts.map((h) => [h.key, h]));
const byName = new Map(hosts.map((h) => [h.name, h]));

export const hostByKey = (key: string): Brand | undefined => byKey.get(key);
export const hostByName = (name: string): Brand | undefined => byName.get(name);

/** The company that made a model, from the model's name. */
export function makerOf(name: string): Brand | undefined {
  if (/^clef/i.test(name)) return byKey.get("cloudflare");
  if (/^jev/i.test(name)) return byKey.get("typesafe");
  if (/^gpt/i.test(name)) return byKey.get("openai");
  return undefined;
}

const images = new Map<string, HTMLImageElement>();

/** A loaded logo for canvas drawing. The first call starts the load. Draw only when `complete` is true. */
export function logoImage(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img;
}
