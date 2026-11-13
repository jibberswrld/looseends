"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FilePdf,
  ImageSquare,
  Megaphone,
  Paperclip,
  Plus,
  ShieldWarning,
  Smiley,
  Copy as CopyIcon,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { CaptureResult, Task } from "@/lib/types";
import { Button, Chip, cx, Input, Label, Textarea } from "../ui";
import { api, ApiFailure } from "./api";
import { formatDue, fromLocalInput } from "./dates";
import { useStore } from "./store";
import { DueChip } from "./task-bits";

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Dentist reminder",
    text: `From: Riverside Dental <frontdesk@riversidedental.com>
Subject: Please confirm your cleaning

Hi Maya,

Please confirm your appointment for Thursday by 3 p.m. and complete the intake form before your visit. You can reply to this email to confirm.

Thanks,
Riverside Dental front desk`,
  },
  {
    label: "Apartment email",
    text: `Hi residents of 412 Linden Ave,

Annual unit inspections are happening next week. Please reply to this email by Friday with a 2-hour window that works for you (Mon-Wed, 9am-5pm). If we don't hear from you, we'll schedule you automatically.

Also, a reminder that renter's insurance proof is due to the office by November 30.

Thanks,
Dana, Linden Property Management`,
  },
  {
    label: "Library notice",
    text: `Westfield Public Library

Your library card expires on December 3, 2026. Renew online or at any branch. You currently have 2 items checked out: "The Overstory" is due on November 18, 2026.`,
  },
];

type Attachment = { file: File; kind: "image" | "pdf"; preview: string | null };

const STAGES = ["Reading it", "Finding what needs doing", "Checking dates against the message"];

