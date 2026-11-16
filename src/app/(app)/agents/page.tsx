"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Robot } from "@phosphor-icons/react";
import type { AgentRun } from "@/lib/types";
import { AgentProvider } from "@/components/app/agent";
import { Thread } from "@/components/app/agent-ui";
import { api } from "@/components/app/api";
import { useStore } from "@/components/app/store";
import { Button, cx, Spinner } from "@/components/ui";

const STATUS: Record<AgentRun["status"], string> = { running: "Working", completed: "Finished", needs_approval: "Needs approval", failed: "Couldn't finish" };

export default function AgentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { select } = useStore();
  const selectedId = params.get("id");
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ runs: AgentRun[] }>("/api/agents");
      setRuns(r.runs); setLoadError(null);
    } catch (e) { setLoadError(e instanceof Error ? e.message : "Couldn't load your agents."); }
  }, []);
  const watching = !runs || runs.some((r) => r.status === "running" || r.status === "needs_approval");
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = watching ? setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2500) : undefined;
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh, watching]);
  const selected = runs?.find((r) => r.id === selectedId);

  return (
    <main className="mx-auto w-full max-w-[880px] px-4 pt-5 pb-16 sm:px-6 lg:pt-7">
      <header className="mb-6">
        <h1 className="text-[18px] font-medium tracking-[-0.02em]">Agents</h1>
        <p className="mt-1 text-[14px] text-muted">Give each agent a task. Come back here for its results.</p>
      </header>
      <form className="rounded-xl border border-line bg-surface p-4" onSubmit={async (e) => {
        e.preventDefault();
        if (starting) return;
        if (!task.trim()) { setError("Describe a task for your agent."); return; }
        setStarting(true); setError(null);
        try {
          const { run } = await api<{ run: AgentRun }>("/api/agents", { method: "POST", json: { task } });
          setTask("");
          setRuns((list) => [run, ...(list ?? [])]);
        } catch (e) { setError(e instanceof Error ? e.message : "Couldn't start your agent."); }
        finally { setStarting(false); }
      }}>
        <label htmlFor="agent-task" className="text-[13px] font-medium text-ink-2">Task</label>
        <textarea id="agent-task" value={task} onChange={(e) => setTask(e.target.value)} maxLength={10_000} rows={3}
          placeholder="Find the emails that need a reply and prepare drafts."
          aria-describedby={error ? "agent-error" : undefined} aria-invalid={!!error}
          className="mt-2 block w-full resize-y rounded-lg border border-line bg-bg px-3 py-2.5 text-[16px] leading-relaxed placeholder:text-muted sm:text-[14px]" />
        {error ? <p id="agent-error" role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted">Actions in connected apps still need your approval.</p>
          <Button type="submit" variant="primary" loading={starting}><Robot size={16} />{starting ? "Starting…" : "Spawn agent"}</Button>
        </div>
      </form>
      <section aria-label="Your agents" className="mt-7">
        <h2 className="mb-2 text-[12.5px] font-medium text-muted">Your agents</h2>
        {loadError ? <div role="alert" className="mb-3 text-[13px] text-danger">{loadError} <button onClick={() => void refresh()} className="underline">Try again</button></div> : null}
        {!runs && !loadError ? <p className="flex items-center gap-2 py-6 text-[14px] text-muted"><Spinner /> Loading agents…</p> : null}
        {runs?.length === 0 ? <div className="border-y border-line py-9 text-center"><Robot size={26} className="mx-auto text-muted" /><p className="mt-3 text-[14px] text-ink-2">Your first agent starts with a task.</p><p className="mt-1 text-[13px] text-muted">You can launch several and let them work at the same time.</p></div> : null}
        <ul className="divide-y divide-line border-y border-line">
          {runs?.map((run) => (
            <li key={run.id}>
              <Link href={`/agents?id=${run.id}#agent-results`} aria-current={selectedId === run.id ? "true" : undefined}
                className={cx("flex items-start gap-3 px-3 py-4 transition-colors hover:bg-surface-2", selectedId === run.id && "bg-surface-2")}>
                <span className="mt-1 text-muted">{run.status === "running" ? <Spinner /> : <Robot size={17} />}</span>
                <span className="min-w-0 flex-1"><span className="line-clamp-2 text-[14px] font-medium [overflow-wrap:anywhere]">{run.task}</span>
                  <span className={cx("mt-1 block text-[12.5px]", run.status === "failed" ? "text-danger" : run.status === "needs_approval" ? "text-accent-text" : "text-muted")}>{STATUS[run.status]} · {new Date(run.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </span>
                <ArrowUpRight size={15} className="mt-1 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {selectedId ? <section id="agent-results" className="mt-6 flex h-[min(650px,75dvh)] flex-col overflow-hidden rounded-xl border border-line bg-surface" aria-label="Agent results">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="truncate text-[14px] font-medium">{selected?.task ?? "Agent results"}</h2>
          <Link href="/agents" className="shrink-0 text-[13px] text-muted hover:text-ink">Close results</Link>
        </header>
        <AgentProvider key={selectedId} runId={selectedId}>
          <Thread onOpenTask={(id) => { select(id); router.push("/"); }} empty={<p className="text-[14px] text-muted">Your agent is getting started…</p>} />
        </AgentProvider>
      </section> : null}
    </main>
  );
}
