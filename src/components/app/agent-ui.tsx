"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, CaretDown, Check, CheckCircle, NotePencil, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import type { AgentAction, AgentMessage, AgentToolStep } from "@/lib/types";
import { Button, cx, Spinner } from "../ui";
import { useAgent } from "./agent";
import { AppLogo } from "./bits";
import { useStore } from "./store";
import { findApp, useWork } from "./work";

const ease = [0.16, 1, 0.3, 1] as const;

/* ------------------------------ The conversation ------------------------------ */

/** The conversation, inside the composer card. Scrolls on its own so the page under it stays put. */
export function Thread({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { messages, busy, liveId, notice, reset } = useAgent();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const reduce = useReducedMotion();

  const last = messages.at(-1);
  const live = liveId ? messages.find((m) => m.id === liveId) : null;
  const waiting = busy && (!last || last.role === "user" || (!!live && !live.text && !live.steps.length));

  // Stay pinned to the newest line while content streams in, unless the reader scrolled up.
  useEffect(() => {
    const el = box.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const pin = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    pin();
    const ro = new ResizeObserver(pin);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="border-b border-line">
      <div className="flex h-10 items-center justify-between pr-2 pl-5">
        <span className="text-[12.5px] font-medium text-muted">Assistant</span>
        <button
          onClick={() => void reset()}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-ink/[0.045] hover:text-ink disabled:opacity-40"
        >
          <NotePencil size={14} /> New chat
        </button>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
        className="max-h-[min(56vh,620px)] overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_14px)]"
      >
        <div className="space-y-5 px-5 pt-1 pb-5">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div key={m.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease }}>
                {m.role === "user" ? <UserMessage m={m} /> : <AssistantMessage m={m} live={m.id === liveId} onOpenTask={onOpenTask} />}
              </motion.div>
            ))}
          </AnimatePresence>
          {waiting ? (
            <div className="flex items-center gap-2 text-[13.5px] text-muted">
              <Spinner className="text-accent-text" /> Working on it
            </div>
          ) : null}
          {notice ? (
            <p role="alert" className="flex items-start gap-2 text-[14px] leading-relaxed text-danger">
              <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {notice.message}
                {notice.topUpUrl ? (
                  <>
                    {" "}
                    <a href={notice.topUpUrl} target="_blank" rel="noopener" className="font-medium text-accent-text underline underline-offset-2">
                      Add credit
                    </a>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ m }: { m: AgentMessage }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        {m.text}
      </p>
    </div>
  );
}

function AssistantMessage({ m, live, onOpenTask }: { m: AgentMessage; live: boolean; onOpenTask: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {m.steps.length ? <Steps steps={m.steps} live={live} /> : null}
      {m.text ? <Prose text={m.text} live={live} /> : null}
      {m.actions.map((a) => (a.tool === "LOOSEENDS_CONNECT_APP" ? <ConnectCard key={a.id} action={a} /> : <ActionCard key={a.id} action={a} />))}
      {m.taskIds.length ? (
        <div className="flex flex-wrap gap-1.5">
          {m.taskIds.map((id) => (
            <TaskRef key={id} id={id} onOpen={onOpenTask} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What the agent looked at. Live while it works; one quiet line once it's done. */
function Steps({ steps, live }: { steps: AgentToolStep[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const working = live || steps.some((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "failed").length;
  if (!working && !open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex max-w-full items-center gap-1.5 text-left text-[13px] text-muted transition-colors duration-150 hover:text-ink-2"
      >
        {failed ? (
          <XCircle size={14} weight="fill" className="shrink-0 text-danger/80" />
        ) : (
          <CheckCircle size={14} weight="fill" className="shrink-0 text-ok/80" />
        )}
        <span className="truncate">
          {steps[0].label}
          {steps.length > 1 ? ` and ${steps.length - 1} more` : ""}
        </span>
        <CaretDown size={11} weight="bold" className="shrink-0" />
      </button>
    );
  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2 text-[13px] leading-snug">
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            {s.status === "running" ? (
              <Spinner className="size-3 text-accent-text" />
            ) : s.status === "done" ? (
              <Check size={13} weight="bold" className="text-ok" />
            ) : (
              <X size={13} weight="bold" className="text-danger" />
            )}
          </span>
          <span className={cx("min-w-0 truncate", s.status === "running" ? "text-ink" : s.status === "failed" ? "text-danger" : "text-muted")}>{s.label}</span>
        </li>
      ))}
      {!working ? (
        <li>
          <button onClick={() => setOpen(false)} className="ml-6 text-[12.5px] text-muted hover:text-ink">
            Hide
          </button>
        </li>
      ) : null}
    </ol>
  );
}

/** Markdown-lite: paragraphs, "- " bullets, **bold**. */
function Prose({ text, live }: { text: string; live: boolean }) {
  const blocks: ({ kind: "p"; lines: string[] } | { kind: "ul"; items: string[] })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const prev = blocks.at(-1);
    if (!line.trim()) blocks.push({ kind: "p", lines: [] });
    else if (bullet) {
      if (prev?.kind === "ul") prev.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (prev?.kind === "p") prev.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }
  const shown = blocks.filter((b) => (b.kind === "p" ? b.lines.length : b.items.length));
  const caret = <span className="caret" aria-hidden />;
  return (
    <div className="space-y-2.5 text-[15px] leading-[1.65] text-ink [overflow-wrap:anywhere]">
      {shown.map((b, i) => {
        const end = live && i === shown.length - 1;
        return b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                {inline(l)}
              </Fragment>
            ))}
            {end ? caret : null}
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted">
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">
                {inline(it)}
                {end && j === b.items.length - 1 ? caret : null}
              </li>
            ))}
          </ul>
        );
      })}
      {live && !shown.length ? caret : null}
    </div>
  );
}

