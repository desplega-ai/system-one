import { ArrowRight, ChartBar, Image, ListChecks } from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import type { GameInfo } from "../App.tsx";
import { ArenaPreview, AttentionPreview } from "./Previews.tsx";

const previews: Record<string, ComponentType> = { arena: ArenaPreview, attention: AttentionPreview };

const steps = [
  { icon: Image, text: "The game sends the scene: text, a picture, or your webcam." },
  { icon: ListChecks, text: "Each model answers typed questions: a choice, a score, a yes or no." },
  { icon: ChartBar, text: "You see every probability. The board ranks the models on skill, speed and cost." },
];

function previewOf(path: string) {
  const Preview = previews[path];
  return Preview ? <Preview /> : <div className="aspect-[16/10] bg-black/40" />;
}

export function Home({ games }: { games: GameInfo[] }) {
  return (
    <div className="pb-8">
      <section className="relative -mx-4 overflow-hidden px-4 pt-10 pb-8 sm:-mx-6 sm:px-6 sm:pt-14 sm:pb-10">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
        <div className="relative max-w-2xl">
          <p className="caps mb-4 text-muted-foreground">System One Arcade</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Watch AI models make split-second calls.</h1>
          <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
            Every move is one fast, typed decision with real probabilities. Pick the models, press Start, and see who plays best.
          </p>
        </div>
      </section>

      <section className="grid max-w-4xl gap-5 md:grid-cols-2">
        {games.map((game) => (
          <a
            key={game.path}
            href={`#/${game.path}`}
            className="group overflow-hidden rounded-2xl border bg-card transition-colors hover:border-white/20"
          >
            <div className="overflow-hidden border-b">{previewOf(game.path)}</div>
            <div className="flex items-start gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <game.icon className="size-4 text-muted-foreground" />
                  <h2 className="text-lg font-semibold tracking-tight">{game.title}</h2>
                </div>
                <p className="mt-1 font-medium">{game.tagline}</p>
                <p className="mt-2 text-sm text-muted-foreground">{game.text}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {game.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button size="sm" className="shrink-0" tabIndex={-1}>
                Play <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </a>
        ))}
      </section>

      <section className="mt-14 max-w-4xl">
        <h2 className="caps mb-4 text-muted-foreground">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.text} className="flex gap-3 rounded-xl border bg-card/60 p-5">
              <step.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm">
                <span className="mr-1.5 font-mono text-muted-foreground">{i + 1}.</span>
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
        Made with 💜 by{" "}
        <a href="https://tarasyarema.com" target="_blank" rel="noreferrer" className="text-foreground underline-offset-4 hover:underline">
          taras
        </a>{" "}
        from{" "}
        <a href="https://desplega.sh" target="_blank" rel="noreferrer" className="text-foreground underline-offset-4 hover:underline">
          desplega labs
        </a>
      </footer>
    </div>
  );
}
