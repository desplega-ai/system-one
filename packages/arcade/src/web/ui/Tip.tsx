import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

/** A tooltip around one control. The child must take a ref (a button, a link, a shadcn Button). */
export function Tip({ text, side, children }: { text: ReactNode; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
