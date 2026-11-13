"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { motion, useReducedMotion } from "motion/react";
import {
  Check,
  DotsThree,
  EnvelopeSimple,
  CalendarPlus,
  BellSimple,
  Moon,
  PencilSimple,
  FileText,
  X,
  Trash,
  GitMerge,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Task } from "@/lib/types";
import { Button, Chip, cx } from "../ui";
import { api } from "./api";
import { sourceLabel } from "./bits";
import { snoozePresets, timeAgo } from "./dates";
import { reportError, useStore } from "./store";
import { DueChip, primaryActionLabel, statusLabel } from "./task-bits";

export type Panel = "details" | "reply" | "event" | "reminder" | "source";

export function useTaskCommands() {
  const { patch, remove, upsert, open } = useStore();

  const complete = async (t: Task) => {
    const saved = await patch(t.id, { status: "completed" });
    if (saved)
      toast.success(`Done: ${t.title}`, {
        action: { label: "Undo", onClick: () => void patch(t.id, { status: t.status === "completed" ? "reviewed" : t.status }) },
      });
  };
  const dismiss = async (t: Task) => {
    const saved = await patch(t.id, { status: "dismissed" });
    if (saved)
      toast(`Dismissed: ${t.title}`, {
        action: { label: "Undo", onClick: () => void patch(t.id, { status: "reviewed" }) },
      });
  };
  const snooze = async (t: Task, at: Date) => {
    const saved = await patch(t.id, { snoozedUntil: at.toISOString() });
    if (saved)
      toast(`Snoozed until ${at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`, {
        action: { label: "Undo", onClick: () => void patch(t.id, { snoozedUntil: null }) },
      });
  };
  const del = async (t: Task) => {
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      remove(t.id);
      toast("Task deleted");
    } catch (e) {
      reportError(e);
    }
  };
  const merge = async (t: Task) => {
    if (!t.duplicateOf) return;
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${t.id}/merge`, { method: "POST", json: { into: t.duplicateOf } });
      remove(t.id);
      upsert(r.task);
      toast.success("Merged into your existing task");
    } catch (e) {
      reportError(e);
    }
  };
  const keepBoth = (t: Task) => patch(t.id, { duplicateOf: null });
  const duplicateTitle = (t: Task) => (t.duplicateOf ? open?.find((x) => x.id === t.duplicateOf)?.title ?? null : null);

  return { complete, dismiss, snooze, del, merge, keepBoth, duplicateTitle, patch };
}

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (panel: Panel) => void }) {
  const reduce = useReducedMotion();
  const cmd = useTaskCommands();
  const primary = primaryActionLabel(task);
  const PrimaryIcon = primary.panel === "reply" ? EnvelopeSimple : primary.panel === "event" ? CalendarPlus : BellSimple;
  const dupTitle = cmd.duplicateTitle(task);
  const lowConfidence = task.confidence < 0.5 && task.status === "detected";
  const reply = task.actions.find((a) => a.kind === "reply");
  const draftBody = reply?.kind === "reply" ? reply.payload.body.replace(/\n{2,}/g, "\n") : null;
  const sent = !!reply?.receipts.some((r) => r.what === "Sent with Gmail");

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="group relative list-none rounded-xl border border-line bg-surface shadow-card"
    >
      <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
        <button
          onClick={() => void cmd.complete(task)}
          aria-label={`Mark "${task.title}" done`}
          className="mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-strong text-transparent transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent active:scale-90"
        >
          <Check size={12} weight="bold" />
        </button>

        <div className="min-w-0 flex-1">
          <button onClick={() => onOpen("details")} className="block w-full text-left" aria-label={`Open ${task.title}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <h3 className="min-w-0 text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">{task.title}</h3>
              <DueChip task={task} />
            </div>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{task.nextStep}</p>
          </button>

          {task.evidence?.quote ? (
            <button
              onClick={() => onOpen("source")}
              className="mt-3 block w-full rounded-lg border-l-2 border-accent/50 py-0.5 pl-3 text-left text-[13px] leading-relaxed text-muted transition-colors hover:text-ink-2"
              title="Open the source"
            >
              <span className="line-clamp-2">“{task.evidence.quote}”</span>
            </button>
          ) : null}

          {draftBody ? (
            <button onClick={() => onOpen("reply")} className="mt-3 block w-full rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-line-strong">
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-accent-text">
                <EnvelopeSimple size={13} weight="fill" /> {sent ? "Sent with Gmail" : "Draft ready · not sent"}
              </span>
              <span className="mt-1 line-clamp-2 block whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{draftBody}</span>
            </button>
          ) : null}

          {dupTitle ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              <GitMerge size={15} className="text-accent" />
              <span className="min-w-0 flex-1">
                Looks like <span className="font-medium text-ink">{dupTitle}</span>, already on your list.
              </span>
              <Button size="sm" variant="secondary" onClick={() => void cmd.merge(task)}>
                Merge
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void cmd.keepBoth(task)}>
                Keep both
              </Button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {task.source ? (
              <button onClick={() => onOpen("source")} className="inline-flex max-w-[26ch] items-center gap-1.5 truncate hover:text-ink sm:max-w-[40ch]">
                {task.source.kind === "gmail" ? <EnvelopeSimple size={13} className="shrink-0 text-accent-text" /> : null}
                <span className="truncate">{sourceLabel(task.source)}</span>
              </button>
            ) : (
              <span>Added by you</span>
            )}
            <span aria-hidden>·</span>
            <span>{timeAgo(task.createdAt)}</span>
            <Chip className="ml-1 h-5 px-2 text-[11px]" tone={task.status === "detected" ? "accent" : "neutral"}>
              {statusLabel(task)}
            </Chip>
            {lowConfidence ? (
              <Chip className="h-5 px-2 text-[11px]" tone="warn">
                Check this one
              </Chip>
            ) : null}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant={task.status === "prepared" ? "secondary" : "primary"} onClick={() => onOpen(primary.panel)}>
              <PrimaryIcon size={15} />
              {primary.label}
            </Button>
            {task.status === "detected" ? (
              <Button size="sm" variant="ghost" onClick={() => void cmd.patch(task.id, { status: "reviewed" }, { quiet: false })}>
                Looks right
              </Button>
            ) : null}
            <div className="ml-auto">
              <TaskMenu task={task} onOpen={onOpen} />
            </div>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

const itemCls =
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink-2 outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink";

export function TaskMenu({ task, onOpen }: { task: Task; onOpen: (p: Panel) => void }) {
  const cmd = useTaskCommands();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          aria-label="More actions"
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink data-[state=open]:bg-surface-2"
        >
          <DotsThree size={20} weight="bold" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[210px] rounded-lg border border-line bg-surface p-1 shadow-float"
        >
          <Menu.Item className={itemCls} onSelect={() => onOpen("details")}>
            <PencilSimple size={16} /> Edit details
          </Menu.Item>
          <Menu.Item className={itemCls} onSelect={() => onOpen("reply")}>
            <EnvelopeSimple size={16} /> Draft a reply
          </Menu.Item>
          <Menu.Item className={itemCls} onSelect={() => onOpen("event")}>
            <CalendarPlus size={16} /> Prepare calendar event
          </Menu.Item>
          <Menu.Item className={itemCls} onSelect={() => onOpen("reminder")}>
            <BellSimple size={16} /> Set a reminder
          </Menu.Item>
          {task.sourceId ? (
            <Menu.Item className={itemCls} onSelect={() => onOpen("source")}>
              <FileText size={16} /> Open source
            </Menu.Item>
          ) : null}
          <Menu.Sub>
            <Menu.SubTrigger className={cx(itemCls, "data-[state=open]:bg-surface-2")}>
              <Moon size={16} /> Snooze
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent sideOffset={6} className="z-50 min-w-[180px] rounded-lg border border-line bg-surface p-1 shadow-float">
                {snoozePresets().map((p) => (
                  <Menu.Item key={p.label} className={itemCls} onSelect={() => void cmd.snooze(task, p.at)}>
                    {p.label}
                  </Menu.Item>
                ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item className={itemCls} onSelect={() => void cmd.dismiss(task)}>
            <X size={16} /> Dismiss
          </Menu.Item>
          <Menu.Item className={cx(itemCls, "text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger")} onSelect={() => void cmd.del(task)}>
            <Trash size={16} /> Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
