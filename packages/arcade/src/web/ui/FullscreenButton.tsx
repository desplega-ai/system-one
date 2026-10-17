import { Maximize, Minimize } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Tip } from "./Tip.tsx";

/** Puts one element (the video, the arena) in full screen, without the rest of the page. */
export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onChange = () => setOn(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.current?.requestFullscreen();
  };
  return (
    <Tip text={on ? "Leave full screen (Esc)" : "Full screen: only this view"}>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={on ? "Leave full screen" : "Full screen"}
        onClick={toggle}
        className="absolute top-3 right-3 z-10 bg-black/50 opacity-60 backdrop-blur transition-opacity hover:opacity-100"
      >
        {on ? <Minimize /> : <Maximize />}
      </Button>
    </Tip>
  );
}