/** **bold** and [text](https://…) links. Only http(s) links render; anything else stays as its text. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-[620]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (!link) return part;
    if (!/^https?:\/\//i.test(link[2])) return link[1];
    return (
      <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-colors duration-150 hover:decoration-ink">
        {link[1]}
      </a>
    );
  });
}

function TaskRef({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { open } = useStore();
  const t = open?.find((x) => x.id === id);
  if (!t) return null;
  return (
    <button
      onClick={() => onOpen(id)}
      className="inline-flex h-7 max-w-full items-center truncate rounded-full border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:bg-surface-2"
    >
      {t.title}
    </button>
  );
}

/* ------------------------------ Action cards ------------------------------ */

interface Field {
  key: string;
  label: string;
  value: string;
  long: boolean;
  /** "list" values were string arrays; "date" values are shown formatted and not edited inline. */
  kind: "text" | "list" | "date";
}

const LABELS: Record<string, string> = {
  to: "To",
  recipient: "To",
  recipient_email: "To",
  recipients: "To",
  to_email: "To",
  cc: "Cc",
  bcc: "Bcc",
  subject: "Subject",
  channel: "Channel",
  summary: "Title",
  title: "Title",
  start_datetime: "Starts",
  start_time: "Starts",
  start: "Starts",
  end_datetime: "Ends",
  end_time: "Ends",
  end: "Ends",
  location: "Where",
  attendees: "Guests",
};
const LONG = new Set(["body", "text", "message", "markdown_text", "content", "description", "notes", "comment", "message_body"]);
const HIDDEN = /(^|_)(id|ids|url|uri|token|key|type|format|timezone)$/i;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function fieldsOf(args: Record<string, unknown>): Field[] {
  const out: Field[] = [];
  for (const [key, v] of Object.entries(args)) {
    if (HIDDEN.test(key)) continue;
    const list = Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
    if (typeof v !== "string" && !list) continue;
    const value = list ? (v as string[]).join(", ") : (v as string);
    if (!value.trim()) continue;
    const label = LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, " ");
    const kind = list ? "list" : ISO.test(value) ? "date" : "text";
    out.push({ key, label, value, kind, long: kind === "text" && (LONG.has(key) || value.length > 90 || value.includes("\n")) });
  }
  // Short fields in the order a person reads them (To, Cc, Subject...), whatever order the model sent.
  const rank = (k: string) => (k in LABELS ? Object.keys(LABELS).indexOf(k) : Infinity);
  return [...out.filter((f) => !f.long).sort((a, b) => rank(a.key) - rank(b.key)), ...out.filter((f) => f.long)];
}

const STOP = new Set(["to", "in", "on", "for", "a", "an", "the", "with", "at", "from", "into", "about", "and", "as"]);
/** The button says what happens: "Send email to Dr. Patel" -> "Send email", "Post in #general" -> "Post". */
function verbOf(title: string): string {
  const [first, second, ...rest] = title.trim().split(/\s+/);
  if (!first) return "Approve";
  const two = second?.replace(/[:,.]$/, "");
  const verb = two && rest.length && /^[a-z]+$/.test(two) && !STOP.has(two) ? `${first} ${two}` : first;
  return verb.length > 18 ? "Approve" : verb;
}

