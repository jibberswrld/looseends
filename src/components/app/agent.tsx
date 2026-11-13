"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentAction, AgentEvent, AgentMessage } from "@/lib/types";
import { api, ApiFailure, streamNdjson } from "./api";
import { reportError, useStore } from "./store";
import { useWork } from "./work";

export interface AgentNotice {
  message: string;
  topUpUrl: string | null;
}

interface Agent {
  messages: AgentMessage[];
  loaded: boolean;
  /** A message or decision is streaming. */
  busy: boolean;
  /** The assistant message whose text is streaming in right now. */
  liveId: string | null;
  notice: AgentNotice | null;
  send: (text: string) => Promise<void>;
  decide: (action: AgentAction, decision: "approve" | "cancel", args?: Record<string, unknown>) => Promise<void>;
  reset: () => Promise<void>;
}

const Ctx = createContext<Agent | null>(null);
export function useAgent() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAgent outside provider");
  return a;
}

const LOCAL = "local-";
const blank = (id: string, role: AgentMessage["role"], text = ""): AgentMessage => ({ id, role, text, steps: [], actions: [], taskIds: [], createdAt: new Date().toISOString() });
const upsertBy = <T extends { id: string }>(list: T[], item: T) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);

function withMessage(list: AgentMessage[], id: string, fn: (m: AgentMessage) => AgentMessage): AgentMessage[] {
  return list.some((m) => m.id === id) ? list.map((m) => (m.id === id ? fn(m) : m)) : [...list, fn(blank(id, "assistant"))];
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const { upsertMany } = useStore();
  const { setConnections } = useWork();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<AgentNotice | null>(null);
  const seq = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    api<{ messages: AgentMessage[] }>("/api/agent")
      .then((r) => live && setMessages(r.messages ?? []))
      .catch(() => {}) // no history yet is the same as an empty conversation
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  const apply = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case "message": {
          const m = ev.message;
          setMessages((list) => {
            // The server's copy of what the user typed replaces the optimistic one.
            if (m.role === "user") {
              const i = list.findLastIndex((x) => x.id.startsWith(LOCAL));
              if (i >= 0) return list.map((x, j) => (j === i ? m : x));
            }
            return upsertBy(list, m);
          });
          if (m.role === "assistant") setLiveId(m.id);
          break;
        }
        case "text":
          setMessages((list) => withMessage(list, ev.messageId, (m) => ({ ...m, text: m.text + ev.delta })));
          setLiveId(ev.messageId);
          break;
        case "step":
          setMessages((list) => withMessage(list, ev.messageId, (m) => ({ ...m, steps: upsertBy(m.steps, ev.step) })));
          break;
        case "action":
          setMessages((list) => {
            // A status update may arrive under a newer message id; update the card where it already lives.
            const home = list.find((m) => m.actions.some((a) => a.id === ev.action.id));
            return withMessage(list, home?.id ?? ev.messageId, (m) => ({ ...m, actions: upsertBy(m.actions, ev.action) }));
          });
          break;
        case "tasks":
          upsertMany(ev.tasks);
          break;
        case "connections":
          setConnections(ev.connections);
          break;
        case "done":
          setLiveId((id) => (id === ev.messageId ? null : id));
          break;
        case "error":
          setNotice({ message: ev.message, topUpUrl: ev.topUpUrl ?? null });
          break;
      }
    },
    [upsertMany, setConnections],
  );

  const run = useCallback(
    async (path: string, body: unknown, onFail: () => void) => {
      inFlight.current = true;
      setBusy(true);
      setNotice(null);
      try {
        await streamNdjson<AgentEvent>(path, body, apply);
      } catch (e) {
        onFail();
        setNotice(e instanceof ApiFailure ? { message: e.message, topUpUrl: e.topUpUrl } : { message: "Something went wrong. Try again.", topUpUrl: null });
      } finally {
        inFlight.current = false;
        setBusy(false);
        setLiveId(null);
      }
    },
    [apply],
  );

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || inFlight.current) return;
      setMessages((list) => [...list, blank(`${LOCAL}${++seq.current}`, "user", t)]);
      await run("/api/agent", { message: t }, () => {});
    },
    [run],
  );

  const setStatus = (id: string, status: AgentAction["status"]) =>
    setMessages((list) => list.map((m) => (m.actions.some((a) => a.id === id) ? { ...m, actions: m.actions.map((a) => (a.id === id ? { ...a, status } : a)) } : m)));

  const decide = useCallback(
    async (action: AgentAction, decision: "approve" | "cancel", args?: Record<string, unknown>) => {
      if (inFlight.current) return;
      setStatus(action.id, decision === "approve" ? "running" : "cancelled");
      await run(`/api/agent/actions/${action.id}`, args ? { decision, args } : { decision }, () => setStatus(action.id, action.status));
    },
    [run],
  );

  const reset = useCallback(async () => {
    if (inFlight.current) return;
    const before = messages;
    setMessages([]);
    setNotice(null);
    try {
      await api("/api/agent", { method: "DELETE" });
    } catch (e) {
      setMessages(before);
      reportError(e, "Couldn't start a new chat.");
    }
  }, [messages]);

  const value = useMemo<Agent>(() => ({ messages, loaded, busy, liveId, notice, send, decide, reset }), [messages, loaded, busy, liveId, notice, send, decide, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
