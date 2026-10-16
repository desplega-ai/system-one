// The voice game's side of protocol.ts: it follows the Acme page in an iframe and calls its tools.
import { useEffect, useRef, useState } from "react";
import type { AcmeMessage, AcmeRequest, Snapshot } from "../../acme/protocol.ts";

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type Pending = { resolve: (reply: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const REPLY_TIMEOUT_MS = 5000;

export function useAcme() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /** The newest state, for code that runs outside a render. */
  const latest = useRef<Snapshot | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const seq = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      const msg = e.data as AcmeMessage | null;
      if (!msg || typeof msg !== "object" || !("acme" in msg)) return;
      latest.current = msg.snapshot;
      setSnapshot(msg.snapshot);
      if (msg.acme !== "reply") return;
      const waiting = pending.current.get(msg.id);
      if (!waiting) return;
      pending.current.delete(msg.id);
      clearTimeout(waiting.timer);
      if (msg.ok) waiting.resolve(msg.reply);
      else waiting.reject(new Error(msg.error));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const send = (request: WithoutId<AcmeRequest>) =>
    new Promise<string>((resolve, reject) => {
      const target = frame.current?.contentWindow;
      if (!target) return reject(new Error("the Acme page is not loaded"));
      const id = ++seq.current;
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error("the Acme page did not answer"));
      }, REPLY_TIMEOUT_MS);
      pending.current.set(id, { resolve, reject, timer });
      target.postMessage({ ...request, id }, location.origin);
    });

  return {
    frame,
    snapshot,
    latest,
    /** Runs a tool. Resolves with the page's reply, in the page language. */
    call: (name: string, input: Record<string, unknown> = {}) => send({ acme: "call", name, input }),
    reset: () => send({ acme: "reset" }),
  };
}
