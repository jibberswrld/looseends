"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, Key, LockSimple, ShieldCheck, Sparkle, WifiSlash } from "@phosphor-icons/react";
import type { GateInfo } from "@/lib/types";
import { Wordmark } from "../brand";
import { Button, Input, Label, Skeleton } from "../ui";
import { api, ApiFailure } from "./api";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 10 * 60_000;

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

  // Poll GET /api/gate every 3s for at most 10 minutes while waiting on the browser.
  useEffect(() => {
    if (!polling) return;
    pollStart.current = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - pollStart.current > POLL_LIMIT_MS) {
        setPolling(null);
        setNote(
          polling === "claim"
            ? "No sign-in after 10 minutes. Click Sign in with publik to try again."
            : "No plan after 10 minutes. Click Get a plan to try again.",
        );
        return;
      }
      const g = await load();
      if (!g) return;
      if (polling === "claim" && g.state !== "sign_in") {
        setPolling(null);
        setNote(null);
      }
      if (polling === "plan" && (g.hasPlan || g.state !== "choose")) {
        setPolling(null);
        setNote(null);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, load]);

  if (gate?.state === "ready") return <>{children}</>;

  const signIn = () => {
    if (!gate?.claimUrl) return;
    window.open(gate.claimUrl, "_blank", "noopener");
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

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Wordmark />
        <div className="max-w-md">
          <p className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
            Fewer unfinished things.
            <br />
            <span className="text-muted">Nothing done without you.</span>
          </p>
          <ul className="mt-10 space-y-5 text-[15px] text-ink-2">
            <li className="flex gap-3">
              <ShieldCheck size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              Replies and calendar events are prepared for you to review. Nothing goes out until you confirm it.
            </li>
            <li className="flex gap-3">
              <LockSimple size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              Your list is stored on this computer, not in the cloud. Delete it any time.
            </li>
            <li className="flex gap-3">
              <Sparkle size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              AI runs on your publik plan, so there is no API key to paste.
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted">Signing in connects LooseEnds to publik, which provides the AI.</p>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12">
          {!gate ? <GateSkeleton /> : <GateBody gate={gate} note={note} busy={busy} polling={polling} onRetry={() => { setNote(null); void load(); }} onSignIn={signIn} onGetPlan={getPlan} onChoose={choose} />}
        </div>
      </main>
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
      <Panel title="LooseEnds isn't set up yet" body="This copy of LooseEnds has no publik app token, so it can't sign anyone in. Reinstall it from publik, or add publik-app-token.txt next to package.json." />
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
      <Panel title={gate.title} body={gate.body} note={note ?? gate.note} waiting={polling === "claim"}>
        <Button variant="primary" size="lg" className="w-full" onClick={onSignIn} disabled={!gate.claimUrl}>
          Sign in with publik
          <ArrowSquareOut size={16} />
        </Button>
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
        Any OpenAI-compatible API works. The key is encrypted and stored on this computer, and only used for your requests.
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
  children,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  note?: string | null;
  waiting?: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      {icon ? <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl bg-surface-2 text-ink-2">{icon}</div> : null}
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
      <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-muted">{body}</p>
      {children ? <div className="mt-8">{children}</div> : null}
      {note ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
          {waiting ? <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> : null}
          {note}
        </p>
      ) : null}
    </div>
  );
}
