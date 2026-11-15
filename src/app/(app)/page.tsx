"use client";

import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { Me, Task } from "@/lib/types";
import { api } from "@/components/app/api";
import { dayDiff, greeting, isOverdue } from "@/components/app/dates";
import { Composer, Item, Live } from "@/components/app/home";
import { useStore } from "@/components/app/store";
import type { Panel } from "@/components/app/task-card";
import { TaskSheet } from "@/components/app/task-sheet";
import { useWork } from "@/components/app/work";
import { Button, Skeleton, cx } from "@/components/ui";

const PRIORITY = { high: 0, normal: 1, low: 2 } as const;
const byDue = (a: Task, b: Task) =>
  (a.dueAt ? +new Date(a.dueAt) : Infinity) - (b.dueAt ? +new Date(b.dueAt) : Infinity) ||
  PRIORITY[a.priority] - PRIORITY[b.priority] ||
  +new Date(b.createdAt) - +new Date(a.createdAt);

function group(tasks: Task[]) {
  const now = new Date();
  const g = { overdue: [] as Task[], soon: [] as Task[], later: [] as Task[], snoozed: [] as Task[], promo: [] as Task[] };
  for (const t of tasks) {
    const dated = t.dueAt && t.dueStatus !== "unclear";
    if (t.isPromotional) g.promo.push(t);
    else if (t.snoozedUntil && new Date(t.snoozedUntil) > now) g.snoozed.push(t);
    else if (dated && isOverdue(t.dueAt!, t.dueAllDay, now)) g.overdue.push(t);
    else if (dated && dayDiff(t.dueAt!, now) <= 7) g.soon.push(t);
    else g.later.push(t);
  }
  for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort(byDue);
  return g;
}

const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

export default function TodayPage() {
  const { open, history, error, refresh, selectedId, select } = useStore();
  const w = useWork();
  const [panel, setPanel] = useState<Panel>("details");
  const [handle, setHandle] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null | undefined>(undefined); // undefined = the first one, null = all closed
  const groups = useMemo(() => (open ? group(open) : null), [open]);
  const list = groups ? [...groups.overdue, ...groups.soon, ...groups.later] : [];
  const selected = open?.find((t) => t.id === selectedId) ?? history?.find((t) => t.id === selectedId) ?? null;
  const focusId = focus === undefined ? (list[0]?.id ?? null) : focus;

  useEffect(() => {
    void api<Me>("/api/me").then((m) => setHandle(m.handle)).catch(() => {});
  }, []);

  const openTask = (id: string, p: Panel = "details") => {
    setPanel(p);
    select(id);
  };
  const showTask = (id: string) => {
    setFocus(id);
    document.getElementById(`t-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const n = list.length;
  const empty = !!groups && n === 0;

  const section = (title: string, tasks: Task[], tone?: "danger") =>
    tasks.length ? (
      <section aria-label={title}>
        <h2 className={cx("mb-1 px-3.5 text-[12.5px] font-medium", tone === "danger" ? "text-danger" : "text-muted")}>
          {title} <span className="tabular-nums opacity-70">{tasks.length}</span>
        </h2>
        <ul className="space-y-0.5">
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <Item key={t.id} task={t} expanded={focusId === t.id} onToggle={() => setFocus(focusId === t.id ? null : t.id)} onOpen={(p) => openTask(t.id, p)} />
            ))}
          </AnimatePresence>
        </ul>
      </section>
    ) : null;

  return (
    <main className="mx-auto w-full max-w-[880px] px-4 pt-5 pb-16 sm:px-6 lg:pt-7">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-[18px] font-medium tracking-[-0.02em]">
          {greeting()}{handle ? `, ${handle}` : ""}
        </h1>
        <p className="text-right text-[13px] text-muted">
          {!groups ? "Loading your list…" : empty ? "No open to-dos" : `${NUM[n] ?? n} ${n === 1 ? "thing needs" : "things need"} you`}
        </p>
      </header>

      <div>
        <Composer hasTasks={n > 0} onOpenTask={showTask} />
      </div>

      {w.running || w.lines.length ? (
        <div className="mt-6">
          <Live onOpenTask={showTask} />
        </div>
      ) : null}

      {error && !open ? (
        <div role="alert" className="mt-8 rounded-xl bg-danger-soft px-5 py-4 text-[14px] text-ink-2">
          {error}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        </div>
      ) : !groups ? (
        <div className="mt-10 space-y-3" aria-label="Loading your list">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <div className="mt-10 space-y-7">
          {section("Overdue", groups.overdue, "danger")}
          {section("This week", groups.soon)}
          {section("Later", groups.later)}
          <Collapsible title="Snoozed" tasks={groups.snoozed} focusId={focusId} setFocus={setFocus} onOpen={openTask} />
          <Collapsible title="Probably marketing" tasks={groups.promo} focusId={focusId} setFocus={setFocus} onOpen={openTask} />
        </div>
      )}

      <TaskSheet task={selected} panel={panel} onPanel={setPanel} onClose={() => select(null)} />
    </main>
  );
}

function Collapsible({ title, tasks, focusId, setFocus, onOpen }: { title: string; tasks: Task[]; focusId: string | null; setFocus: (id: string | null) => void; onOpen: (id: string, p: Panel) => void }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <section>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 px-3.5 text-[12.5px] font-medium text-muted hover:text-ink">
        <CaretDown size={12} weight="bold" className={cx("transition-transform duration-150", !open && "-rotate-90")} />
        {title} <span className="tabular-nums opacity-70">{tasks.length}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5">
          {tasks.map((t) => (
            <Item key={t.id} task={t} expanded={focusId === t.id} onToggle={() => setFocus(focusId === t.id ? null : t.id)} onOpen={(p) => onOpen(t.id, p)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
