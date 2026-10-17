import { cn } from "cn";
import { ChartColumn } from "lucide-react";
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import type { BudgetInfo } from "../lib/api.ts";
import { useBudget } from "../lib/budget.ts";
import { FlipText } from "../ui/FlipText.tsx";
import { GitHubMark, repoUrl } from "./GitHub.tsx";
import { Logo } from "./Logo.tsx";

export type NavLink = { path: string; title: string; icon: ComponentType<{ className?: string }> };

/** Short money for the header: "$0.03", "$15", "<$0.01". */
const dollars = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
// Measured costs: a 30 s webcam session with 3 models, and one arena match with 4.
const webcamUsd = 0.02;
const matchUsd = 0.004;

const linkClass = (active: boolean) =>
  cn(
    "inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3",
    active && "bg-white/[0.06] text-foreground",
  );

export function TopBar({ links, active }: { links: NavLink[]; active?: string }) {
  const budget = useBudget();
  return (
    <header data-chrome className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <a href="#/" className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight" aria-label="System One Arcade, home">
          <Logo className="size-7" />
          <span className="hidden md:inline">System One Arcade</span>
        </a>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <a key={link.path} href={`#/${link.path}`} className={linkClass(active === link.path)} aria-label={link.title}>
              <link.icon className="size-4" />
              <span className="hidden sm:inline">{link.title}</span>
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <a href="#/live" className={linkClass(active === "live")} aria-label="Live">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-live" />
            </span>
            <span className="hidden sm:inline">Live</span>
          </a>
          <a href="#/stats" className={linkClass(active === "stats")} aria-label="Stats">
            <ChartColumn className="size-4" />
            <span className="hidden sm:inline">Stats</span>
          </a>
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={repoUrl} target="_blank" rel="noreferrer" className={cn(linkClass(false), "hidden px-2 sm:inline-flex sm:px-2")} aria-label="Source on GitHub">
                <GitHubMark className="size-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Source on GitHub</TooltipContent>
          </Tooltip>
          {budget && <BudgetMeter budget={budget} />}
        </div>
      </div>
    </header>
  );
}

/** Two gauges in one pill: this visitor's share and the whole arcade's day. A private server has only the day.
 * The spend has 4 decimals, and its changed digits flip in as the budget refreshes (every 5 s). */
function BudgetMeter({ budget }: { budget: BudgetInfo }) {
  const site = budget.dailyUsd !== undefined ? { spent: budget.spent.total, cap: budget.dailyUsd } : undefined;
  const you = budget.you;
  if (!site && !you) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="flex shrink-0 items-center rounded-full border bg-white/[0.02] font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {you && <Gauge label="You" {...you} />}
          {you && site && <span className="hidden h-4 w-px bg-border sm:block" />}
          {site && <Gauge label={you ? "Arcade" : "Today"} {...site} className={you ? "hidden sm:flex" : undefined} />}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-2 p-3">
        {you && (
          <p>
            <span className="font-medium">Your share:</span> {dollars(you.spent)} of {dollars(you.cap)} today. That is about{" "}
            {Math.floor(you.cap / webcamUsd)} webcam sessions with 3 models, or {Math.floor(you.cap / matchUsd)} matches.
          </p>
        )}
        {site && (
          <p>
            <span className="font-medium">{you ? "The whole arcade" : "Today"}:</span> {dollars(site.spent)} of {dollars(site.cap)}. Above the cap, the games stop
            for everyone.
          </p>
        )}
        <p className="opacity-70">Both reset at 00:00 UTC, in {untilMidnightUtc()}.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** A ring that fills as the money goes, a label, and "spent / cap". It turns amber at 75% and red at the cap. */
function Gauge({ label, spent, cap, className }: { label: string; spent: number; cap: number; className?: string }) {
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  const tone = share >= 1 ? "text-destructive" : share >= 0.75 ? "text-amber-400" : "text-foreground";
  const r = 5.5;
  const length = 2 * Math.PI * r;
  return (
    <span className={cn("flex items-center gap-2 py-1 pr-3 pl-2", className)}>
      <svg viewBox="0 0 16 16" className={cn("size-4 -rotate-90", tone)} aria-hidden="true">
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
        {share > 0 && (
          <circle
            cx="8"
            cy="8"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(share * length, 0.5)} ${length}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        )}
      </svg>
      <span className="caps hidden text-[10px] text-muted-foreground lg:inline">{label}</span>
      <span className="flex items-baseline">
        <FlipText text={`$${spent.toFixed(4)}`} className={tone} />
        {/* Phones show the ring and the spend only. */}
        <span className="hidden whitespace-pre text-muted-foreground sm:inline"> / {dollars(cap)}</span>
      </span>
    </span>
  );
}

/** "5 h 12 min" until the next 00:00 UTC. */
function untilMidnightUtc(now = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.ceil((next - now.getTime()) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