function formatDate(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(+d)) return v;
  const dateOnly = !v.includes("T");
  return d.toLocaleString(
    undefined,
    dateOnly
      ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
      : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

function useApp(slug: string) {
  const { connections } = useWork();
  const app = findApp(connections, slug);
  return { name: app?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1), logo: app?.logo ?? null, connected: !!app?.connected };
}

function StatusTag({ status }: { status: AgentAction["status"] }) {
  const map: Record<AgentAction["status"], [ReactNode, string, string]> = {
    pending: [<span key="d" className="size-1.5 rounded-full bg-accent-text" />, "Needs your OK", "text-accent-text"],
    running: [<Spinner key="s" className="size-3" />, "Working", "text-ink-2"],
    done: [<Check key="c" size={12} weight="bold" />, "Done", "text-ok"],
    failed: [<WarningCircle key="w" size={13} weight="fill" />, "Failed", "text-danger"],
    cancelled: [<X key="x" size={12} weight="bold" />, "Cancelled", "text-muted"],
  };
  const [icon, label, cls] = map[status];
  return (
    // On a phone the pending tag gives its width to the title; the footer already says nothing happens until you approve.
    <span className={cx("shrink-0 items-center gap-1.5 text-[12px] font-medium", status === "pending" ? "hidden sm:inline-flex" : "inline-flex", cls)}>
      {icon}
      {label}
    </span>
  );
}

function CardShell({
  slug,
  title,
  summary,
  status,
  children,
}: {
  slug: string;
  title: string;
  summary: string;
  status: AgentAction["status"];
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const app = useApp(slug);
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease }}
      aria-label={title}
      className={cx(
        "overflow-hidden rounded-[13px] border bg-bg transition-[border-color] duration-150",
        status === "pending" ? "border-line-strong shadow-card" : "border-line",
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <span className="mt-px inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface">
          <AppLogo slug={slug} name={app.name} logo={app.logo} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block text-[15px] leading-snug font-[560] tracking-[-0.005em]",
              status === "cancelled" ? "text-muted line-through decoration-ink/25" : "text-ink",
            )}
          >
            {title}
          </span>
          {summary && status !== "cancelled" ? <span className="mt-0.5 block text-[13.5px] leading-snug text-muted">{summary}</span> : null}
        </span>
        <StatusTag status={status} />
      </header>
      {children}
    </motion.section>
  );
}

function AutoTextarea({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(320, el.scrollHeight) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className="-mx-2 block w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1.5 text-[14.5px] leading-[1.6] text-ink outline-none transition-colors duration-150 enabled:hover:bg-ink/[0.03] enabled:focus:bg-ink/[0.04] disabled:text-ink-2"
    />
  );
}

