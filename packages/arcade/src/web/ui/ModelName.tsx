import { cn } from "cn";
import { hostByName, makerOf } from "./brands.ts";

/** "Clef Flash (Cloudflare)" becomes the name and the host. */
export function splitLabel(label: string): { name: string; provider?: string } {
  const match = /^(.*) \((.*)\)$/.exec(label);
  return match ? { name: match[1]!, provider: match[2] } : { name: label };
}

/** The maker's logo, the model name, then the host's logo and name in small caps. */
export function ModelName({ label, color, hideHost, className }: { label: string; color?: string; hideHost?: boolean; className?: string }) {
  // The voice game labels a transcript listener "<label> (transcript)".
  const transcript = label.endsWith(" (transcript)");
  const { name, provider } = splitLabel(transcript ? label.slice(0, -" (transcript)".length) : label);
  const maker = makerOf(name);
  const host = provider ? hostByName(provider) : undefined;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
      {maker && <img src={maker.logo} alt="" className="size-4 shrink-0 rounded-sm" />}
      <span className="truncate font-medium">{name}</span>
      {transcript && <span className="shrink-0 text-xs text-muted-foreground">(transcript)</span>}
      {provider && !hideHost && (
        <span className="caps inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          {host && host !== maker && <img src={host.logo} alt="" className="size-3 rounded-[2px] opacity-80" />}
          {provider}
        </span>
      )}
    </span>
  );
}
