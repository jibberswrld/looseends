"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AskAnswer, CaptureResult, Connections, ScanEvent, Task, Toolkit } from "@/lib/types";
import { api, ApiFailure } from "./api";
import { useStore } from "./store";

/** One line in the work stream: what LooseEnds is doing, as it does it. */
export interface WorkLine {
  id: number;
  kind: "step" | "found" | "skip" | "done" | "error" | "answer" | "you";
  text: string;
  sub?: string | null;
  taskIds?: string[];
  topUpUrl?: string | null;
}

interface Work {
  lines: WorkLine[];
  running: string | null; // label of the job in flight
  connections: Connections | null;
  linking: Toolkit | null;
  connect: (t: Toolkit) => Promise<void>;
  disconnect: (t: Toolkit) => Promise<void>;
  refreshConnections: () => Promise<Connections | null>;
  scanInbox: () => Promise<void>;
  draftReplies: () => Promise<void>;
  ask: (q: string) => Promise<void>;
  capture: (input: { text?: string; file?: File; label: string }) => Promise<void>;
  clear: () => void;
}

const Ctx = createContext<Work | null>(null);
export function useWork() {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWork outside provider");
  return w;
}

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function WorkProvider({ children }: { children: ReactNode }) {
  const { upsert, upsertMany, open } = useStore();
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [linking, setLinking] = useState<Toolkit | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

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
      setConnections({ available: false, message: "Connections can't be reached right now.", gmail: { connected: false, lastScanAt: null }, googlecalendar: { connected: false } });
      return null;
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the await
    void refreshConnections();
  }, [refreshConnections]);

  const connect = useCallback(
    async (t: Toolkit) => {
      const name = t === "gmail" ? "Gmail" : "Google Calendar";
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
      setLinking(t);
      say("step", `Waiting for you to approve ${name} in the other tab`);
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 3000));
        const c = await refreshConnections();
        if (c?.[t].connected) {
          say("done", `${name} is connected`);
          setLinking(null);
          return;
        }
      }
      setLinking(null);
      say("error", `${name} wasn't connected. Try again when you're ready.`);
    },
    [fail, refreshConnections, say],
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
        const res = await fetch("/api/inbox/scan", { method: "POST", headers: { "x-timezone": tz() } });
        if (!res.ok || !res.body) {
          const b = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string; topUpUrl?: string } } | null;
          throw new ApiFailure(res.status, b?.error?.code ?? "error", b?.error?.message ?? "Couldn't check your inbox.", b?.error?.topUpUrl ?? null);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const onEvent = (ev: ScanEvent) => {
          if (ev.type === "step") say("step", ev.text);
          else if (ev.type === "email") {
            if (ev.outcome === "tasks" && ev.tasks.length) {
              upsertMany(ev.tasks);
              say("found", ev.tasks.map((t) => t.title).join(" · "), { sub: `${ev.from} · ${ev.subject}`, taskIds: ev.tasks.map((t) => t.id) });
            } else {
              const why = ev.outcome === "promotional" ? "marketing" : ev.outcome === "duplicate" ? "already on your list" : "nothing to do";
              say("skip", `${ev.subject || "(no subject)"}`, { sub: `${ev.from} · ${why}` });
            }
          } else if (ev.type === "done") {
            say("done", ev.found ? `Found ${ev.found} ${ev.found === 1 ? "thing" : "things"} to do in ${ev.scanned} emails` : `Read ${ev.scanned} emails. Nothing new needs you.`);
            void refreshConnections();
          } else if (ev.type === "error") say("error", ev.message, { topUpUrl: ev.topUpUrl ?? null });
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) onEvent(JSON.parse(line) as ScanEvent);
          }
        }
        if (buf.trim()) onEvent(JSON.parse(buf) as ScanEvent);
      }),
    [job, say, upsertMany, refreshConnections],
  );

  const draftReplies = useCallback(
    () =>
      job("Drafting replies", "Draft my replies", async () => {
        const todo = (openRef.current ?? []).filter(
          (t) => t.nextStepType === "reply" && !t.isPromotional && !t.actions.some((a) => a.kind === "reply"),
        );
        if (!todo.length) {
          say("done", "No replies are waiting for a draft.");
          return;
        }
        say("step", `Writing ${todo.length} ${todo.length === 1 ? "reply" : "replies"}`);
        let n = 0;
        for (const t of todo.slice(0, 8)) {
          const r = await api<{ task: Task }>(`/api/tasks/${t.id}/draft`, { method: "POST", json: {} });
          upsert(r.task);
          n++;
          say("found", `Draft ready: ${t.title}`, { sub: t.source?.title ?? null, taskIds: [t.id] });
        }
        say("done", `${n} ${n === 1 ? "draft is" : "drafts are"} ready for you to review. Nothing was sent.`);
      }),
    [job, say, upsert],
  );

  const ask = useCallback(
    (q: string) =>
      job("Thinking", q, async () => {
        const a = await api<AskAnswer>("/api/ask", { method: "POST", json: { question: q } });
        say("answer", a.answer, { taskIds: a.taskIds });
      }),
    [job, say],
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
    () => ({ lines, running, connections, linking, connect, disconnect, refreshConnections, scanInbox, draftReplies, ask, capture, clear: () => setLines([]) }),
    [lines, running, connections, linking, connect, disconnect, refreshConnections, scanInbox, draftReplies, ask, capture],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
