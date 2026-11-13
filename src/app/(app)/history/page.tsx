"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, CheckCircle, Prohibit, SealCheck } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { sourceLabel } from "@/components/app/bits";
import { Page, PageHeader } from "@/components/app/page-header";
import { useStore } from "@/components/app/store";
import { TaskSheet } from "@/components/app/task-sheet";
import type { Panel } from "@/components/app/task-card";
import { Button, Skeleton, cx } from "@/components/ui";

type Filter = "all" | "completed" | "approved" | "dismissed";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const { history, loadHistory, patch, select, selectedId } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [panel, setPanel] = useState<Panel>("details");

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const groups = useMemo(() => {
    if (!history) return null;
    const list = history.filter((t) => filter === "all" || t.status === filter);
    const map = new Map<string, Task[]>();
    for (const t of list) {
      const k = dayLabel(t.completedAt ?? t.updatedAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()];
  }, [history, filter]);
  const selected = history?.find((t) => t.id === selectedId) ?? null;
  const doneCount = history?.filter((t) => t.status === "completed").length ?? 0;

  return (
    <Page>
      <PageHeader
        title="History"
        sub={history ? (doneCount ? `${doneCount} ${doneCount === 1 ? "thing" : "things"} finished. Everything you approved or dismissed is here too.` : "Finished, approved and dismissed tasks show up here.") : " "}
      />
      <div role="tablist" aria-label="Filter" className="mt-6 inline-flex rounded-lg bg-surface-2 p-1">
        {(["all", "completed", "approved", "dismissed"] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cx(
              "h-8 rounded-lg px-3 text-[13px] font-medium capitalize transition-colors",
              filter === f ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {f === "completed" ? "Done" : f}
          </button>
        ))}
      </div>

      {!groups ? (
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-8 rounded-xl border border-line bg-surface p-6 text-[14px] text-muted">
          Nothing here yet. When you finish or dismiss something, it lands here so you can always see what happened.
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map(([day, tasks]) => (
            <section key={day}>
              <h2 className="mb-2.5 text-[13px] font-semibold text-muted">{day}</h2>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {tasks.map((t, i) => {
                  const Icon = t.status === "completed" ? CheckCircle : t.status === "approved" ? SealCheck : Prohibit;
                  const receipts = t.actions.flatMap((a) => a.receipts);
                  return (
                    <li key={t.id} className={cx("flex items-center gap-3 px-4 py-3.5", i > 0 && "border-t border-line")}>
                      <Icon size={20} weight={t.status === "dismissed" ? "regular" : "fill"} className={t.status === "dismissed" ? "text-muted" : "text-accent"} />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setPanel("details");
                          select(t.id);
                        }}
                      >
                        <p className={cx("truncate text-[14.5px] font-medium", t.status === "dismissed" && "text-muted line-through")}>{t.title}</p>
                        <p className="truncate text-[12.5px] text-muted">
                          {t.status === "completed" ? "Done" : t.status === "approved" ? "Approved" : "Dismissed"}
                          {receipts.length ? ` · ${receipts[receipts.length - 1].what}` : ""}
                          {t.source ? ` · ${sourceLabel(t.source)}` : ""}
                        </p>
                      </button>
                      {t.status !== "approved" ? (
                        <Button size="sm" variant="ghost" onClick={() => void patch(t.id, { status: "reviewed" })}>
                          <ArrowCounterClockwise size={14} />
                          <span className="hidden sm:inline">Restore</span>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <TaskSheet task={selected} panel={panel} onPanel={setPanel} onClose={() => select(null)} />
    </Page>
  );
}
