"use client";

import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { ManualAdd } from "@/components/app/capture";
import { Briefing, Composer, Rail, Starters, WorkStream } from "@/components/app/home";
import { api } from "@/components/app/api";
import type { Me } from "@/lib/types";
import { dayDiff, greeting, isOverdue } from "@/components/app/dates";
import { Page } from "@/components/app/page-header";
import { useStore } from "@/components/app/store";
import { TaskCard, type Panel } from "@/components/app/task-card";
import { TaskSheet } from "@/components/app/task-sheet";
import { Button, Skeleton, cx } from "@/components/ui";

const PRIORITY = { high: 0, normal: 1, low: 2 } as const;
const byDue = (a: Task, b: Task) =>
  (a.dueAt ? +new Date(a.dueAt) : Infinity) - (b.dueAt ? +new Date(b.dueAt) : Infinity) ||
  PRIORITY[a.priority] - PRIORITY[b.priority] ||
  +new Date(b.createdAt) - +new Date(a.createdAt);

function group(tasks: Task[]) {
  const now = new Date();
  const g = { review: [] as Task[], overdue: [] as Task[], soon: [] as Task[], later: [] as Task[], snoozed: [] as Task[], promo: [] as Task[] };
  for (const t of tasks) {
    if (t.isPromotional) g.promo.push(t);
    else if (t.snoozedUntil && new Date(t.snoozedUntil) > now) g.snoozed.push(t);
    else if (t.status === "detected" || t.duplicateOf || t.dueStatus === "needs_review") g.review.push(t);
    else if (t.dueAt && t.dueStatus !== "unclear" && isOverdue(t.dueAt, t.dueAllDay, now)) g.overdue.push(t);
    else if (t.dueAt && t.dueStatus !== "unclear" && dayDiff(t.dueAt, now) <= 7) g.soon.push(t);
    else g.later.push(t);
  }
  for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort(byDue);
  return g;
}

export default function TodayPage() {
  const { open, history, loadHistory, error, refresh, selectedId, select } = useStore();
  const [panel, setPanel] = useState<Panel>("details");
  const [handle, setHandle] = useState<string | null>(null);
  const groups = useMemo(() => (open ? group(open) : null), [open]);
  const selected = open?.find((t) => t.id === selectedId) ?? null;
  const active = groups ? groups.review.length + groups.overdue.length + groups.soon.length + groups.later.length : 0;

  useEffect(() => {
    void loadHistory();
    void api<Me>("/api/me").then((m) => setHandle(m.handle)).catch(() => {});
  }, [loadHistory]);

  const openTask = (id: string, p: Panel = "details") => {
    setPanel(p);
    select(id);
  };

  let queue: ReactNode;
  if (error && !open) {
    queue = (
      <div role="alert" className="rounded-xl bg-danger-soft px-5 py-4 text-[14px] text-ink-2">
        {error}
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else if (!groups) {
    queue = (
      <div className="space-y-3" aria-label="Loading your list">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-5 h-8 w-32" />
          </div>
        ))}
      </div>
    );
  } else if (active === 0 && !groups.snoozed.length && !groups.promo.length) {
    queue = (
      <div className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center">
        <p className="text-[15px] font-[560]">{open!.length ? "You're all caught up" : "Your list is empty"}</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[13.5px] text-muted">
          {open!.length ? "Nothing open right now. Check your inbox or paste the next message when it lands." : "Connect Gmail or paste a message above. Whatever needs you shows up here, with the next step ready."}
        </p>
      </div>
    );
  } else {
    queue = (
      <div className="space-y-8">
        <Section title="Needs you" hint="New or unconfirmed" tasks={groups.review} onOpen={openTask} tone="warn" />
        <Section title="Overdue" tasks={groups.overdue} onOpen={openTask} tone="danger" />
        <Section title="This week" tasks={groups.soon} onOpen={openTask} />
        <Section title="Later" tasks={groups.later} onOpen={openTask} />
        <Collapsible title="Snoozed" tasks={groups.snoozed} onOpen={openTask} />
        <Collapsible title="Probably promotional" tasks={groups.promo} onOpen={openTask} />
      </div>
    );
  }

  return (
    <Page wide>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Briefing tasks={open ?? []} greeting={greeting()} handle={handle} />
          <Composer />
          <Starters />
          <WorkStream onOpenTask={(id) => openTask(id)} />
          <div className="pt-4">{queue}</div>
          <div className="pt-1">
            <ManualAdd />
          </div>
        </div>
        <Rail tasks={open ?? []} history={history} onOpenTask={(id) => openTask(id)} />
      </div>
      <TaskSheet task={selected ?? history?.find((t) => t.id === selectedId) ?? null} panel={panel} onPanel={setPanel} onClose={() => select(null)} />
    </Page>
  );
}

function Section({
  title,
  hint,
  tasks,
  onOpen,
  tone,
}: {
  title: string;
  hint?: string;
  tasks: Task[];
  onOpen: (id: string, p: Panel) => void;
  tone?: "danger" | "warn";
}) {
  if (!tasks.length) return null;
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className={cx("text-[13px] font-[560]", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink-2")}>{title}</h2>
        <span className="text-[13px] tabular-nums text-muted">{tasks.length}</span>
        {hint ? <span className="hidden text-[13px] text-muted sm:inline">· {hint}</span> : null}
      </div>
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={(p) => onOpen(t.id, p)} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function Collapsible({ title, tasks, onOpen }: { title: string; tasks: Task[]; onOpen: (id: string, p: Panel) => void }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <section>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-[14px] font-semibold text-ink-2 hover:text-ink">
        <CaretDown size={14} weight="bold" className={cx("transition-transform", !open && "-rotate-90")} />
        {title}
        <span className="font-normal tabular-nums text-muted">{tasks.length}</span>
      </button>
      {open ? (
        <ul className="mt-3 space-y-3">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={(p) => onOpen(t.id, p)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
