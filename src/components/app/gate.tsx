"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, Key, LockSimple, PlugsConnected, ShieldCheck, WifiSlash } from "@phosphor-icons/react";
import type { GateInfo } from "@/lib/types";
import { Wordmark } from "../brand";
import { Button, Input, Label, Skeleton } from "../ui";
import { api, ApiFailure } from "./api";

const POLL_FAST_MS = 3000; // the first minute: most people finish signing in quickly
const POLL_SLOW_MS = 10_000;
const POLL_FAST_FOR_MS = 60_000;
const POLL_LIMIT_MS = 10 * 60_000;

const TRUST: { icon: ReactNode; text: string }[] = [
  { icon: <ShieldCheck size={18} weight="duotone" />, text: "Nothing is sent, posted or changed until you approve it." },
  { icon: <LockSimple size={18} weight="duotone" />, text: "Your list is stored in LooseEnds' database. Delete everything from Settings any time." },
  { icon: <PlugsConnected size={18} weight="duotone" />, text: "Gmail and 10 other apps are optional, and only read when you connect them." },
];

/** Sign in with publik. Nothing in the app renders until the gate says "ready". */
export function Gate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState<null | "claim" | "plan">(null);
  const pollStart = useRef(0);

  const load = useCallback(async () => {
    try {
      const g = await api<GateInfo>("/api/gate");
      setGate(g);
      return g;
    } catch (e) {
      const msg = e instanceof ApiFailure ? e.message : "publik is not reachable. Check your connection.";
      setGate({
        state: "unreachable",
        title: "Sign in with publik",
        body: msg,
        note: null,
        claimUrl: null,
        topUpUrl: null,
        handle: null,
        plan: null,
        balanceMicros: null,
        choice: null,
        hasPlan: false,
      });
      return null;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the await
    void load();
  }, [load]);

  // Poll GET /api/gate while waiting on the other tab: every 3 s for a minute, then every 10 s, for at most 10 minutes.
  useEffect(() => {
    if (!polling) return;
    pollStart.current = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const elapsed = Date.now() - pollStart.current;
      if (elapsed > POLL_LIMIT_MS) {
        setPolling(null);
        setNote(
          polling === "claim"
            ? "No sign-in after 10 minutes. Click Sign in with publik to try again."
            : "No plan after 10 minutes. Click Get a plan to try again.",
        );
        return;
      }
      const g = await load();
      if (stopped) return;
      if (g && polling === "claim" && g.state !== "sign_in") {
        setPolling(null);
        setNote(null);
        return;
      }
      if (g && polling === "plan" && (g.hasPlan || g.state !== "choose")) {
        setPolling(null);
        setNote(null);
        return;
      }
      timer = setTimeout(tick, Date.now() - pollStart.current < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS);
    };
    timer = setTimeout(tick, POLL_FAST_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [polling, load]);

  if (gate?.state === "ready") return <>{children}</>;

  const signIn = async () => {
    if (gate?.claimUrl) {
      window.open(gate.claimUrl, "_blank", "noopener");
    } else {
      // The session and its publik install are made only now, on the click. Open the tab inside the click so it isn't blocked.
      const tab = window.open("about:blank", "_blank");
      if (tab) tab.opener = null;
      setBusy(true);
      try {
        const g = await api<GateInfo>("/api/gate", { method: "POST" });
        setGate(g);
        if (g.state !== "sign_in" || !g.claimUrl) {
          tab?.close();
          return;
        }
        if (tab) tab.location.href = g.claimUrl;
        else window.location.href = g.claimUrl;
      } catch (e) {
        tab?.close();
        setNote(e instanceof ApiFailure ? e.message : "That didn't work. Try again.");
        return;
      } finally {
        setBusy(false);
      }
    }
    setNote("Waiting for you to sign in in your browser.");
    setPolling("claim");
  };
  const getPlan = () => {
    if (gate?.topUpUrl) window.open(gate.topUpUrl, "_blank", "noopener");
    setNote("Waiting for your plan. Finish in your browser.");
    setPolling("plan");
  };
  const choose = async (choice: "publik" | "own_key", ownKey?: { baseUrl: string; apiKey: string; model: string }) => {
    setBusy(true);
    try {
      const g = await api<GateInfo>("/api/gate/choice", { method: "POST", json: { choice, ownKey } });
      setGate(g);
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pitch = !gate || gate.state === "sign_in";
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Wordmark />
        <div>
          <p className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
            Fewer unfinished things.
            <br />
            <span className="text-muted">Nothing done without you.</span>
          </p>
          <ul className="mt-10 max-w-md space-y-5 text-[15px] text-pretty text-ink-2">
            {TRUST.map((t) => (
              <li key={t.text} className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-accent-text">{t.icon}</span>
                {t.text}
              </li>
            ))}
          </ul>
          <Preview className="mt-10 hidden max-w-[500px] xl:block" />
        </div>
        <p className="text-xs text-muted">Signing in connects LooseEnds to publik, which provides the AI.</p>
      </aside>

      <main className="flex flex-col px-5 pt-5 pb-8 sm:px-10 sm:py-6">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col pt-7 lg:justify-center lg:py-12">
          {pitch ? (
            <div className="mb-6 lg:hidden">
              <h1 className="text-[27px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink">
                Fewer unfinished things.
                <br />
                <span className="text-muted">Nothing done without you.</span>
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Connect Gmail and ask in plain words. LooseEnds finds what you have to do and gets the next step ready.
              </p>
            </div>
          ) : null}
          {!gate ? (
            <GateSkeleton />
          ) : (
            <GateBody
              gate={gate}
              note={note}
              busy={busy}
              polling={polling}
              onRetry={() => {
                setNote(null);
                void load();
              }}
              onSignIn={() => void signIn()}
              onGetPlan={getPlan}
              onChoose={choose}
            />
          )}
          {pitch ? (
            <div className="mt-9 lg:hidden">
              <ul className="space-y-3 text-[13.5px] leading-snug text-pretty text-ink-2">
                {TRUST.map((t) => (
                  <li key={t.text} className="flex gap-2.5">
                    <span className="shrink-0 text-accent-text">{t.icon}</span>
                    {t.text}
                  </li>
                ))}
              </ul>
              <Preview className="mt-8" />
            </div>
          ) : null}
          <p className="mt-8 text-[12.5px] text-muted">
            <Link href="/privacy" className="underline decoration-line-strong underline-offset-[3px] hover:text-ink">
              Privacy
            </Link>
            <span className="px-2" aria-hidden>
              ·
            </span>
            <Link href="/terms" className="underline decoration-line-strong underline-offset-[3px] hover:text-ink">
              Terms
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/** A real screenshot of LooseEnds on a desktop: the list it built from a sample email, and the assistant. */
function Preview({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Image
        src="/gate-desktop.jpg"
        alt="LooseEnds on a desktop: two tasks found in an email from a dentist, with the assistant ready below"
        width={1600}
        height={1000}
        sizes="(min-width: 1280px) 500px, 100vw"
        className="h-auto w-full rounded-xl border border-line-strong shadow-float"
      />
    </div>
  );
}

function GateSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-6 h-12 w-full rounded-lg" />
    </div>
  );
}

function GateBody({
  gate,
  note,
  busy,
  polling,
  onRetry,
  onSignIn,
  onGetPlan,
  onChoose,
}: {
  gate: GateInfo;
  note: string | null;
  busy: boolean;
  polling: null | "claim" | "plan";
  onRetry: () => void;
  onSignIn: () => void;
  onGetPlan: () => void;
  onChoose: (c: "publik" | "own_key", k?: { baseUrl: string; apiKey: string; model: string }) => void;
}) {
  const [ownKeyOpen, setOwnKeyOpen] = useState(false);

  if (gate.state === "not_configured") {
    return (
      <Panel title="LooseEnds isn't set up yet" body="LooseEnds has no publik app token configured, so it can't sign anyone in. Please try again later." />
    );
  }

  if (gate.state === "unreachable") {
    return (
      <Panel icon={<WifiSlash size={22} />} title={gate.title} body={gate.body}>
        <Button variant="primary" size="lg" className="w-full" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }

  if (gate.state === "sign_in") {
    return (
      <Panel title={gate.title} body={gate.body} note={note ?? gate.note} waiting={polling === "claim"} headOnDesktop>
        <Button variant="primary" size="lg" className="w-full" onClick={onSignIn} loading={busy}>
          Sign in with publik
          <ArrowSquareOut size={16} />
        </Button>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          AI runs on your own publik plan. A new publik account includes $0.05 of free use; after that you need a plan (from
          $8/month) or your own API key.
        </p>
      </Panel>
    );
  }

  // choose
  return (
    <Panel title={gate.title} body={gate.body} note={note ?? gate.note} waiting={polling === "plan"}>
      <div className="space-y-2.5">
        {gate.hasPlan ? (
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => onChoose("publik")}>
            Connect your plan
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={onGetPlan}>
            Get a plan
            <ArrowSquareOut size={16} />
          </Button>
        )}
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setOwnKeyOpen((v) => !v)} aria-expanded={ownKeyOpen}>
          <Key size={16} />
          Use my own key
        </Button>
      </div>
      {ownKeyOpen ? <OwnKeyForm busy={busy} onSubmit={(k) => onChoose("own_key", k)} /> : null}
    </Panel>
  );
}

export function OwnKeyForm({
  busy,
  onSubmit,
  submitLabel = "Use this key",
}: {
  busy: boolean;
  onSubmit: (k: { baseUrl: string; apiKey: string; model: string }) => void;
  submitLabel?: string;
}) {
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  return (
    <form
      className="mt-5 space-y-4 rounded-xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() });
      }}
    >
      <p className="text-[13px] leading-relaxed text-muted">
        Any OpenAI-compatible API at a public HTTPS address works. The key is encrypted in LooseEnds' database and only used for your requests.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="ok-key">API key</Label>
        <Input id="ok-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="ok-base">Base URL</Label>
          <Input id="ok-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ok-model">Model</Label>
          <Input id="ok-model" value={model} onChange={(e) => setModel(e.target.value)} required />
        </div>
      </div>
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!apiKey.trim()}>
        {submitLabel}
      </Button>
    </form>
  );
}

function Panel({
  icon,
  title,
  body,
  note,
  waiting,
  headOnDesktop,
  children,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  note?: string | null;
  waiting?: boolean;
  /** On phones the pitch above already says it; show the title and body from lg up only. */
  headOnDesktop?: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      {icon ? <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl bg-surface-2 text-ink-2">{icon}</div> : null}
      <div className={headOnDesktop ? "hidden lg:block" : undefined}>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
        <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-muted">{body}</p>
      </div>
      {children ? <div className={headOnDesktop ? "lg:mt-8" : "mt-8"}>{children}</div> : null}
      {note ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
          {waiting ? <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> : null}
          {note}
        </p>
      ) : null}
    </div>
  );
}
