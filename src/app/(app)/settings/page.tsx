"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, Bell, Key, Plugs, ShieldCheck, SignOut, Trash, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { GateInfo, Me } from "@/lib/types";
import { api } from "@/components/app/api";
import { OwnKeyForm } from "@/components/app/gate";
import { Page, PageHeader } from "@/components/app/page-header";
import { reportError } from "@/components/app/store";
import { useWork } from "@/components/app/work";
import { Button, Chip, Skeleton } from "@/components/ui";

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex gap-3.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15.5px] font-semibold">{title}</h2>
          <div className="mt-1.5 text-[14px] leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyForm, setKeyForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const work = useWork();
  const [notif, setNotif] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  useEffect(() => {
    void api<Me>("/api/me").then(setMe).catch(reportError);
    void api<GateInfo>("/api/gate").then(setGate).catch(() => {});
  }, []);

  const setChoice = async (choice: "publik" | "own_key", ownKey?: { baseUrl: string; apiKey: string; model: string }) => {
    setBusy(true);
    try {
      const g = await api<GateInfo>("/api/gate/choice", { method: "POST", json: { choice, ownKey } });
      setGate(g);
      setMe(await api<Me>("/api/me"));
      setKeyForm(false);
      toast.success(choice === "publik" ? "Using your publik plan" : "Using your own key");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api("/api/signout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  };
  const deleteAll = async () => {
    setBusy(true);
    try {
      await api("/api/me", { method: "DELETE" });
      window.location.href = "/?deleted=1";
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="mt-8 space-y-4">
        <Row icon={<ShieldCheck size={18} />} title="Account">
          {me ? (
            <p>
              Signed in with publik{me.handle ? <> as <span className="font-medium text-ink">@{me.handle}</span></> : null}.
            </p>
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
          <Button size="sm" variant="secondary" className="mt-4" onClick={() => void signOut()}>
            <SignOut size={15} /> Sign out on this computer
          </Button>
        </Row>

        <Row icon={<Wallet size={18} />} title="How AI is paid for">
          {me ? (
            <>
              <p>
                {me.choice === "own_key" ? (
                  <>
                    Using your own key{me.ownKey ? <> (…{me.ownKey.last4}, {me.ownKey.model})</> : null}.
                  </>
                ) : (
                  <>
                    Using your publik plan
                    {gate?.plan?.label ? <> ({gate.plan.label})</> : null}
                    {typeof gate?.balanceMicros === "number" ? <>. Balance ${(gate.balanceMicros / 1_000_000).toFixed(2)}</> : null}.
                  </>
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {me.choice === "own_key" ? (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void setChoice("publik")}>
                    Use my publik plan
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setKeyForm((v) => !v)}>
                    <Key size={15} /> Use my own key
                  </Button>
                )}
                {gate?.topUpUrl ? (
                  <Button size="sm" variant="ghost" onClick={() => window.open(gate.topUpUrl!, "_blank", "noopener")}>
                    Manage plan <ArrowSquareOut size={14} />
                  </Button>
                ) : null}
              </div>
              {keyForm ? <OwnKeyForm busy={busy} onSubmit={(k) => void setChoice("own_key", k)} /> : null}
            </>
          ) : (
            <Skeleton className="h-4 w-60" />
          )}
        </Row>

        <Row icon={<Plugs size={18} />} title="Connected accounts">
          <p>Connections go through Composio. LooseEnds reads mail only when you check your inbox, and writes only what you confirm.</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {(
              [
                ["gmail", "Gmail", "Read recent inbox mail, save drafts, send replies you confirm"],
                ["googlecalendar", "Google Calendar", "Add events you confirm"],
              ] as const
            ).map(([t, name, what]) => {
              const on = !!work.connections?.[t].connected;
              return (
                <li key={t} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{name}</span>
                    <span className="block text-[13px]">{what}</span>
                  </span>
                  {on ? <Chip tone="accent">Connected</Chip> : null}
                  {on ? (
                    <Button size="sm" variant="ghost" onClick={() => void work.disconnect(t)}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" loading={work.linking === t} disabled={!work.connections?.available || !!work.linking} onClick={() => void work.connect(t)}>
                      Connect
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {work.connections && !work.connections.available ? <p className="mt-3 text-[13px] text-warn">{work.connections.message}</p> : null}
        </Row>

        <Row icon={<Bell size={18} />} title="Reminder notifications">
          <p>Reminders always appear inside LooseEnds. Allow notifications to also get a browser alert while LooseEnds is open in a tab.</p>
          <div className="mt-4">
            {notif === "granted" ? (
              <Chip tone="accent">Notifications allowed</Chip>
            ) : notif === "denied" ? (
              <Chip>Blocked in your browser settings</Chip>
            ) : notif === "unsupported" ? (
              <Chip>Not supported in this browser</Chip>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void Notification.requestPermission().then(setNotif)}>
                Allow notifications
              </Button>
            )}
          </div>
        </Row>

        <Row icon={<ShieldCheck size={18} />} title="What LooseEnds can and can't do">
          <ul className="list-disc space-y-1 pl-5">
            <li>It reads what you paste or upload. If you connect Gmail, it also reads recent inbox mail when you ask it to check.</li>
            <li>It sends an email or adds a calendar event only when you press send and confirm that exact preview. It never pays, books or deletes anything.</li>
            <li>Instructions hidden inside a message are treated as text, never as commands.</li>
            <li>Screenshots are read and then discarded. Only the text is kept, so you can see where each task came from.</li>
          </ul>
        </Row>

        <section className="rounded-xl border border-danger/25 bg-surface p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15.5px] font-semibold text-danger">
            <Trash size={18} /> Delete everything
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            Permanently removes your tasks, drafts, reminders, every message you added, and your stored key. This can't be undone.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              aria-label='Type "delete" to confirm'
              placeholder='Type "delete" to confirm'
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              className="h-9 w-56 rounded-lg border border-line-strong bg-surface px-3 text-[14px] focus:border-danger focus:outline-none"
            />
            <Button size="sm" className="bg-danger text-white hover:opacity-90" disabled={confirmDelete.trim().toLowerCase() !== "delete"} loading={busy} onClick={() => void deleteAll()}>
              Delete all my data
            </Button>
          </div>
        </section>
      </div>
    </Page>
  );
}
