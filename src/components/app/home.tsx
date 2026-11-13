"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  BellSimple,
  Broom,
  CalendarBlank,
  CalendarPlus,
  CaretDown,
  Check,
  CheckCircle,
  EnvelopeSimple,
  MinusCircle,
  PaperPlaneTilt,
  Paperclip,
  PencilSimpleLine,
  PlusCircle,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { Button, cx, Spinner } from "../ui";
import { api } from "./api";
import { useAgent } from "./agent";
import { Thread } from "./agent-ui";
import { Avatar, CalendarLogo, GmailLogo, sourceLabel } from "./bits";
import { timeAgo } from "./dates";
import { reportError, useStore } from "./store";
import { DueChip } from "./task-bits";
import { TaskMenu, useTaskCommands, type Panel } from "./task-card";
import { useWork, type WorkLine } from "./work";

const EXAMPLE = `From: Riverside Dental <frontdesk@riversidedental.com>
Subject: Please confirm your cleaning

Hi Maya,

Please confirm your appointment for Thursday by 3 p.m. and complete the intake form before your visit. You can reply to this email to confirm.

Thanks,
Riverside Dental front desk`;

/* ------------------------------ Composer: the agent ------------------------------ */

export function Composer({ hasTasks, onOpenTask }: { hasTasks: boolean; onOpenTask: (id: string) => void }) {
  const w = useWork();
  const agent = useAgent();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const talking = agent.messages.length > 0 || !!agent.notice;

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(240, Math.max(talking ? 48 : 64, el.scrollHeight)) + "px";
  }, [text, talking]);

  const attach = (f: File) => {
    if (f.type === "application/pdf" || f.type.startsWith("image/")) setFile(f);
  };
  // A file still goes through capture (it finds the to-dos in it); anything typed goes to the agent.
  const canSend = file ? !w.running : !agent.busy && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const t = text.trim();
    if (file) void w.capture({ text: t, file, label: `Read ${file.name}` });
    else void agent.send(t);
    setText("");
    setFile(null);
  };

  return (
    <div>
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
          "relative z-10 overflow-hidden rounded-[18px] border bg-surface shadow-float transition-[border-color,box-shadow] duration-150",
          drag ? "border-accent-text ring-4 ring-accent-soft" : "border-line-strong has-[#composer:focus]:border-ink/25 has-[#composer:focus]:ring-4 has-[#composer:focus]:ring-ink/[0.04]",
        )}
      >
        {talking ? <Thread onOpenTask={onOpenTask} /> : null}
        <label htmlFor="composer" className="sr-only">
          Ask about your inbox, or tell me what to do
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={file ? "Add a note about this file (optional)" : talking ? "Reply, or ask for something else" : "Ask about your inbox, or tell me what to do"}
          className="block w-full resize-none bg-transparent px-5 pt-4 text-[15.5px] leading-relaxed text-ink outline-none placeholder:text-muted"
        />
        {file ? (
          <div className="mx-4 mb-2 inline-flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3 text-[13px]">
            <Paperclip size={14} />
            <span className="max-w-[28ch] truncate">{file.name}</span>
            <span className="text-muted">· finds the to-dos in it</span>
            <button aria-label="Remove file" onClick={() => setFile(null)} className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink">
              <X size={13} />
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 px-3 pb-3">
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
          <button onClick={() => fileRef.current?.click()} aria-label="Attach a screenshot or PDF" title="Attach a screenshot or PDF" className="inline-flex size-8 items-center justify-center rounded-full border border-line-strong text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink">
            <Paperclip size={15} />
          </button>
          <span className="ml-auto hidden text-[12px] text-muted sm:inline">Shift Enter for a new line</span>
          <button
            onClick={send}
            disabled={!canSend}
            aria-label={file ? "Find to-dos in this file" : "Send"}
            className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-accent-ink transition-[background-color,transform,opacity] duration-150 hover:bg-accent-hover active:scale-[0.96] disabled:opacity-25"
          >
            {agent.busy || (file && w.running) ? <Spinner /> : <ArrowUp size={17} weight="bold" />}
          </button>
        </div>
      </div>
      <ConnectStrip />
      {talking ? null : <Chips hasTasks={hasTasks} />}
    </div>
  );
}