/** A change to the outside world, shown as it will go out. Edit the text, then approve it by name. */
export function ActionCard({ action }: { action: AgentAction }) {
  const { decide, busy } = useAgent();
  const fields = fieldsOf(action.args);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const pending = action.status === "pending";
  const val = (f: Field) => edits[f.key] ?? f.value;
  const edited = fields.some((f) => edits[f.key] !== undefined && edits[f.key] !== f.value);
  const verb = verbOf(action.title);
  const short = fields.filter((f) => !f.long);
  const long = fields.filter((f) => f.long);

  const approve = () => {
    if (!edited) return void decide(action, "approve");
    const args: Record<string, unknown> = { ...action.args };
    for (const f of fields) {
      const v = edits[f.key];
      if (v === undefined || v === f.value) continue;
      args[f.key] = f.kind === "list" ? v.split(/\s*,\s*/).filter(Boolean) : v;
    }
    void decide(action, "approve", args);
  };

  return (
    <CardShell slug={action.app} title={action.title} summary={action.summary} status={action.status}>
      {fields.length && action.status !== "cancelled" ? (
        <div
          className={cx("mx-3 rounded-[9px] border border-line bg-surface px-3.5", action.status === "done" || action.status === "failed" ? "opacity-80" : "")}
        >
          {short.length ? (
            <dl className="divide-y divide-line">
              {short.map((f) => (
                <div key={f.key} className="grid grid-cols-[56px_1fr] sm:grid-cols-[68px_1fr] items-center gap-2 py-1">
                  <dt className="text-[13px] text-muted">{f.label}</dt>
                  <dd className="min-w-0">
                    {f.kind === "date" ? (
                      <span className="block px-0 py-1 text-[14px] text-ink">{formatDate(f.value)}</span>
                    ) : (
                      <input
                        aria-label={f.label}
                        value={val(f)}
                        disabled={!pending}
                        onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))}
                        className="-mx-2 block w-[calc(100%+1rem)] truncate rounded-md bg-transparent px-2 py-1 text-[14px] text-ink outline-none transition-colors duration-150 enabled:hover:bg-ink/[0.03] enabled:focus:bg-ink/[0.04] disabled:text-ink-2"
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {long.map((f) => (
            <div key={f.key} className={cx("py-2", short.length || f !== long[0] ? "border-t border-line" : "")}>
              {long.length > 1 ? <div className="pt-1 text-[12px] text-muted">{f.label}</div> : null}
              <AutoTextarea label={f.label} value={val(f)} disabled={!pending} onChange={(v) => setEdits((x) => ({ ...x, [f.key]: v }))} />
            </div>
          ))}
        </div>
      ) : null}

      <footer className={cx("flex flex-wrap items-center gap-2 px-4 pb-3.5", fields.length && action.status !== "cancelled" ? "pt-3" : "pt-0")}>
        {pending || action.status === "running" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={approve}
              loading={action.status === "running"}
              disabled={busy || action.status === "running"}
              className="h-8 px-3.5"
            >
              {verb}
            </Button>
            {pending ? (
              <Button variant="ghost" size="sm" onClick={() => void decide(action, "cancel")} disabled={busy}>
                Cancel
              </Button>
            ) : null}
            <span className="ml-auto text-[12.5px] text-muted">
              {action.status === "running" ? "On it…" : edited ? "Your edits go out as shown." : "Nothing happens until you approve."}
            </span>
          </>
        ) : action.status === "done" ? (
          <p className="flex items-start gap-2 text-[13.5px] text-ink">
            <CheckCircle size={16} weight="fill" className="mt-px shrink-0 text-ok" />
            {action.result ?? "Done."}
          </p>
        ) : action.status === "failed" ? (
          <p className="flex items-start gap-2 text-[13.5px] text-danger">
            <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
            {action.error ?? "That didn't go through. Nothing was changed."}
          </p>
        ) : (
          <p className="text-[13px] text-muted">Cancelled. Nothing was sent or changed.</p>
        )}
      </footer>
    </CardShell>
  );
}

/** "Connect Slack": open the consent tab in the click, approve, then watch for the app to show up as connected. */
function ConnectCard({ action }: { action: AgentAction }) {
  const { decide, busy } = useAgent();
  const w = useWork();
  const a = action.args;
  const slug = String(a.toolkit ?? a.app ?? a.slug ?? action.app);
  const app = useApp(slug);
  const url = typeof a.url === "string" ? a.url : null;
  const waiting = w.linking === slug;
  const status: AgentAction["status"] = app.connected ? "done" : action.status === "done" ? "pending" : action.status;

  const go = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener");
    if (action.status === "pending") void decide(action, "approve");
    void w.waitForConnection(slug);
  };

  return (
    <CardShell slug={slug} title={`Connect ${app.name}`} summary={action.summary} status={waiting ? "running" : status}>
      <footer className="flex flex-wrap items-center gap-2 px-4 pb-3.5">
        {app.connected ? (
          <p className="flex items-center gap-2 text-[13.5px] text-ink">
            <CheckCircle size={16} weight="fill" className="shrink-0 text-ok" />
            {app.name} is connected.
          </p>
        ) : action.status === "cancelled" ? (
          <p className="text-[13px] text-muted">Cancelled.</p>
        ) : action.status === "failed" ? (
          <p className="flex items-start gap-2 text-[13.5px] text-danger">
            <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
            {action.error ?? `${app.name} couldn't be connected.`}
          </p>
        ) : waiting ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => url && window.open(url, "_blank", "noopener")}>
              <ArrowSquareOut size={15} /> Open again
            </Button>
            <span className="ml-auto text-[12.5px] text-muted">Finish in the tab that opened. This updates on its own.</span>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={go} disabled={!url || (busy && action.status === "pending")} className="h-8 px-3.5">
              Connect {app.name} <ArrowSquareOut size={14} />
            </Button>
            {action.status === "pending" ? (
              <Button variant="ghost" size="sm" onClick={() => void decide(action, "cancel")} disabled={busy}>
                Not now
              </Button>
            ) : null}
            <span className="ml-auto text-[12.5px] text-muted">Opens {app.name} in a new tab.</span>
          </>
        )}
      </footer>
    </CardShell>
  );
}
