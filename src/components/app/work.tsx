"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CaptureResult, Connections, ConnectorApp, ScanEvent, Toolkit } from "@/lib/types";
import { api, ApiFailure, streamNdjson } from "./api";
import { senderName } from "./bits";
import { useStore } from "./store";

/** One line in the work stream: what LooseEnds is doing, as it does it. */
export interface WorkLine {
  id: number;
  kind: "step" | "found" | "skip" | "done" | "error" | "you";
  text: string;
  sub?: string | null;
  taskIds?: string[];
  topUpUrl?: string | null;
}

interface Work {
  lines: WorkLine[];
  running: string | null; // label of the job in flight
  connections: Connections | null;
  setConnections: (c: Connections) => void;
  linking: Toolkit | null;
  connect: (t: Toolkit) => Promise<void>;
  /** Poll until `t` shows as connected (after its consent tab was opened). Resolves true when it did. */
  waitForConnection: (t: Toolkit) => Promise<boolean>;
  disconnect: (t: Toolkit) => Promise<void>;
  refreshConnections: () => Promise<Connections | null>;
  scanInbox: () => Promise<void>;
  capture: (input: { text?: string; file?: File; label: string }) => Promise<void>;
  clear: () => void;
}

const Ctx = createContext<Work | null>(null);
export function useWork() {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWork outside provider");
  return w;
}

/** Every app to show, in display order. Falls back to the two Google apps when the server sends no list. */
export function appsOf(c: Connections | null): ConnectorApp[] {
  if (c?.apps?.length) return c.apps;
  return [
    { slug: "gmail", name: "Gmail", logo: null, connected: !!c?.gmail.connected },
    { slug: "googlecalendar", name: "Google Calendar", logo: null, connected: !!c?.googlecalendar.connected },
  ];
}
export const findApp = (c: Connections | null, slug: Toolkit) => appsOf(c).find((a) => a.slug === slug) ?? null;

export function WorkProvider({ children }: { children: ReactNode }) {
  const { upsertMany } = useStore();
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [linking, setLinking] = useState<Toolkit | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);

  const say = useCallback((kind: WorkLine["kind"], text: string, extra: Partial<WorkLine> = {}) => {
    setLines((l) => [...l.slice(-60), { id: ++seq.current, kind, text, ...extra }]);
  }, []);
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiFailure) say("error", e.message, { topUpUrl: e.topUpUrl });
      else say("error", "Something went wrong. Try again.");
    },
    [say],
  );

  /** Run one job at a time; the stream shows it. */
  const job = useCallback(
    async (label: string, you: string, fn: () => Promise<void>) => {
      if (busy.current) return;
      busy.current = true;
      setRunning(label);
      say("you", you);
      try {
        await fn();
      } catch (e) {
        fail(e);
      } finally {
        busy.current = false;
        setRunning(null);
      }
    },
    [say, fail],
  );

  const refreshConnections = useCallback(async () => {
    try {
      const c = await api<Connections>("/api/connections");
      setConnections(c);
      return c;
    } catch {
      setConnections({ available: false, message: "Connections can't be reached right now.", apps: [], gmail: { connected: false, lastScanAt: null }, googlecalendar: { connected: false } });
      return null;
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the await
    void refreshConnections();
  }, [refreshConnections]);

  const waitForConnection = useCallback(
    async (t: Toolkit) => {
      setLinking(t);
      try {
        const until = Date.now() + 5 * 60_000;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 3000));
          const c = await refreshConnections();
          if (findApp(c, t)?.connected) return true;
        }
        return false;
      } finally {
        setLinking(null);
      }
    },
    [refreshConnections],
  );

  const connect = useCallback(
    async (t: Toolkit) => {
      const name = findApp(connections, t)?.name ?? t;
      // Open the tab inside the click so browsers don't block it, then point it at the consent screen.
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api<{ url: string }>("/api/connections/link", { method: "POST", json: { toolkit: t } });
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (e) {
        tab?.close();
        fail(e);
        return;
      }
      say("step", `Waiting for you to approve ${name} in the other tab`);
      if (await waitForConnection(t)) say("done", `${name} is connected`);
      else say("error", `${name} wasn't connected. Try again when you're ready.`);
    },
    [connections, fail, say, waitForConnection],
  );

  const disconnect = useCallback(
    async (t: Toolkit) => {
      try {
        setConnections(await api<Connections>("/api/connections/disconnect", { method: "POST", json: { toolkit: t } }));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const scanInbox = useCallback(
    () =>
      job("Checking your inbox", "Check my inbox", async () => {
        const onEvent = (ev: ScanEvent) => {
          if (ev.type === "step") say("step", ev.text);
          else if (ev.type === "email") {
            if (ev.outcome === "tasks" && ev.tasks.length) {
              upsertMany(ev.tasks);
              say("found", ev.tasks.map((t) => t.title).join(" · "), { sub: `${senderName(ev.from) ?? ev.from} · ${ev.subject}`, taskIds: ev.tasks.map((t) => t.id) });
            } else {
              const why = ev.outcome === "promotional" ? "marketing" : ev.outcome === "duplicate" ? "already on your list" : "nothing to do";
              say("skip", `${ev.subject || "(no subject)"}`, { sub: `${senderName(ev.from) ?? ev.from} · ${why}` });
            }
          } else if (ev.type === "done") {
            say("done", ev.found ? `Found ${ev.found} ${ev.found === 1 ? "thing" : "things"} to do in ${ev.scanned} emails` : `Read ${ev.scanned} emails. Nothing new needs you.`);
            void refreshConnections();
          } else if (ev.type === "error") say("error", ev.message, { topUpUrl: ev.topUpUrl ?? null });
        };
        await streamNdjson<ScanEvent>("/api/inbox/scan", {}, onEvent, "Couldn't check your inbox.");
      }),
    [job, say, upsertMany, refreshConnections],
  );

  const capture = useCallback(
    ({ text, file, label }: { text?: string; file?: File; label: string }) =>
      job("Reading it", label, async () => {
        say("step", file ? `Reading ${file.name}` : "Reading your message");
        let r: CaptureResult;
        if (file) {
          const fd = new FormData();
          fd.set("file", file);
          if (text?.trim()) fd.set("note", text.trim());
          r = await api<CaptureResult>("/api/capture", { method: "POST", body: fd });
        } else {
          r = await api<CaptureResult>("/api/capture", { method: "POST", json: { text } });
        }
        if (r.tasks.length) upsertMany(r.tasks);
        const real = r.tasks.filter((t) => !t.isPromotional);
        if (r.source?.injectionDetected) say("skip", "This message tried to instruct the AI. Ignored.", { sub: "Nothing was sent or changed" });
        if (r.outcome === "duplicate_source") say("skip", "You already added this one", { sub: r.duplicateOf?.title ?? null });
        else if (real.length)
          for (const t of real) say("found", t.title, { sub: t.evidence?.quote ? `“${t.evidence.quote.slice(0, 90)}”` : null, taskIds: [t.id] });
        if (r.outcome !== "duplicate_source")
          say("done", real.length ? `Found ${real.length} ${real.length === 1 ? "thing" : "things"} to do` : (r.message ?? "Nothing to do in this one."));
      }),
    [job, say, upsertMany],
  );

  const value = useMemo<Work>(
    () => ({ lines, running, connections, setConnections, linking, connect, waitForConnection, disconnect, refreshConnections, scanInbox, capture, clear: () => setLines([]) }),
    [lines, running, connections, linking, connect, waitForConnection, disconnect, refreshConnections, scanInbox, capture],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