/** Tucked under the composer: the one account that makes this useful, and its state. */
function ConnectStrip() {
  const w = useWork();
  const c = w.connections;
  if (!c) return <div className="mx-3 h-11 rounded-b-2xl border border-t-0 border-line bg-surface-2/60" aria-hidden />;
  const gmail = c.gmail.connected;
  let text: ReactNode;
  let action: ReactNode = null;
  if (gmail) {
    text = (
      <>
        <span className="font-medium text-ink">Gmail is connected.</span> {c.gmail.lastScanAt ? `Last checked ${timeAgo(c.gmail.lastScanAt)}.` : "Not checked yet."}
      </>
    );
    action = (
      <Button size="sm" variant="primary" onClick={() => void w.scanInbox()} disabled={!!w.running} className="rounded-full">
        Check my inbox
      </Button>
    );
  } else if (w.linking === "gmail") {
    text = "Approve Gmail in the tab that just opened. This updates on its own.";
    action = <Spinner className="mr-2 text-muted" />;
  } else if (!c.available) {
    text = c.message ?? "Gmail can't be connected right now. You can still paste messages above.";
  } else {
    text = (
      <>
        <span className="font-medium text-ink">Connect Gmail</span> and I&apos;ll read your inbox for you.
      </>
    );
    action = (
      <Button size="sm" variant="primary" onClick={() => void w.connect("gmail")} disabled={!!w.linking} className="rounded-full">
        Connect Gmail
      </Button>
    );
  }
  return (
    <div className="mx-3 flex min-h-11 items-center gap-2.5 rounded-b-2xl border border-t-0 border-line bg-surface-2/60 py-1.5 pr-1.5 pl-4 text-[13px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <GmailLogo size={15} />
        <CalendarLogo size={14} />
      </span>
      <span className="min-w-0 flex-1 leading-snug">{text}</span>
      {action}
    </div>
  );
}

