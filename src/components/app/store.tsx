"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Task } from "@/lib/types";
import { api, ApiFailure } from "./api";

interface Store {
  open: Task[] | null;
  history: Task[] | null;
  error: string | null;
  refresh: () => Promise<void>;
  loadHistory: () => Promise<void>;
  /** Replace / insert a task returned by the server. */
  upsert: (t: Task) => void;
  upsertMany: (ts: Task[]) => void;
  remove: (id: string) => void;
  /** PATCH a task with optimistic update; returns the saved task or null. */
  patch: (id: string, changes: Partial<Task> & Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<Task | null>;
  selectedId: string | null;
  select: (id: string | null) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

export function reportError(e: unknown, fallback = "Something went wrong.") {
  if (e instanceof ApiFailure) {
    if (e.topUpUrl) {
      toast.error(e.message, {
        action: { label: "Add credit", onClick: () => window.open(e.topUpUrl!, "_blank", "noopener") },
        duration: 12000,
      });
    } else toast.error(e.message);
  } else toast.error(fallback);
}

const isClosed = (t: Task) => t.status === "completed" || t.status === "dismissed";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Task[] | null>(null);
  const [history, setHistory] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ tasks: Task[] }>("/api/tasks?view=open");
      setOpen(r.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your tasks.");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api<{ tasks: Task[] }>("/api/tasks?view=history");
      setHistory(r.tasks);
    } catch (e) {
      reportError(e, "Couldn't load history.");
    }
  }, []);

  const upsertMany = useCallback((ts: Task[]) => {
    setOpen((prev) => {
      let next = prev ? [...prev] : [];
      for (const t of ts) {
        next = next.filter((x) => x.id !== t.id);
        if (!isClosed(t)) next.push(t);
      }
      return next;
    });
    setHistory((prev) => {
      if (!prev) return prev;
      let next = [...prev];
      for (const t of ts) {
        next = next.filter((x) => x.id !== t.id);
        if (isClosed(t) || t.status === "approved") next.unshift(t);
      }
      return next;
    });
  }, []);
  const upsert = useCallback((t: Task) => upsertMany([t]), [upsertMany]);

  const remove = useCallback((id: string) => {
    setOpen((p) => p?.filter((t) => t.id !== id) ?? p);
    setHistory((p) => p?.filter((t) => t.id !== id) ?? p);
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const patch = useCallback<Store["patch"]>(
    async (id, changes, opts) => {
      const before = openRef.current?.find((t) => t.id === id);
      if (before) setOpen((p) => p?.map((t) => (t.id === id ? ({ ...t, ...changes } as Task) : t)) ?? p);
      try {
        const saved = await api<Task>(`/api/tasks/${id}`, { method: "PATCH", json: changes });
        upsert(saved);
        return saved;
      } catch (e) {
        if (before) upsert(before);
        if (!opts?.quiet) reportError(e, "Couldn't save that change.");
        return null;
      }
    },
    [upsert],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the await
    void refresh();
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const value = useMemo<Store>(
    () => ({ open, history, error, refresh, loadHistory, upsert, upsertMany, remove, patch, selectedId, select: setSelectedId }),
    [open, history, error, refresh, loadHistory, upsert, upsertMany, remove, patch, selectedId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
