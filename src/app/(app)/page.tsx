"use client";

import { AnimatePresence } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { CaptureForm, CaptureLinkCard, ManualAdd } from "@/components/app/capture";
import { dayDiff, greeting, isOverdue } from "@/components/app/dates";
import { Page, PageHeader } from "@/components/app/page-header";
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
  const { open, error, refresh, selectedId, select } = useStore();
  const [panel, setPanel] = useState<Panel>("details");
  // First run: keep the capture + review flow on screen until the person finishes reviewing.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  if (onboarding === null && open) setOnboarding(open.length === 0);
  const groups = useMemo(() => (open ? group(open) : null), [open]);
  const selected = open?.find((t) => t.id === selectedId) ?? null;
  const active = groups ? groups.review.length + groups.overdue.length + groups.soon.length + groups.later.length : 0;

  const openTask = (id: string, p: Panel) => {
    setPanel(p);
    select(id);
  };

  let body: ReactNode;
  if (error && !open) {
    body = (
      <div role="alert" className="mt-8 rounded-2xl bg-danger-soft px-5 py-4 text-[14px] text-ink-2">
        {error}
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else if (!groups) {
    body = (
      <div className="mt-8 space-y-3" aria-label="Loading your list">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-5 h-8 w-32 rounded-xl" />
          </div>
        ))}
      </div>
    );
  } else if (onboarding || open!.length === 0) {
    body = (
      <div className="mt-8 space-y-4">
        <div className={cx("rounded-2xl border border-line bg-surface p-5 sm:p-6", open!.length > 0 && "hidden")}>
          <h2 className="text-[17px] font-semibold">Start with one message</h2>
          <p className="mt-1 max-w-[56ch] text-[14px] leading-relaxed text-muted">
            Paste anything with a request in it: an email from school, a text from your landlord, an appointment reminder. LooseEnds pulls out what you need to do and when.
          </p>
        </div>
        <CaptureForm onFinish={() => setOnboarding(false)} />
      </div>
    );
  } else {
    body = (
      <div className="mt-8 space-y-9">
        {active === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-[17px] font-semibold">You're all caught up</h2>
            <p className="mt-1 text-[14px] text-muted">Nothing open right now. When the next message lands, drop it in.</p>
          </div>
        ) : null}
        <Section title="Needs a look" hint="New or unconfirmed. Check these first." tasks={groups.review} onOpen={openTask} />
        <Section title="Overdue" tasks={groups.overdue} onOpen={openTask} tone="danger" />
        <Section title="This week" tasks={groups.soon} onOpen={openTask} />
        <Section title="Later" tasks={groups.later} onOpen={openTask} />
        <CaptureLinkCard />
        <Collapsible title="Snoozed" tasks={groups.snoozed} onOpen={openTask} />
        <Collapsible title="Probably promotional" tasks={groups.promo} onOpen={openTask} />
        <div className="pt-1">
          <ManualAdd />
        </div>
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title={greeting()}
        sub={
          groups
            ? active === 0
              ? "Nothing on your mind right now."
              : `${active} ${active === 1 ? "thing" : "things"} on your mind${groups.overdue.length ? `, ${groups.overdue.length} overdue` : ""}.`
            : " "
        }
      />
      {body}
      <TaskSheet task={selected} panel={panel} onPanel={setPanel} onClose={() => select(null)} />
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
  tone?: "danger";
}) {
  if (!tasks.length) return null;
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className={cx("text-[14px] font-semibold", tone === "danger" ? "text-danger" : "text-ink")}>{title}</h2>
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
