"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CaretRight, ClockCounterClockwise, GearSix, House, Plus, type Icon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Action, ConnectorApp, Task } from "@/lib/types";
import { Wordmark } from "../brand";
import { cx } from "../ui";
import { api } from "./api";
import { useStore } from "./store";
import { AppLogo } from "./bits";
import { appsOf, useWork } from "./work";

const navCls = "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium transition-colors duration-150";

function AppRow({ app }: { app: ConnectorApp }) {
  const w = useWork();
  const c = w.connections;
  return (
    <li className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-ink-2">
      <AppLogo slug={app.slug} name={app.name} logo={app.logo} size={15} />
      <span className="min-w-0 truncate font-medium" title={app.name}>{app.name}</span>
      {app.connected ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden /> On
        </span>
      ) : (
        <button
          onClick={() => void w.connect(app.slug)}
          disabled={!c || c.available === false || !!w.linking}
          aria-label={`Connect ${app.name}`}
          className="-mr-1 ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-accent-text hover:bg-accent-soft disabled:text-muted disabled:hover:bg-transparent"
        >
          {w.linking === app.slug ? "Waiting…" : "Connect"}
        </button>
      )}
    </li>
  );
}

const LEAD = ["gmail", "googlecalendar"];

/** Gmail and Calendar first, then whatever else is connected; the rest wait behind "More apps". */
function Apps() {
  const { connections } = useWork();
  const [more, setMore] = useState(false);
  const apps = appsOf(connections);
  const shown = [...apps.filter((a) => LEAD.includes(a.slug)), ...apps.filter((a) => !LEAD.includes(a.slug) && a.connected)];
  const rest = apps.filter((a) => !shown.includes(a));
  return (
    <div className="mt-7 flex min-h-0 flex-col">
      <div className="px-2.5 text-[11.5px] font-medium text-muted">Apps</div>
      <ul className="scrollbar-none mt-1.5 min-h-0 space-y-0.5 overflow-y-auto">
        {shown.map((a) => (
          <AppRow key={a.slug} app={a} />
        ))}
        {rest.length ? (
          <li>
            <button onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-muted transition-colors duration-150 hover:bg-ink/[0.045] hover:text-ink">
              <CaretRight size={12} weight="bold" className={cx("transition-transform duration-150", more && "rotate-90")} />
              More apps
              <span className="ml-auto text-[12px] tabular-nums">{rest.length}</span>
            </button>
          </li>
        ) : null}
        {more ? rest.map((a) => <AppRow key={a.slug} app={a} />) : null}
      </ul>
      {connections && !connections.available && connections.message ? <p className="mt-1.5 px-2.5 text-[12px] leading-snug text-muted">{connections.message}</p> : null}
    </div>
  );
}

const NAV: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Today", icon: House },
  { href: "/capture", label: "Add", icon: Plus },
  { href: "/history", label: "Done", icon: ClockCounterClockwise },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { open } = useStore();
  const openCount = open?.filter((t) => !t.isPromotional && !(t.snoozedUntil && new Date(t.snoozedUntil) > new Date())).length;

  usePublikPresence();
  useDueReminders();

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-[100dvh] flex-col border-r border-line bg-sidebar px-3 py-4 lg:flex">
        <Wordmark href="/" className="px-2" />
        <nav className="mt-6 space-y-0.5" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cx(navCls, active ? "bg-ink/[0.07] text-ink" : "text-ink-2 hover:bg-ink/[0.045] hover:text-ink")}>
                <n.icon size={17} weight={active ? "fill" : "regular"} />
                {n.label}
                {n.href === "/" && openCount ? <span className="ml-auto text-[12px] tabular-nums text-muted">{openCount}</span> : null}
              </Link>
            );
          })}
        </nav>

        <Apps />

        <div className="mt-auto pt-4">
          <Link href="/settings" aria-current={path.startsWith("/settings") ? "page" : undefined} className={cx(navCls, path.startsWith("/settings") ? "bg-ink/[0.07] text-ink" : "text-ink-2 hover:bg-ink/[0.045] hover:text-ink")}>
            <GearSix size={17} />
            Settings
          </Link>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:hidden">
          <Wordmark href="/" />
          <Link href="/settings" aria-label="Settings" className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
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
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
                    <Plus size={20} weight="bold" />
                  </span>
                ) : (
                  <n.icon size={22} weight={active ? "fill" : "regular"} />
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
