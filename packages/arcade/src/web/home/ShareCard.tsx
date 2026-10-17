import { ScanEye, Swords } from "lucide-react";
import { Logo } from "../components/Logo.tsx";
import { ArenaPreview } from "./Previews.tsx";

/** The link preview image (og.png), 1200x630. To make a new one: open #/share in a 1200x630 window,
 * take a screenshot, and save it as src/web/og.png. */
export function ShareCard() {
  return (
    <div className="relative flex h-[630px] w-[1200px] overflow-hidden bg-background">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_left,black_25%,transparent_70%)]" />
      <div className="relative flex w-[640px] shrink-0 flex-col justify-between py-16 pl-16">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <span className="text-2xl font-semibold tracking-tight">System One Arcade</span>
        </div>
        <div>
          <h1 className="text-[64px] leading-[1.04] font-semibold tracking-tight">Watch AI models make split-second calls.</h1>
          <p className="mt-6 text-[22px] text-muted-foreground">Pick the models, press Start, and see who plays best.</p>
        </div>
        <div className="flex items-center gap-3 text-lg">
          {[
            { icon: Swords, name: "Arena" },
            { icon: ScanEye, name: "Attention" },
          ].map((game) => (
            <span key={game.name} className="flex items-center gap-2 rounded-full border bg-card px-4 py-1.5">
              <game.icon className="size-5 text-muted-foreground" />
              {game.name}
            </span>
          ))}
          <span className="ml-3 font-mono text-base text-muted-foreground">system-one-arcade.fly.dev</span>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className="w-[540px]">
          <ArenaPreview square />
        </div>
      </div>
    </div>
  );
}