function Chips({ hasTasks }: { hasTasks: boolean }) {
  const w = useWork();
  const agent = useAgent();
  const ask = (q: string) => () => void agent.send(q);
  const chips: { icon: ReactNode; label: string; run: () => void }[] = [
    { icon: <EnvelopeSimple size={14} />, label: "What needs a reply?", run: ask("What needs a reply?") },
    { icon: <Broom size={14} />, label: "Clear out my inbox", run: ask("Clear out my inbox") },
    { icon: <CalendarBlank size={14} />, label: "What's on my calendar this week?", run: ask("What's on my calendar this week?") },
  ];
  if (!hasTasks) chips.push({ icon: <Sparkle size={14} />, label: "Try a sample email", run: () => void w.capture({ text: EXAMPLE, label: "Try a sample email" }) });
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {chips.map((c) => (
        <button
          key={c.label}
          onClick={c.run}
          disabled={agent.busy || !!w.running}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-ink active:scale-[0.98] disabled:opacity-50"
        >
          {c.icon}
          {c.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Live: what LooseEnds is doing ------------------------------ */

export function Live({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { lines, running, clear } = useWork();
  const reduce = useReducedMotion();
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [lines.length, reduce]);


  if (!lines.length && !running) return null;
  const lastYou = lines.map((l) => l.kind).lastIndexOf("you");
  const current = lines.slice(Math.max(0, lastYou));
  const scan = current[0]?.text === "Check my inbox";
  const read = scan ? current.filter((l) => l.kind === "found" || l.kind === "skip").length : 0;
  const found = current.filter((l) => l.kind === "found").length;

  return (
    <section aria-label="What LooseEnds is doing" aria-live="polite" className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <div className="flex h-11 items-center gap-2.5 px-4">
        {running ? <Spinner className="text-accent-text" /> : <CheckCircle size={17} weight="fill" className="text-ok" />}
        <span className="text-[14px] font-[560]">{running ?? "Done"}</span>
        {read ? (
          <span className="text-[13px] tabular-nums text-muted">
            {read} read · {found} with something to do
          </span>
        ) : null}
        {!running ? (
          <button onClick={clear} className="ml-auto rounded-md px-1.5 py-0.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">
            Hide
          </button>
        ) : null}
      </div>
      <div className={cx("h-0.5 bg-line", running && "sweep")} aria-hidden />
      <ol ref={box} className="max-h-[300px] space-y-2.5 overflow-y-auto px-4 py-3.5">
        <AnimatePresence initial={false}>
          {current.map((l) => (
            <motion.li key={l.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="list-none">
              <Line l={l} onOpenTask={onOpenTask} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function Line({ l, onOpenTask }: { l: WorkLine; onOpenTask: (id: string) => void }) {
  if (l.kind === "you")
    return (
      <div className="flex justify-end">
        <span className="max-w-[85%] truncate rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-1.5 text-[14px] text-ink">{l.text}</span>
      </div>
    );
  const icon =
    l.kind === "found" ? (
      <PlusCircle size={17} weight="fill" className="text-ok" />
    ) : l.kind === "skip" ? (
      <MinusCircle size={17} className="text-muted/70" />
    ) : l.kind === "done" ? (
      <CheckCircle size={17} weight="fill" className="text-ok" />
    ) : l.kind === "error" ? (
      <WarningCircle size={17} weight="fill" className="text-danger" />
    ) : (
      <span className="mx-[6px] mt-[7px] block size-[5px] rounded-full bg-muted/60" />
    );
  return (
    <div className="flex items-start gap-2.5 text-[14px] leading-snug">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        {l.kind === "found" && l.taskIds?.length === 1 ? (
          <button onClick={() => onOpenTask(l.taskIds![0])} className="text-left font-medium text-ink hover:underline hover:underline-offset-[3px]">
            {l.text}
          </button>
        ) : (
          <span className={cx(l.kind === "skip" || l.kind === "step" ? "text-ink-2" : l.kind === "error" ? "text-danger" : "font-medium text-ink")}>{l.text}</span>
        )}
        {l.sub ? <span className="block truncate text-[12.5px] text-muted">{l.sub}</span> : null}
        {l.topUpUrl ? (
          <a href={l.topUpUrl} target="_blank" rel="noopener" className="mt-1 inline-block text-[13px] font-medium text-accent-text underline underline-offset-2">
            Add credit
          </a>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------ The list: one open at a time ------------------------------ */

export function Item({ task, expanded, onToggle, onOpen }: { task: Task; expanded: boolean; onToggle: () => void; onOpen: (p: Panel) => void }) {
  const reduce = useReducedMotion();
  const cmd = useTaskCommands();
  const { upsert } = useStore();
  const w = useWork();
  const [drafting, setDrafting] = useState(false);
  const who = sourceLabel(task.source) ?? "Added by you";
  const reply = task.actions.find((a) => a.kind === "reply");
  const draftBody = reply?.kind === "reply" ? reply.payload.body : null;
  const sent = !!reply?.receipts.some((r) => r.what === "Sent with Gmail");
  const hasEvent = task.actions.some((a) => a.kind === "event");
  const dupTitle = cmd.duplicateTitle(task);
  const isNew = task.status === "detected";

  const draft = async () => {
    setDrafting(true);
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${task.id}/draft`, { method: "POST", json: {} });
      upsert(r.task);
    } catch (e) {
      reportError(e, "Couldn't write that draft.");
    } finally {
      setDrafting(false);
    }
  };

  let primary: ReactNode;
  if (sent)
    primary = (
      <Button variant="primary" onClick={() => void cmd.complete(task)}>
        <Check size={16} weight="bold" /> Mark done
      </Button>
    );
  else if (task.nextStepType === "reply")
    primary = draftBody ? (
      <Button variant="primary" onClick={() => onOpen("reply")}>
        <PaperPlaneTilt size={16} weight="fill" /> {w.connections?.gmail.connected ? "Review and send" : "Review reply"}
      </Button>
    ) : (
      <Button variant="primary" onClick={() => void draft()} loading={drafting}>
        {drafting ? "Writing…" : (<><PencilSimpleLine size={16} /> Draft a reply</>)}
      </Button>
    );
  else if (task.nextStepType === "event")
    primary = (
      <Button variant="primary" onClick={() => onOpen("event")}>
        <CalendarPlus size={16} /> {hasEvent ? "Open event" : "Add to calendar"}
      </Button>
    );
  else
    primary = (
      <Button variant="primary" onClick={() => onOpen("reminder")}>
        <BellSimple size={16} /> Remind me
      </Button>
    );

  return (
    <motion.li
      id={`t-${task.id}`}
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 20, transition: { duration: 0.18 } }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className={cx("list-none rounded-[14px] border transition-[background-color,border-color,box-shadow] duration-150", expanded ? "border-line-strong bg-surface shadow-card" : "border-transparent hover:bg-ink/[0.035]")}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <button
          onClick={() => void cmd.complete(task)}
          aria-label={`Mark "${task.title}" done`}
          className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-strong text-transparent transition-colors duration-150 hover:border-ok hover:bg-ok-soft hover:text-ok active:scale-90"
        >
          <Check size={12} weight="bold" />
        </button>
        <button onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar name={who} size={30} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cx("truncate text-[15px] tracking-[-0.005em] text-ink", expanded ? "font-semibold" : "font-[560]")}>{task.title}</span>
              {isNew ? <span className="size-1.5 shrink-0 rounded-full bg-accent-text" title="New" aria-label="New" /> : null}
            </span>
            <span className="block truncate text-[13px] text-muted">
              {who}
              {!expanded && draftBody ? (sent ? " · Reply sent" : " · Draft ready") : ""}
            </span>
          </span>
          <DueChip task={task} />
          <CaretDown size={14} className={cx("shrink-0 text-muted transition-transform duration-150", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded ? (
        <div className="pr-4 pb-4 pl-[50px] sm:pl-[92px]">
          <p className="text-[14.5px] leading-relaxed text-ink-2">{task.nextStep}</p>

          {task.evidence?.quote ? (
            <button onClick={() => onOpen("source")} title="Open the original message" className="mt-3 block w-full border-l-2 border-line-strong py-0.5 pl-3 text-left text-[13.5px] leading-relaxed text-muted transition-colors duration-150 hover:border-ink/40 hover:text-ink-2">
              <span className="line-clamp-3">“{task.evidence.quote}”</span>
            </button>
          ) : null}

          {task.dueStatus === "needs_review" || task.dueStatus === "unclear" ? (
            <p className="mt-3 flex items-start gap-1.5 text-[13px] text-warn">
              <WarningCircle size={15} className="mt-px shrink-0" />
              <span>
                {task.dueNote ?? "Check the date on this one."}{" "}
                <button onClick={() => onOpen("details")} className="font-medium underline underline-offset-2">
                  Set the date
                </button>
              </span>
            </p>
          ) : null}

          {dupTitle ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
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

          {draftBody ? (
            <button onClick={() => onOpen("reply")} className="mt-3.5 block w-full rounded-xl border border-line bg-bg px-4 py-3 text-left transition-colors duration-150 hover:border-line-strong">
              <span className={cx("flex items-center gap-1.5 text-[12px] font-medium", sent ? "text-ok" : "text-accent-text")}>
                <EnvelopeSimple size={13} weight="fill" /> {sent ? "Sent with Gmail" : "Draft reply · not sent yet"}
              </span>
              <span className="mt-1.5 line-clamp-4 block whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{draftBody.replace(/\n{2,}/g, "\n")}</span>
            </button>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {primary}
            {!sent ? (
              <Button variant="secondary" onClick={() => void cmd.complete(task)}>
                <Check size={16} /> Done
              </Button>
            ) : null}
            {isNew ? (
              <Button variant="ghost" onClick={() => void cmd.dismiss(task)}>
                Not a to-do
              </Button>
            ) : null}
            <div className="ml-auto">
              <TaskMenu task={task} onOpen={onOpen} />
            </div>
          </div>
        </div>
      ) : null}
    </motion.li>
  );
}
