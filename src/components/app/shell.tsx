"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ClockCounterClockwise, GearSix, Plus, SunHorizon, type Icon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Action, Task } from "@/lib/types";
import { Wordmark } from "../brand";
import { cx } from "../ui";
import { api } from "./api";
import { useStore } from "./store";

const NAV: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/capture", label: "Capture", icon: Plus },
  { href: "/history", label: "History", icon: ClockCounterClockwise },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { open } = useStore();
  const openCount = open?.filter((t) => !t.isPromotional && !(t.snoozedUntil && new Date(t.snoozedUntil) > new Date())).length;

  usePublikPresence();
  useDueReminders();

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-[100dvh] flex-col border-r border-line px-4 py-5 lg:flex">
        <Wordmark href="/" className="px-2" />
        <nav className="mt-8 space-y-0.5" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
                  active ? "bg-surface text-ink shadow-card" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <n.icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-accent" : undefined} />
                {n.label}
                {n.href === "/" && openCount ? (
                  <span className="ml-auto text-xs tabular-nums text-muted">{openCount}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <Link
            href="/settings"
            aria-current={path.startsWith("/settings") ? "page" : undefined}
            className={cx(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
              path.startsWith("/settings") ? "bg-surface text-ink shadow-card" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <GearSix size={18} />
            Settings
          </Link>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:hidden">
          <Wordmark href="/" />
          <Link href="/settings" aria-label="Settings" className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2">
            <GearSix size={20} />
          </Link>
        </header>
        {children}
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-ink" : "text-muted")}
              >
                {n.href === "/capture" ? (
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink">
                    <Plus size={20} weight="bold" />
                  </span>
                ) : (
                  <n.icon size={22} weight={active ? "fill" : "regular"} className={active ? "text-accent" : undefined} />
                )}
                {n.href === "/capture" ? null : n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Usage counting for publik: app_opened once, active_session heartbeats while the tab is visible. */
function usePublikPresence() {
  useEffect(() => {
    void api("/api/publik/opened", { method: "POST" }).catch(() => {});
    const beat = () => {
      if (document.visibilityState === "visible") void api("/api/publik/heartbeat", { method: "POST" }).catch(() => {});
    };
    const id = setInterval(beat, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
}

/** In-app reminders: check every minute while LooseEnds is open, and on return. */
function useDueReminders() {
  const { select, upsert } = useStore();
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await api<{ reminders: { action: Action; task: Task }[] }>("/api/reminders/due");
        if (stopped) return;
        for (const { action, task } of r.reminders) {
          upsert(task);
          const note = action.kind === "reminder" ? action.payload.note : null;
          toast(`Reminder: ${task.title}`, {
            description: note ?? task.nextStep,
            duration: Infinity,
            action: { label: "Open", onClick: () => { router.push("/"); select(task.id); } },
          });
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
            new Notification(`Reminder: ${task.title}`, { body: note ?? task.nextStep, icon: "/icon-192.png" });
          }
          void api(`/api/actions/${action.id}/fired`, { method: "POST" }).catch(() => {});
        }
      } catch {
        /* reminders are best-effort; the task list still shows due items */
      }
    };
    void check();
    const id = setInterval(check, 60_000);
    const onVis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [select, upsert, router]);
}
