import { Maximize, Minimize } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Tip } from "./Tip.tsx";

/**
 * Puts one element (the video, the arena) in full screen, without the rest of the page. iPhone Safari has
 * no full screen for elements, so there the element covers the window instead (`data-maximized`, styled in
 * globals.css) and the page stops scrolling. Esc leaves both.
 */
export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [native, setNative] = useState(false);
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    const onChange = () => setNative(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    const el = target.current;
    if (!covering || !el) return;
    el.setAttribute("data-maximized", "");
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCovering(false);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeAttribute("data-maximized");
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [covering]);
  const on = native || covering;
  const toggle = () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (covering) return setCovering(false);
    const el = target.current;
    if (el && document.fullscreenEnabled && typeof el.requestFullscreen === "function") void el.requestFullscreen().catch(() => setCovering(true));
    else setCovering(true);
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