async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("This image format can't be read here. Try a PNG or JPEG screenshot.");
  const max = 1568;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  if (!blob) throw new Error("Couldn't prepare that image.");
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function CaptureForm({ compact = false, onFinish }: { compact?: boolean; onFinish?: () => void }) {
  const reduce = useReducedMotion();
  const { upsertMany } = useStore();
  const [text, setText] = useState("");
  const [att, setAtt] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<{ message: string; topUpUrl: string | null } | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1600);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => () => { if (att?.preview) URL.revokeObjectURL(att.preview); }, [att]);

  const attach = (file: File) => {
    setError(null);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      if (file.size > 4_000_000) return setError({ message: "That PDF is over 4 MB. Try a smaller file or paste the text.", topUpUrl: null });
      setAtt({ file, kind: "pdf", preview: null });
    } else if (file.type.startsWith("image/")) {
      setAtt({ file, kind: "image", preview: URL.createObjectURL(file) });
    } else {
      setError({ message: "LooseEnds can read pasted text, screenshots (PNG, JPEG, WebP) and PDFs.", topUpUrl: null });
    }
  };

  const submit = async (force = false) => {
    if (busy) return;
    if (!att && !text.trim()) return;
    setStage(0);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let r: CaptureResult;
      if (att) {
        const fd = new FormData();
        const file = att.kind === "image" ? await downscaleImage(att.file) : att.file;
        fd.set("file", file);
        if (text.trim()) fd.set("note", text.trim());
        if (force) fd.set("force", "true");
        r = await api<CaptureResult>("/api/capture", { method: "POST", body: fd });
      } else {
        r = await api<CaptureResult>("/api/capture", { method: "POST", json: { text, force } });
      }
      setResult(r);
      if (r.tasks.length) upsertMany(r.tasks);
      if (r.outcome !== "duplicate_source") {
        setText("");
        setAtt(null);
      }
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "Something went wrong. Try again.",
        topUpUrl: e instanceof ApiFailure ? e.topUpUrl : null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
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
          "rounded-xl border bg-surface shadow-card transition-colors",
          drag ? "border-accent ring-4 ring-accent/15" : "border-line",
        )}
      >
        <label htmlFor="capture-text" className="sr-only">
          Paste a message, email or note
        </label>
        <Textarea
          id="capture-text"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const f = Array.from(e.clipboardData.files)[0];
            if (f) {
              e.preventDefault();
              attach(f);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={compact ? 4 : 9}
          placeholder={att ? "Add a note about this file (optional)" : "Paste an email, a text, a note from school… anything with something to do in it."}
          className="resize-none border-0 bg-transparent px-5 pt-4 text-[15.5px] shadow-none focus:ring-0"
        />
        {att ? (
          <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg bg-surface-2 p-2 pr-3">
            {att.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={att.preview} alt="" className="size-11 rounded-lg object-cover" />
            ) : (
              <span className="inline-flex size-11 items-center justify-center rounded-lg bg-surface text-accent">
                <FilePdf size={22} />
              </span>
            )}
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="truncate font-medium text-ink">{att.file.name}</p>
              <p className="text-muted">{att.kind === "pdf" ? "PDF" : "Screenshot"} · {(att.file.size / 1024).toFixed(0)} KB</p>
            </div>
            <button type="button" aria-label="Remove file" onClick={() => setAtt(null)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink">
              <X size={16} />
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-3 sm:px-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attach(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Paperclip size={16} />
            <span className="hidden sm:inline">Screenshot or PDF</span>
            <span className="sm:hidden">Attach</span>
          </Button>
          <span className="hidden text-[12px] text-muted md:inline">or drop / paste it here</span>
          <Button type="submit" variant="primary" className="ml-auto" loading={busy} disabled={!att && !text.trim()}>
            Find action items
          </Button>
        </div>
      </form>

      {!compact && !busy && !result && !text && !att ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">No message handy? Try one:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setText(ex.text)}
              className="h-8 rounded-full border border-line-strong bg-surface px-3 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
            >
              {ex.label}
            </button>
          ))}
        </div>
      ) : null}

      <AnimatePresence mode="wait">
        {busy ? (
          <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3" aria-live="polite">
            <ol className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              {STAGES.map((s, i) => (
                <li key={s} className={cx("flex items-center gap-1.5 transition-colors", i <= stage ? "text-ink-2" : "text-muted/60")}>
                  {i < stage ? <Check size={13} weight="bold" className="text-accent" /> : <span className={cx("size-1.5 rounded-full", i === stage ? "animate-pulse bg-accent" : "bg-line-strong")} />}
                  {s}
                </li>
              ))}
            </ol>
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex justify-between gap-4">
                  <div className="skeleton h-5 w-1/2 rounded-md" />
                  <div className="skeleton h-6 w-24 rounded-full" />
                </div>
                <div className="skeleton mt-3 h-4 w-4/5 rounded-md" />
                <div className="skeleton mt-4 h-10 w-full rounded-lg" />
              </div>
            ))}
          </motion.div>
        ) : error ? (
          <motion.div key="err" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="rounded-xl bg-danger-soft px-5 py-4 text-[14px] text-ink-2">
            <p>{error.message}</p>
            <div className="mt-3 flex gap-2">
              {error.topUpUrl ? (
                <Button size="sm" variant="primary" onClick={() => window.open(error.topUpUrl!, "_blank", "noopener")}>
                  Add credit
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void submit()} disabled={!att && !text.trim()}>
                  Try again
                </Button>
              )}
            </div>
          </motion.div>
        ) : result ? (
          <motion.div key="res" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CaptureResultView result={result} onForce={() => void submit(true)} onDone={() => setResult(null)} onFinish={onFinish} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CaptureResultView({ result, onForce, onDone, onFinish }: { result: CaptureResult; onForce: () => void; onDone: () => void; onFinish?: () => void }) {
  const router = useRouter();
  const toToday = () => (onFinish ? onFinish() : router.push("/"));
  const { open } = useStore();
  // Keep the freshest copy from the store so Keep/Reject reflect immediately.
  const ids = result.tasks.map((t) => t.id);
  const live = ids.map((id) => open?.find((t) => t.id === id) ?? result.tasks.find((t) => t.id === id)!).filter(Boolean);
  const real = live.filter((t) => !t.isPromotional);
  const promo = live.filter((t) => t.isPromotional);
  const pending = real.filter((t) => t.status === "detected");

  if (result.outcome === "duplicate_source") {
    return (
      <Notice icon={<CopyIcon size={18} />} title="You've already added this" body={result.message ?? "This exact message is already in LooseEnds, so nothing new was created."}>
        <Button size="sm" variant="secondary" onClick={toToday}>
          See your list
        </Button>
        <Button size="sm" variant="ghost" onClick={onForce}>
          Read it again anyway
        </Button>
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      {result.source?.injectionDetected ? (
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
          <ShieldWarning size={17} className="mt-0.5 shrink-0 text-warn" />
          This message tried to give instructions to an AI. LooseEnds ignored them and only looked for real tasks. Nothing was sent or changed.
        </p>
      ) : null}

      {real.length ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold tracking-[-0.015em]">
                Found {real.length} {real.length === 1 ? "thing" : "things"} to do
              </h2>
              <p className="mt-0.5 text-[13.5px] text-muted">Check each one. Keep it, fix it, or throw it out.</p>
            </div>
            <Button variant={pending.length === 0 ? "primary" : "ghost"} onClick={toToday}>
              {pending.length === 0 ? "Go to Today" : "Review later"} <ArrowRight size={16} />
            </Button>
          </div>
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {real.map((t) => (
                <ReviewCard key={t.id} task={t} />
              ))}
            </AnimatePresence>
          </ul>
        </>
      ) : result.outcome === "promotional" ? (
        <Notice icon={<Megaphone size={18} />} title="This looks like marketing" body={result.message ?? "It reads like a newsletter or a promotion, not something you need to do."}>
          <ManualAdd onAdded={onDone} />
        </Notice>
      ) : (
        <Notice icon={<Smiley size={18} />} title="Nothing to do here" body={result.message ?? "We didn't find anything you need to do in this. You can add a task yourself."}>
          <ManualAdd onAdded={onDone} />
        </Notice>
      )}

      {promo.length ? (
        <details className="group rounded-xl border border-line bg-surface px-5 py-3.5">
          <summary className="cursor-pointer list-none text-[13.5px] font-medium text-ink-2">
            {promo.length} probably promotional {promo.length === 1 ? "item" : "items"}, hidden from Today
          </summary>
          <ul className="mt-3 space-y-3">
            {promo.map((t) => (
              <ReviewCard key={t.id} task={t} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ReviewCard({ task }: { task: Task }) {
  const { patch, select } = useStore();
  const router = useRouter();
  const decided = task.status !== "detected";
  const dismissed = task.status === "dismissed";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cx("list-none rounded-xl border bg-surface p-4 transition-opacity sm:p-5", decided ? "border-line" : "border-line-strong shadow-card", dismissed && "opacity-55")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className={cx("text-[15.5px] font-semibold leading-snug", dismissed && "line-through")}>{task.title}</h3>
        <DueChip task={task} />
      </div>
      <p className="mt-1 text-[14px] text-ink-2">{task.nextStep}</p>
      {task.evidence?.quote ? (
        <p className="mt-3 border-l-2 border-accent/50 pl-3 text-[13px] leading-relaxed text-muted">“{task.evidence.quote}”</p>
      ) : null}
      {task.dueStatus === "needs_review" && task.dueText ? (
        <p className="mt-2 text-[12.5px] text-warn">Date inferred from “{task.dueText}”. Confirm it when you keep this.</p>
      ) : task.dueStatus === "unclear" ? (
        <p className="mt-2 text-[12.5px] text-warn">{task.dueNote ?? "The message doesn't say exactly when."}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dismissed ? (
          <>
            <Chip>Thrown out</Chip>
            <Button size="sm" variant="ghost" onClick={() => void patch(task.id, { status: "detected" })}>
              Undo
            </Button>
          </>
        ) : decided ? (
          <>
            <Chip tone="accent">
              <Check size={12} weight="bold" /> Kept
            </Chip>
            <Button size="sm" variant="ghost" onClick={() => { router.push("/"); select(task.id); }}>
              Open
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void patch(task.id, {
                  status: "reviewed",
                  ...(task.dueStatus === "needs_review" && task.dueAt ? { dueStatus: "confirmed", dueAt: task.dueAt } : {}),
                })
              }
            >
              <Check size={14} weight="bold" />
              {task.dueStatus === "needs_review" && task.dueAt ? `Keep, due ${formatDue(task.dueAt, task.dueAllDay)}` : "Keep"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { router.push("/"); select(task.id); }}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void patch(task.id, { status: "dismissed" })}>
              Not a task
            </Button>
          </>
        )}
      </div>
    </motion.li>
  );
}

function Notice({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{body}</p>
          {children ? <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ManualAdd({ onAdded }: { onAdded?: () => void }) {
  const { upsert } = useStore();
  const [openForm, setOpenForm] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!openForm)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpenForm(true)}>
        <Plus size={15} /> Add a task yourself
      </Button>
    );
  return (
    <form
      className="w-full space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          const t = await api<Task>("/api/tasks", {
            method: "POST",
            json: { title: title.trim(), dueAt: fromLocalInput(due), dueAllDay: due.length === 10 },
          });
          upsert(t);
          toast.success("Added to Today");
          setTitle("");
          setDue("");
          setOpenForm(false);
          onAdded?.();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't add that.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="m-title">What needs doing?</Label>
          <Input id="m-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Return library books" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-due" hint="optional">
            Due
          </Label>
          <Input id="m-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!title.trim()}>
          Add task
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpenForm(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function CaptureLinkCard() {
  return (
    <Link
      href="/capture"
      className="group flex items-center gap-4 rounded-xl border border-dashed border-line-strong bg-surface/60 px-5 py-4 text-left transition-colors hover:border-accent hover:bg-surface"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <ImageSquare size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium text-ink">Got a new message, screenshot or PDF?</span>
        <span className="block text-[13px] text-muted">Drop it in and LooseEnds pulls out what needs doing.</span>
      </span>
      <ArrowRight size={18} className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}
