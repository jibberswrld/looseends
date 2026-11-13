"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDots,
  ChatCircleDots,
  Check,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  Lightning,
  Paperclip,
  PencilSimpleLine,
  Plugs,
  Tray,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Task, Toolkit } from "@/lib/types";
import { Button, cx, Spinner } from "../ui";
import { dayDiff, isOverdue, timeAgo } from "./dates";
import { useStore } from "./store";
import { useWork, type WorkLine } from "./work";

const EXAMPLE = `From: Riverside Dental <frontdesk@riversidedental.com>
Subject: Please confirm your cleaning

Hi Maya,

Please confirm your appointment for Thursday by 3 p.m. and complete the intake form before your visit. You can reply to this email to confirm.

Thanks,
Riverside Dental front desk`;

/* ------------------------------ Briefing ------------------------------ */

export function Briefing({ tasks, greeting, handle }: { tasks: Task[]; greeting: string; handle: string | null }) {
  const now = new Date();
  const live = tasks.filter((t) => !t.isPromotional && !(t.snoozedUntil && new Date(t.snoozedUntil) > now));
  const needs = live.filter((t) => t.status === "detected" || t.dueStatus === "needs_review" || t.duplicateOf).length;
  const overdue = live.filter((t) => t.dueAt && t.dueStatus !== "unclear" && isOverdue(t.dueAt, t.dueAllDay, now)).length;
  const week = live.filter((t) => t.dueAt && t.dueStatus !== "unclear" && dayDiff(t.dueAt, now) >= 0 && dayDiff(t.dueAt, now) <= 7).length;
  const drafts = live.filter((t) => t.actions.some((a) => a.kind === "reply" && a.status === "prepared")).length;
  const stats: [string, number, string?][] = [
    ["Need a look", needs, needs ? "text-warn" : undefined],
    ["Overdue", overdue, overdue ? "text-danger" : undefined],
    ["Due this week", week],
    ["Drafts ready", drafts, drafts ? "text-accent-text" : undefined],
  ];
  return (
    <header>
      <h1 className="text-[26px] font-[560] leading-tight tracking-[-0.03em]">
        {greeting}
        {handle ? <span className="text-muted">, {handle}</span> : null}
      </h1>
      <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-4">
        {stats.map(([label, n, tone], i) => (
          <div key={label} className={cx("px-4 py-3.5", i > 0 && "sm:border-l sm:border-line", i >= 2 && "border-t border-line sm:border-t-0", i === 1 && "border-l border-line")}>
            <dt className="text-[12.5px] text-muted">{label}</dt>
            <dd className={cx("mt-0.5 text-[26px] font-[520] leading-none tracking-[-0.03em] tabular-nums", tone ?? (n ? "text-ink" : "text-muted"))}>{n}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/* ------------------------------ Composer ------------------------------ */

type Mode = "add" | "ask";

export function Composer() {
  const w = useWork();
  const [mode, setMode] = useState<Mode>("add");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(220, Math.max(52, el.scrollHeight)) + "px";
  }, [text]);

  const attach = (f: File) => {
    if (f.type === "application/pdf" || f.type.startsWith("image/")) {
      setFile(f);
      setMode("add");
    }
  };
  const canSend = !w.running && (mode === "ask" ? text.trim().length > 1 : !!file || text.trim().length > 0);
  const send = () => {
    if (!canSend) return;
    const t = text.trim();
    if (mode === "ask") void w.ask(t);
    else void w.capture({ text: t, file: file ?? undefined, label: file ? `Read ${file.name}` : t.split("\n").find((l) => l.trim())!.slice(0, 80) });
    setText("");
    setFile(null);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) attach(f);
      }}
      className={cx(
        "rounded-xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-150 focus-within:border-accent-text/60",
        drag ? "border-accent-text ring-4 ring-accent-soft" : "border-line-strong",
      )}
    >
      <label htmlFor="composer" className="sr-only">
        {mode === "ask" ? "Ask about your list" : "Paste a message, email or note"}
      </label>
      <textarea
        id="composer"
        ref={ta}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const f = Array.from(e.clipboardData.files)[0];
          if (f) {
            e.preventDefault();
            attach(f);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && (mode === "ask" || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={mode === "ask" ? "What's due this week? What should I do first?" : "Paste an email, a text, anything with something to do in it…"}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted"
      />
      {file ? (
        <div className="mx-3 mb-2 inline-flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3 text-[13px]">
          <Paperclip size={14} className="text-accent-text" />
          <span className="max-w-[28ch] truncate">{file.name}</span>
          <button aria-label="Remove file" onClick={() => setFile(null)} className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink">
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
        <div role="tablist" aria-label="What to do with this" className="inline-flex rounded-lg bg-surface-2 p-0.5">
          {(
            [
              ["add", "Find tasks", Tray],
              ["ask", "Ask", ChatCircleDots],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-150",
                mode === m ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        {mode === "add" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) attach(f);
                e.target.value = "";
              }}
            />
            <button onClick={() => fileRef.current?.click()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">
              <Paperclip size={14} />
              <span className="hidden sm:inline">Screenshot or PDF</span>
            </button>
          </>
        ) : null}
        <span className="ml-auto hidden text-[11.5px] text-muted sm:inline">{mode === "ask" ? "Enter" : "⌘ Enter"}</span>
        <button
          onClick={send}
          disabled={!canSend}
          aria-label={mode === "ask" ? "Ask" : "Find tasks"}
          className="inline-flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink transition-[background-color,transform,opacity] duration-150 hover:bg-accent-hover active:scale-[0.96] disabled:opacity-35"
        >
          {w.running ? <Spinner /> : <ArrowUp size={16} weight="bold" />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Starters ------------------------------ */

export function Starters({ onExample }: { onExample?: () => void }) {
  const w = useWork();
  const { open } = useStore();
  const gmail = w.connections?.gmail.connected;
  const waiting = (open ?? []).filter((t) => t.nextStepType === "reply" && !t.isPromotional && !t.actions.some((a) => a.kind === "reply")).length;
  const items = [
    {
      lead: true,
      icon: EnvelopeSimpleOpen,
      title: gmail ? "Check my inbox" : "Connect Gmail",
      body: gmail ? "Read this week's mail and pull out what needs you." : "Let LooseEnds read your inbox and find what needs you.",
      run: () => (gmail ? w.scanInbox() : w.connect("gmail")),
      off: !!w.running || !!w.linking || (!gmail && w.connections?.available === false),
    },
    { icon: PencilSimpleLine, title: "Draft my replies", body: waiting ? `${waiting} waiting for a draft.` : "Write replies for you to review.", run: () => w.draftReplies(), off: !!w.running },
    { icon: CalendarDots, title: "What's due this week?", body: "A quick answer from your list.", run: () => w.ask("What's due this week, and what should I do first?"), off: !!w.running },
    { icon: Lightning, title: "Try an example", body: "See it work on a sample email.", run: () => (onExample ? onExample() : w.capture({ text: EXAMPLE, label: "Try the dentist example" })), off: !!w.running },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
      {items.map((it) => (
        <button
          key={it.title}
          onClick={() => void it.run()}
          disabled={it.off}
          className={cx(
            "group flex min-h-[92px] flex-col items-start rounded-xl border p-3.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.985] disabled:opacity-50",
            it.lead ? "col-span-2 border-accent-text/30 bg-accent-soft hover:border-accent-text/60 lg:col-span-1" : "border-line bg-surface hover:border-line-strong",
          )}
        >
          <it.icon size={18} className={it.lead ? "text-accent-text" : "text-muted group-hover:text-ink"} />
          <span className="mt-auto pt-3 text-[13.5px] font-[560] text-ink">{it.title}</span>
          <span className="text-[12.5px] leading-snug text-muted">{it.body}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Work stream (the signature) ------------------------------ */

const GLYPH: Record<WorkLine["kind"], string> = { you: "›", step: "·", found: "+", skip: "−", done: "✓", error: "!", answer: "" };

export function WorkStream({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { lines, running, clear } = useWork();
  const reduce = useReducedMotion();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [lines.length, reduce]);

  if (!lines.length && !running) return null;
  return (
    <section aria-label="What LooseEnds is doing" aria-live="polite" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex h-9 items-center gap-2 border-b border-line px-3.5">
        <span className={cx("size-1.5 rounded-full", running ? "animate-pulse bg-accent-text" : "bg-muted/50")} aria-hidden />
        <span className="font-mono text-[11.5px] text-ink-2">{running ?? "Finished"}</span>
        {!running ? (
          <button onClick={clear} className="ml-auto text-[12px] text-muted hover:text-ink">
            Clear
          </button>
        ) : null}
      </div>
      <div className={cx("h-px", running && "sweep")} aria-hidden />
      <ol className="max-h-[300px] space-y-0.5 overflow-y-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">
        <AnimatePresence initial={false}>
          {lines.map((l, i) => {
            const last = i === lines.length - 1;
            if (l.kind === "answer")
              return (
                <motion.li key={l.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="my-2 list-none rounded-lg bg-surface-2 px-3.5 py-3 font-sans text-[14.5px] leading-relaxed text-ink">
                  {l.text}
                  {l.taskIds?.length ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {l.taskIds.map((id) => (
                        <TaskRef key={id} id={id} onOpen={onOpenTask} />
                      ))}
                    </span>
                  ) : null}
                </motion.li>
              );
            return (
              <motion.li
                key={l.id}
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className={cx("flex list-none gap-2.5", l.kind === "you" && "mt-2 first:mt-0")}
              >
                <span
                  aria-hidden
                  className={cx(
                    "w-3 shrink-0 text-center",
                    l.kind === "found" || l.kind === "done" ? "text-accent-text" : l.kind === "error" ? "text-danger" : "text-muted",
                  )}
                >
                  {GLYPH[l.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  {l.kind === "found" && l.taskIds?.length === 1 ? (
                    <button onClick={() => onOpenTask(l.taskIds![0])} className="text-left text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-accent-text">
                      {l.text}
                    </button>
                  ) : (
                    <span
                      className={cx(
                        l.kind === "you" ? "text-ink" : l.kind === "skip" ? "text-muted" : l.kind === "error" ? "text-danger" : l.kind === "step" ? "text-ink-2" : "text-ink",
                        last && running && l.kind === "step" && "caret",
                      )}
                    >
                      {l.text}
                    </span>
                  )}
                  {l.sub ? <span className="block truncate text-[11.5px] text-muted">{l.sub}</span> : null}
                  {l.topUpUrl ? (
                    <a href={l.topUpUrl} target="_blank" rel="noopener" className="mt-1 inline-block font-sans text-[13px] font-medium text-accent-text underline underline-offset-2">
                      Add credit
                    </a>
                  ) : null}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
        <div ref={end} />
      </ol>
    </section>
  );
}

function TaskRef({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { open } = useStore();
  const t = open?.find((x) => x.id === id);
  if (!t) return null;
  return (
    <button onClick={() => onOpen(id)} className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2 text-[12.5px] font-medium text-ink hover:border-accent-text/60">
      {t.title}
    </button>
  );
}

/* ------------------------------ Right rail ------------------------------ */

function ConnectionRow({ toolkit, name, icon: Icon, hint }: { toolkit: Toolkit; name: string; icon: typeof EnvelopeSimple; hint: string }) {
  const w = useWork();
  const c = w.connections;
  const connected = !!c?.[toolkit].connected;
  const busy = w.linking === toolkit;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", connected ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-muted")}>
        <Icon size={16} weight={connected ? "fill" : "regular"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{name}</span>
        <span className="block truncate text-[12px] text-muted">
          {connected ? (toolkit === "gmail" ? (c?.gmail.lastScanAt ? `Checked ${timeAgo(c.gmail.lastScanAt)}` : "Connected. Not checked yet.") : "Connected") : hint}
        </span>
      </span>
      {connected ? (
        toolkit === "gmail" ? (
          <Button size="sm" variant="secondary" onClick={() => void w.scanInbox()} disabled={!!w.running}>
            Check
          </Button>
        ) : (
          <Check size={16} weight="bold" className="mr-1 text-accent-text" aria-label="Connected" />
        )
      ) : (
        <Button size="sm" variant="secondary" onClick={() => void w.connect(toolkit)} loading={busy} disabled={!c || c.available === false || !!w.linking}>
          Connect
        </Button>
      )}
    </li>
  );
}

function RailCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex h-10 items-center justify-between border-b border-line px-4">
        <h2 className="text-[12.5px] font-[560] text-ink-2">{title}</h2>
        {right}
      </div>
      <div className="px-4 py-1.5">{children}</div>
    </section>
  );
}

export function Rail({ tasks, history, onOpenTask }: { tasks: Task[]; history: Task[] | null; onOpenTask: (id: string) => void }) {
  const w = useWork();
  const now = useMemo(() => new Date(), []);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const due = tasks.filter((t) => !t.isPromotional && t.dueAt && t.dueStatus !== "unclear" && dayDiff(t.dueAt, now) === i);
      return { d, due };
    });
  }, [tasks, now]);
  const [day, setDay] = useState(0);

  const activity = useMemo(() => {
    const items: { at: string; text: string; id: string; icon: typeof Check }[] = [];
    for (const t of [...tasks, ...(history ?? [])]) {
      if (t.status === "completed" && t.completedAt) items.push({ at: t.completedAt, text: `Done: ${t.title}`, id: t.id, icon: Check });
      for (const a of t.actions) for (const r of a.receipts) items.push({ at: r.at, text: `${r.what}: ${t.title}`, id: t.id, icon: a.kind === "event" ? CalendarDots : EnvelopeSimple });
      items.push({ at: t.createdAt, text: `Found: ${t.title}`, id: t.id, icon: Tray });
    }
    const seen = new Set<string>();
    return items
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .filter((x) => (seen.has(x.at + x.text) ? false : (seen.add(x.at + x.text), true)))
      .slice(0, 7);
  }, [tasks, history]);

  return (
    <aside className="space-y-3">
      <RailCard title="Connections" right={<Plugs size={14} className="text-muted" />}>
        <ul className="divide-y divide-line">
          <ConnectionRow toolkit="gmail" name="Gmail" icon={EnvelopeSimple} hint="Find tasks in your inbox" />
          <ConnectionRow toolkit="googlecalendar" name="Google Calendar" icon={CalendarDots} hint="Add events in one tap" />
        </ul>
        {w.connections && !w.connections.available ? (
          <p className="flex items-start gap-1.5 border-t border-line py-2.5 text-[12px] leading-snug text-muted">
            <WarningCircle size={14} className="mt-px shrink-0 text-warn" />
            {w.connections.message ?? "Connections aren't available right now."}
          </p>
        ) : null}
      </RailCard>

      <RailCard title="This week">
        <div className="grid grid-cols-7 gap-1 py-2">
          {days.map(({ d, due }, i) => (
            <button
              key={i}
              onClick={() => setDay(i)}
              aria-pressed={day === i}
              className={cx("flex flex-col items-center rounded-lg py-1.5 transition-colors duration-150", day === i ? "bg-surface-2" : "hover:bg-surface-2/60")}
            >
              <span className="text-[10.5px] text-muted">{d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
              <span className={cx("text-[13.5px] font-medium tabular-nums", i === 0 && "text-accent-text")}>{d.getDate()}</span>
              <span className={cx("mt-1 h-1 rounded-full", due.length ? "w-3 bg-accent-text" : "w-1 bg-line-strong")} aria-hidden />
            </button>
          ))}
        </div>
        <ul className="border-t border-line py-2 text-[13px]">
          {days[day].due.length ? (
            days[day].due.map((t) => (
              <li key={t.id}>
                <button onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:text-accent-text">
                  <span className="size-1 shrink-0 rounded-full bg-accent-text" aria-hidden />
                  <span className="truncate">{t.title}</span>
                  {!t.dueAllDay && t.dueAt ? <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">{new Date(t.dueAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="py-1 text-muted">Nothing due {day === 0 ? "today" : days[day].d.toLocaleDateString(undefined, { weekday: "long" })}.</li>
          )}
        </ul>
      </RailCard>

      <RailCard title="Activity">
        {activity.length ? (
          <ol className="py-1.5">
            {activity.map((a, i) => (
              <li key={i}>
                <button onClick={() => onOpenTask(a.id)} className="flex w-full items-start gap-2.5 py-1.5 text-left text-[13px] hover:text-accent-text">
                  <a.icon size={14} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{a.text}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{timeAgo(a.at)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-3 text-[13px] text-muted">What LooseEnds finds and what you finish shows up here.</p>
        )}
      </RailCard>
    </aside>
  );
}
