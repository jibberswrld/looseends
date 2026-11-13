"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  BellSimple,
  CalendarPlus,
  Check,
  CopySimple,
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  Info,
  PaperPlaneTilt,
  ShieldWarning,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Action, EventPayload, ReplyPayload, Source, Task } from "@/lib/types";
import { Button, Chip, cx, Input, Label, Select, Skeleton, Textarea } from "../ui";
import { api } from "./api";
import { sourceLabel } from "./bits";
import { formatDue, fromLocalInput, toLocalDateInput, toLocalInput, timeAgo } from "./dates";
import { reportError, useStore } from "./store";
import { DueChip, STATUS_FLOW } from "./task-bits";
import { useTaskCommands, type Panel } from "./task-card";
import { useWork } from "./work";

const TABS: { id: Panel; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "reply", label: "Reply" },
  { id: "event", label: "Event" },
  { id: "reminder", label: "Reminder" },
  { id: "source", label: "Source" },
];

export function TaskSheet({
  task,
  panel,
  onPanel,
  onClose,
}: {
  task: Task | null;
  panel: Panel;
  onPanel: (p: Panel) => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <Dialog.Root open={!!task} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {task ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-[rgb(10_14_16/0.32)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-line bg-bg shadow-float outline-none sm:inset-y-2 sm:right-2 sm:left-auto sm:max-h-none sm:w-[min(560px,calc(100vw-1rem))] sm:rounded-xl"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 0, y: 40 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 30, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
              >
                <SheetBody task={task} panel={panel} onPanel={onPanel} onClose={onClose} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function SheetBody({ task, panel, onPanel, onClose }: { task: Task; panel: Panel; onPanel: (p: Panel) => void; onClose: () => void }) {
  const cmd = useTaskCommands();
  const closed = task.status === "completed" || task.status === "dismissed";
  return (
    <>
      <div className="flex items-start gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-[19px] font-semibold leading-snug tracking-[-0.015em]">{task.title}</Dialog.Title>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DueChip task={task} />
            {task.priority === "high" ? <Chip tone="danger">High priority</Chip> : null}
          </div>
        </div>
        <Dialog.Close asChild>
          <button aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
            <X size={18} />
          </button>
        </Dialog.Close>
      </div>

      <StatusTrail task={task} />

      <div role="tablist" aria-label="Task sections" className="scrollbar-none mx-5 mt-4 flex gap-1 overflow-x-auto border-b border-line sm:mx-6">
        {TABS.filter((t) => t.id !== "source" || task.sourceId).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={panel === t.id}
            onClick={() => onPanel(t.id)}
            className={cx(
              "relative h-10 shrink-0 px-3 text-[13.5px] font-medium transition-colors",
              panel === t.id ? "text-ink" : "text-muted hover:text-ink-2",
            )}
          >
            {t.label}
            {panel === t.id ? <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {panel === "details" ? <DetailsPanel key={task.id} task={task} /> : null}
        {panel === "reply" ? <ReplyPanel task={task} /> : null}
        {panel === "event" ? <EventPanel task={task} /> : null}
        {panel === "reminder" ? <ReminderPanel task={task} /> : null}
        {panel === "source" && task.sourceId ? <SourcePanel task={task} onDeleted={onClose} /> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3.5 sm:px-6">
        {closed ? (
          <Button variant="secondary" onClick={() => void cmd.patch(task.id, { status: "reviewed" })}>
            Restore to list
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={() => { void cmd.complete(task); onClose(); }}>
              <Check size={16} weight="bold" /> Mark done
            </Button>
            <Button variant="ghost" onClick={() => { void cmd.dismiss(task); onClose(); }}>
              Dismiss
            </Button>
          </>
        )}
        <Button variant="danger" className="ml-auto" onClick={() => { void cmd.del(task); onClose(); }}>
          <Trash size={16} /> Delete
        </Button>
      </div>
    </>
  );
}

function StatusTrail({ task }: { task: Task }) {
  const idx = task.status === "dismissed" ? -1 : STATUS_FLOW.indexOf(task.status === "failed" ? "prepared" : task.status);
  return (
    <ol className="mt-4 flex items-center gap-1.5 px-5 text-[11.5px] font-medium sm:px-6" aria-label="Progress">
      {task.status === "dismissed" ? (
        <li className="text-muted">Dismissed {timeAgo(task.updatedAt)}</li>
      ) : (
        STATUS_FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={cx(
                "rounded-full px-2 py-0.5 capitalize",
                i < idx && "text-accent-text",
                i === idx && (task.status === "failed" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-text"),
                i > idx && "text-muted/70",
              )}
            >
              {i === idx && task.status === "failed" ? "Failed" : s}
            </span>
            {i < STATUS_FLOW.length - 1 ? <span aria-hidden className={cx("h-px w-3", i < idx ? "bg-accent/50" : "bg-line-strong")} /> : null}
          </li>
        ))
      )}
    </ol>
  );
}

/* ------------------------------ Details ------------------------------ */

function DetailsPanel({ task }: { task: Task }) {
  const { patch } = useStore();
  const [title, setTitle] = useState(task.title);
  const [nextStep, setNextStep] = useState(task.nextStep);
  const [type, setType] = useState(task.nextStepType);
  const [allDay, setAllDay] = useState(task.dueAllDay);
  const [due, setDue] = useState(task.dueAllDay ? toLocalDateInput(task.dueAt) : toLocalInput(task.dueAt));
  const [priority, setPriority] = useState(task.priority);
  const [recipient, setRecipient] = useState(task.recipient ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    title !== task.title ||
    nextStep !== task.nextStep ||
    type !== task.nextStepType ||
    priority !== task.priority ||
    recipient !== (task.recipient ?? "") ||
    allDay !== task.dueAllDay ||
    due !== (task.dueAllDay ? toLocalDateInput(task.dueAt) : toLocalInput(task.dueAt));

  const save = async () => {
    setSaving(true);
    const dueAt = fromLocalInput(due);
    const saved = await patch(task.id, {
      title: title.trim() || task.title,
      nextStep: nextStep.trim(),
      nextStepType: type,
      priority,
      recipient: recipient.trim() || null,
      dueAt,
      dueAllDay: allDay,
      ...(dueAt ? { dueStatus: "confirmed" } : { dueStatus: "none" }),
    });
    setSaving(false);
    if (saved) toast.success("Saved");
  };

  return (
    <div className="space-y-5">
      {task.dueStatus === "needs_review" || task.dueStatus === "unclear" ? (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
          <p className="flex items-center gap-2 font-medium text-warn">
            <Info size={16} weight="bold" />
            {task.dueStatus === "needs_review" ? "Please confirm this date" : "The message doesn't give an exact date"}
          </p>
          {task.dueText ? <p className="mt-1">It says “{task.dueText}”.</p> : null}
          {task.dueNote ? <p className="mt-0.5 text-muted">{task.dueNote}</p> : null}
          {task.dueStatus === "needs_review" && task.dueAt ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => void patch(task.id, { dueStatus: "confirmed", dueAt: task.dueAt })}
            >
              Yes, {formatDue(task.dueAt, task.dueAllDay)}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="d-title">Task</Label>
        <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-next">Next step</Label>
        <Textarea id="d-next" rows={2} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="d-type">Kind of step</Label>
          <Select id="d-type" value={type} onChange={(e) => setType(e.target.value as Task["nextStepType"])}>
            <option value="reply">Reply to someone</option>
            <option value="event">Add to calendar</option>
            <option value="reminder">Remember to do it</option>
            <option value="form">Fill in a form</option>
            <option value="call">Make a call</option>
            <option value="pay">Pay something</option>
            <option value="other">Something else</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-priority">Priority</Label>
          <Select id="d-priority" value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="d-due"
          hint={
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={allDay}
                onChange={(e) => {
                  setAllDay(e.target.checked);
                  setDue((v) => (e.target.checked ? v.slice(0, 10) : v ? `${v.slice(0, 10)}T09:00` : ""));
                }}
              />
              All day
            </label>
          }
        >
          Due
        </Label>
        <div className="flex gap-2">
          <Input id="d-due" type={allDay ? "date" : "datetime-local"} value={due} onChange={(e) => setDue(e.target.value)} />
          {due ? (
            <Button variant="ghost" onClick={() => setDue("")}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-to">Who it involves</Label>
        <Input id="d-to" placeholder="e.g. Riverside Dental front desk" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </div>
      {task.evidence?.quote ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-ink-2">Why LooseEnds found this</p>
          <blockquote className="rounded-lg border-l-2 border-accent/60 bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
            “{task.evidence.quote}”
          </blockquote>
        </div>
      ) : null}
      <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
        Save changes
      </Button>
    </div>
  );
}

/* ------------------------------ Reply ------------------------------ */

function NotSentBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
      <Info size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  );
}

function Receipts({ action }: { action: Action }) {
  if (!action.receipts.length && !action.error) return null;
  return (
    <ul className="space-y-1 text-[12.5px] text-muted">
      {action.error ? <li className="text-danger">Failed: {action.error}</li> : null}
      {action.receipts.map((r, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <Check size={12} weight="bold" className="text-accent" />
          {r.what} · {new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </li>
      ))}
    </ul>
  );
}

function useActionCalls(task: Task) {
  const { upsert } = useStore();
  const call = async (path: string, json?: unknown, method = "POST") => {
    try {
      const r = await api<{ task: Task }>(path, { method, json });
      upsert(r.task);
      return r.task;
    } catch (e) {
      reportError(e);
      return null;
    }
  };
  const receipt = (a: Action, what: string, status: "approved" | undefined = "approved") =>
    call(`/api/actions/${a.id}`, { receipt: { what }, ...(status ? { status } : {}) }, "PATCH");
  return { call, receipt, taskId: task.id };
}

/** An outbound action. Always a two-step press: the preview above is what goes out. */
export function ConfirmSend({ label, confirmLabel, detail, onSend, disabled }: { label: string; confirmLabel: string; detail: string; onSend: () => Promise<unknown>; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed)
    return (
      <Button variant="primary" onClick={() => setArmed(true)} disabled={disabled}>
        <PaperPlaneTilt size={16} weight="fill" /> {label}
      </Button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-accent-text/40 bg-accent-soft px-3 py-2.5">
      <span className="min-w-0 flex-1 text-[13px] text-ink">{detail}</span>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)} disabled={busy}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await onSend();
          setBusy(false);
          setArmed(false);
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

const REVISIONS = ["Shorter", "More formal", "Friendlier", "Ask to reschedule"];

function ReplyPanel({ task }: { task: Task }) {
  const action = task.actions.find((a) => a.kind === "reply") as Extract<Action, { kind: "reply" }> | undefined;
  const { call, receipt } = useActionCalls(task);
  const { connections, connect } = useWork();
  const gmail = !!connections?.gmail.connected;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ReplyPayload | null>(action?.payload ?? null);
  const [shown, setShown] = useState(action?.payload);
  const [instruction, setInstruction] = useState("");
  if (action?.payload !== shown) {
    // A new draft arrived from the server (first draft or a revision): show it.
    setShown(action?.payload);
    setDraft(action?.payload ?? null);
  }

  const generate = async (instr?: string) => {
    setBusy(true);
    await call(`/api/tasks/${task.id}/draft`, instr ? { instruction: instr } : {});
    setBusy(false);
    setInstruction("");
  };

  if (!action && !busy) {
    return (
      <div className="space-y-4">
        <p className="text-[14.5px] leading-relaxed text-ink-2">
          LooseEnds will write a short reply using only what's in the message. You review it, then send it yourself.
        </p>
        <Button variant="primary" onClick={() => void generate()}>
          <Sparkle size={16} /> Draft a reply
        </Button>
      </div>
    );
  }
  if (busy && !action) return <DraftSkeleton />;

  const edited = draft && action && JSON.stringify(draft) !== JSON.stringify(action.payload);
  const save = async () => {
    if (!action || !draft) return null;
    return call(`/api/actions/${action.id}`, { payload: draft }, "PATCH");
  };
  const text = draft ? `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}` : "";

  const copy = async () => {
    if (!action || !draft) return;
    if (edited) await save();
    try {
      await navigator.clipboard.writeText(draft.body);
      await receipt(action, "Copied to clipboard");
      toast.success("Copied. Paste it wherever you reply.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  };
  const openMail = async () => {
    if (!action || !draft) return;
    if (edited) await save();
    const to = draft.to && /@/.test(draft.to) ? draft.to : "";
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(draft.subject ?? "")}&body=${encodeURIComponent(draft.body)}`;
    window.location.assign(url);
    await receipt(action, "Opened in your mail app");
  };

  return (
    <div className="space-y-4">
      <NotSentBanner>Not sent yet. Nothing goes out until you press send and confirm.</NotSentBanner>
      {draft && /\[[^\]]+\]/.test(draft.body) ? (
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0 text-warn" />
          Fill in the parts in [brackets] before you send it. Only you know those.
        </p>
      ) : null}
      {draft ? (
        <div className={cx("space-y-3 transition-opacity", busy && "opacity-50")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-to">To</Label>
              <Input id="r-to" value={draft.to ?? ""} onChange={(e) => setDraft({ ...draft, to: e.target.value || null })} placeholder="Who you're replying to" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-subj">Subject</Label>
              <Input id="r-subj" value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value || null })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-body">Message</Label>
            <Textarea id="r-body" rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
        </div>
      ) : null}
      {action && draft ? (
        action.receipts.some((r) => r.what === "Sent with Gmail") ? (
          <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3.5 py-2.5 text-[13.5px] font-medium text-accent-text">
            <Check size={15} weight="bold" /> Sent with Gmail
          </p>
        ) : gmail ? (
          <div className="flex flex-wrap gap-2">
            <ConfirmSend
              label="Send with Gmail"
              confirmLabel="Send now"
              detail={`Send this reply${draft.to ? ` to ${draft.to}` : ""} from your Gmail?`}
              disabled={busy}
              onSend={async () => {
                if (edited) await save();
                const t = await call(`/api/actions/${action.id}/send`, { confirm: true });
                if (t) toast.success("Sent with Gmail");
              }}
            />
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (edited) await save();
                const t = await call(`/api/actions/${action.id}/gmail-draft`, {});
                if (t) toast.success("Saved to your Gmail drafts");
              }}
            >
              Save to Gmail drafts
            </Button>
          </div>
        ) : connections?.available ? (
          <button onClick={() => void connect("gmail")} className="text-left text-[13px] font-medium text-accent-text underline underline-offset-2">
            Connect Gmail to send this from LooseEnds
          </button>
        ) : null
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant={gmail ? "secondary" : "primary"} onClick={() => void copy()} disabled={busy}>
          <CopySimple size={16} /> Copy reply
        </Button>
        <Button variant="secondary" onClick={() => void openMail()} disabled={busy}>
          <PaperPlaneTilt size={16} /> Open in mail app
        </Button>
        {edited ? (
          <Button variant="ghost" onClick={() => void save().then((t) => t && toast.success("Draft saved"))}>
            Save edits
          </Button>
        ) : null}
      </div>
      {action ? <Receipts action={action} /> : null}

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-[13px] font-medium text-ink-2">Change the draft</p>
        <div className="flex flex-wrap gap-1.5">
          {REVISIONS.map((r) => (
            <button
              key={r}
              disabled={busy}
              onClick={() => void generate(r)}
              className="h-8 rounded-full border border-line-strong px-3 text-[12.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {r}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim()) void generate(instruction.trim());
          }}
        >
          <Input aria-label="Tell LooseEnds how to change the draft" placeholder="Or say what to change…" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <Button type="submit" variant="secondary" loading={busy} disabled={!instruction.trim()}>
            Revise
          </Button>
        </form>
        <div className="text-[12.5px] text-muted">{text.length ? `${draft?.body.split(/\s+/).filter(Boolean).length ?? 0} words` : null}</div>
      </div>
    </div>
  );
}

function DraftSkeleton() {
  return (
    <div className="space-y-3" aria-label="Writing your draft">
      <p className="flex items-center gap-2 text-[13.5px] text-muted">
        <Sparkle size={15} className="text-accent" /> Writing a draft from the message…
      </p>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-10/12" />
      <Skeleton className="h-4 w-8/12" />
      <Skeleton className="h-4 w-9/12" />
    </div>
  );
}

/* ------------------------------ Event ------------------------------ */

function gcalUrl(e: EventPayload) {
  const fmt = (iso: string, allDay: boolean) =>
    allDay ? iso.slice(0, 10).replace(/-/g, "") : new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  let end = e.end;
  if (e.allDay) {
    const d = new Date(e.start);
    d.setDate(d.getDate() + 1);
    end = toLocalDateInput(d.toISOString());
  }
  const startStr = e.allDay ? toLocalDateInput(e.start).replace(/-/g, "") : fmt(e.start, false);
  const endStr = e.allDay ? end.replace(/-/g, "") : fmt(end, false);
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${startStr}/${endStr}` });
  if (e.location) p.set("location", e.location);
  if (e.notes) p.set("details", e.notes);
  return `https://calendar.google.com/calendar/render?${p}`;
}

function EventPanel({ task }: { task: Task }) {
  const action = task.actions.find((a) => a.kind === "event") as Extract<Action, { kind: "event" }> | undefined;
  const { call, receipt } = useActionCalls(task);
  const { connections, connect } = useWork();
  const gcal = !!connections?.googlecalendar.connected;
  const base = action?.payload;
  const [title, setTitle] = useState(base?.title ?? task.title);
  const [allDay, setAllDay] = useState(base?.allDay ?? task.dueAllDay);
  const [start, setStart] = useState(() => {
    const iso = base?.start ?? task.dueAt;
    return (base?.allDay ?? task.dueAllDay) ? toLocalDateInput(iso) : toLocalInput(iso);
  });
  const [minutes, setMinutes] = useState(() =>
    base && !base.allDay ? Math.max(15, Math.round((+new Date(base.end) - +new Date(base.start)) / 60000)) : 30,
  );
  const [location, setLocation] = useState(base?.location ?? "");
  const [notes, setNotes] = useState(base?.notes ?? task.nextStep);
  const [busy, setBusy] = useState(false);

  const prepare = async () => {
    const s = fromLocalInput(start);
    if (!s) {
      toast.error("Pick a date first.");
      return;
    }
    setBusy(true);
    const end = allDay ? s : new Date(+new Date(s) + minutes * 60000).toISOString();
    await call(`/api/tasks/${task.id}/event`, { title, start: s, end, allDay, location: location || null, notes: notes || null });
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <NotSentBanner>Suggested, not created. Your calendar only changes when you add the event.</NotSentBanner>
      <div className="space-y-1.5">
        <Label htmlFor="e-title">Event</Label>
        <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
        <div className="space-y-1.5">
          <Label
            htmlFor="e-start"
            hint={
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={allDay}
                  onChange={(e) => {
                    setAllDay(e.target.checked);
                    setStart((v) => (e.target.checked ? v.slice(0, 10) : v ? `${v.slice(0, 10)}T09:00` : ""));
                  }}
                />
                All day
              </label>
            }
          >
            Starts
          </Label>
          <Input id="e-start" type={allDay ? "date" : "datetime-local"} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {!allDay ? (
          <div className="space-y-1.5">
            <Label htmlFor="e-len">Length</Label>
            <Select id="e-len" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? "s" : ""}`}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e-loc">Location</Label>
        <Input id="e-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e-notes">Notes</Label>
        <Textarea id="e-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button variant={action ? "secondary" : "primary"} onClick={() => void prepare()} loading={busy}>
        <CalendarPlus size={16} /> {action ? "Update event" : "Prepare event"}
      </Button>

      {action ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <p className="font-medium">{action.payload.title}</p>
            <p className="text-[13.5px] text-muted">{formatDue(action.payload.start, action.payload.allDay)}</p>
          </div>
          {action.receipts.some((r) => r.what === "Added to Google Calendar") ? (
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-accent-text">
              <Check size={15} weight="bold" /> Added to Google Calendar
            </p>
          ) : gcal ? (
            <ConfirmSend
              label="Add to Google Calendar"
              confirmLabel="Add it"
              detail={`Add “${action.payload.title}” on ${formatDue(action.payload.start, action.payload.allDay)} to your calendar?`}
              onSend={async () => {
                const t = await call(`/api/actions/${action.id}/send`, { confirm: true });
                if (t) toast.success("Added to Google Calendar");
              }}
            />
          ) : connections?.available ? (
            <button onClick={() => void connect("googlecalendar")} className="text-left text-[13px] font-medium text-accent-text underline underline-offset-2">
              Connect Google Calendar to add it in one tap
            </button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.href = `/api/actions/${action.id}/ics`;
                void receipt(action, "Downloaded calendar file");
              }}
            >
              <DownloadSimple size={15} /> Download .ics
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.open(gcalUrl(action.payload), "_blank", "noopener");
                void receipt(action, "Opened in Google Calendar");
              }}
            >
              <ArrowSquareOut size={15} /> Google Calendar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const p = action.payload;
                await navigator.clipboard.writeText(
                  [p.title, formatDue(p.start, p.allDay), p.location, p.notes].filter(Boolean).join("\n"),
                );
                void receipt(action, "Copied event details");
                toast.success("Event details copied");
              }}
            >
              <CopySimple size={15} /> Copy
            </Button>
          </div>
          <Receipts action={action} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Reminder ------------------------------ */

const isPast = (at: Date) => at.getTime() < Date.now() - 60_000;

function reminderPresets(task: Task) {
  const now = new Date();
  const out: { label: string; at: Date }[] = [{ label: "In 1 hour", at: new Date(+now + 3600_000) }];
  const tonight = new Date(now);
  tonight.setHours(19, 0, 0, 0);
  if (tonight > now) out.push({ label: "Tonight, 7 PM", at: tonight });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ label: "Tomorrow, 9 AM", at: tomorrow });
  if (task.dueAt && task.dueStatus !== "unclear") {
    const before = new Date(task.dueAt);
    before.setDate(before.getDate() - 1);
    if (!task.dueAllDay) before.setHours(Math.min(new Date(task.dueAt).getHours(), 18));
    else before.setHours(9, 0, 0, 0);
    if (before > now) out.push({ label: "The day before it's due", at: before });
  }
  return out;
}

function ReminderPanel({ task }: { task: Task }) {
  const reminders = task.actions.filter((a) => a.kind === "reminder") as Extract<Action, { kind: "reminder" }>[];
  const { call } = useActionCalls(task);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const presets = useMemo(() => reminderPresets(task), [task]);

  const set = async (at: Date) => {
    if (isPast(at)) {
      toast.error("Pick a time in the future.");
      return;
    }
    setBusy(true);
    const t = await call(`/api/tasks/${task.id}/reminder`, { remindAt: at.toISOString(), note: note.trim() || null });
    setBusy(false);
    if (t) {
      toast.success(`Reminder set for ${formatDue(at.toISOString(), false)}`);
      setNote("");
      setCustom("");
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    }
  };

  return (
    <div className="space-y-5">
      <NotSentBanner>
        Reminders show up in LooseEnds when they're due, and as a browser notification if you allow it while LooseEnds is open. For a phone alert, prepare a calendar event instead.
      </NotSentBanner>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <button
            key={p.label}
            disabled={busy}
            onClick={() => void set(p.at)}
            className="flex h-14 flex-col items-start justify-center rounded-lg border border-line-strong bg-surface px-4 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
          >
            <span className="text-[14px] font-medium text-ink">{p.label}</span>
            <span className="text-[12px] text-muted">{formatDue(p.at.toISOString(), false)}</span>
          </button>
        ))}
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const iso = fromLocalInput(custom);
          if (iso) void set(new Date(iso));
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="rm-at">Or pick a time</Label>
          <div className="flex gap-2">
            <Input id="rm-at" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!custom} loading={busy}>
              Set
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rm-note">Note</Label>
          <Input id="rm-note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
      {reminders.length ? (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink-2">Scheduled</p>
          <ul className="space-y-2">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg bg-surface px-3.5 py-2.5">
                <BellSimple size={16} className={r.payload.firedAt ? "text-muted" : "text-accent"} />
                <div className="min-w-0 flex-1 text-[13.5px]">
                  <p className="font-medium">{formatDue(r.payload.remindAt, false)}</p>
                  {r.payload.note ? <p className="truncate text-muted">{r.payload.note}</p> : null}
                </div>
                {r.payload.firedAt ? <Chip>Shown</Chip> : null}
                <button
                  aria-label="Delete reminder"
                  onClick={() => void call(`/api/actions/${r.id}`, undefined, "DELETE")}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
                >
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Source ------------------------------ */

function SourcePanel({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const { refresh } = useStore();
  const [source, setSource] = useState<Source | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    api<Source>(`/api/sources/${task.sourceId}`)
      .then((s) => live && setSource(s))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Couldn't load the source."));
    return () => {
      live = false;
    };
  }, [task.sourceId]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [source]);

  if (err) return <p className="text-[14px] text-danger">{err}</p>;
  if (!source)
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className={cx("h-4", i % 2 ? "w-10/12" : "w-full")} />
        ))}
      </div>
    );

  const { start, end } = task.evidence ?? { start: null, end: null };
  const hasRange = start !== null && end !== null && end > start && end <= source.content.length;

  const del = async () => {
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      toast.success("Source and its tasks deleted");
      onDeleted();
      void refresh();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 text-[13px] text-muted">
        {source.kind === "text" ? <EnvelopeSimple size={16} /> : <FileText size={16} />}
        <span className="font-medium text-ink-2">{sourceLabel(source)}</span>
        <span>· {timeAgo(source.createdAt)}</span>
      </div>
      {source.injectionDetected ? (
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <ShieldWarning size={16} className="mt-0.5 shrink-0 text-warn" />
          This message contained instructions aimed at an AI assistant. LooseEnds treated them as plain text and ignored them.
        </p>
      ) : null}
      {source.kind === "image" ? (
        <p className="text-[12.5px] text-muted">Text read from your screenshot. The image itself isn't stored.</p>
      ) : null}
      <div className="max-h-[46dvh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3.5 text-[14px] leading-relaxed text-ink-2">
        {hasRange ? (
          <>
            {source.content.slice(0, start!)}
            <mark ref={markRef} className="evidence">
              {source.content.slice(start!, end!)}
            </mark>
            {source.content.slice(end!)}
          </>
        ) : (
          source.content
        )}
      </div>
      {!hasRange && task.evidence?.quote ? (
        <p className="text-[12.5px] text-muted">LooseEnds couldn't pin the exact sentence, so double-check this task against the message.</p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px]">
          <span className="flex-1 text-ink-2">Delete this source and every task found in it?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={() => void del()}>
            Delete
          </Button>
        </div>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          <Trash size={15} /> Delete source
        </Button>
      )}
    </div>
  );
}
