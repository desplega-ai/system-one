import { cn } from "cn";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import type { BudgetInfo } from "../lib/api.ts";
import { useBudget } from "../lib/budget.ts";
import { Logo } from "./Logo.tsx";

export type NavLink = { path: string; title: string; icon: ComponentType<{ className?: string }> };

const dollars = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
// Measured costs: a 30 s webcam session with 3 models, and one arena match with 4.
const webcamUsd = 0.02;
const matchUsd = 0.004;

export function TopBar({ links, active }: { links: NavLink[]; active?: string }) {
  const budget = useBudget();
  return (
    <header data-chrome className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <a href="#/" className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight" aria-label="System One Arcade, home">
          <Logo className="size-7" />
          <span className="hidden md:inline">System One Arcade</span>
        </a>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <a
              key={link.path}
              href={`#/${link.path}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3",
                active === link.path && "bg-white/[0.06] text-foreground",
              )}
            >
              <link.icon className="size-4" />
              {link.title}
            </a>
          ))}
        </nav>
        {budget && <BudgetPill budget={budget} />}
      </div>
    </header>
  );
}

function BudgetPill({ budget }: { budget: BudgetInfo }) {
  // A public site shows each visitor its own share. A private one shows the whole day's spend.
  const spent = budget.you ? budget.you.spent : budget.spent.total;
  const cap = budget.you ? budget.you.cap : budget.dailyUsd;
  const share = cap ? Math.min(1, spent / cap) : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="ml-auto flex shrink-0 items-center gap-3 rounded-full border px-3 py-1 font-mono text-xs tabular-nums text-muted-foreground">
          <span>
            <span className="hidden sm:inline">{budget.you ? "your share " : "today "}</span>
            {dollars(spent)}
            {cap !== undefined && <span className="opacity-60"> / {dollars(cap)}</span>}
          </span>
          {cap !== undefined && (
            <span className="hidden h-1 w-14 overflow-hidden rounded-full bg-white/10 sm:block">
              <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${share * 100}%` }} />
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {budget.you ? (
          <>
            <p>
              Model calls cost money, so each visitor gets {dollars(budget.you.cap)} a day. That is about {Math.floor(budget.you.cap / webcamUsd)} webcam
              sessions with 3 models, or {Math.floor(budget.you.cap / matchUsd)} matches.
            </p>
            {budget.dailyUsd !== undefined && (
              <p className="mt-1 opacity-70">
                The whole arcade today: {dollars(budget.spent.total)} of {dollars(budget.dailyUsd)}.
              </p>
            )}
          </>
        ) : (
          "What the model calls cost today. The server refuses calls above the daily cap."
        )}
      </TooltipContent>
    </Tooltip>
  );
}
