"use client";

import { CalendarBlank, CalendarCheck, Question, WarningCircle } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { Chip } from "../ui";
import { formatDue, isOverdue, dayDiff } from "./dates";

export function DueChip({ task }: { task: Task }) {
  const { dueAt, dueAllDay, dueStatus } = task;
  if (dueStatus === "needs_review" && dueAt) {
    return (
      <Chip tone="warn">
        <Question size={13} weight="bold" />
        {formatDue(dueAt, dueAllDay)}?
      </Chip>
    );
  }
  if (dueStatus === "unclear") {
    return (
      <Chip tone="warn">
        <Question size={13} weight="bold" />
        Date unclear
      </Chip>
    );
  }
  if (!dueAt) {
    return (
      <Chip>
        <CalendarBlank size={13} />
        No date
      </Chip>
    );
  }
  if (isOverdue(dueAt, dueAllDay)) {
    return (
      <Chip tone="danger">
        <WarningCircle size={13} weight="bold" />
        {formatDue(dueAt, dueAllDay)}
      </Chip>
    );
  }
  return (
    <Chip tone={dayDiff(dueAt) <= 1 ? "accent" : "neutral"}>
      <CalendarCheck size={13} />
      {formatDue(dueAt, dueAllDay)}
    </Chip>
  );
}

export function statusLabel(t: Task): string {
  switch (t.status) {
    case "detected":
      return "New";
    case "reviewed":
      return "Reviewed";
    case "prepared": {
      const k = t.actions.find((a) => a.status === "prepared")?.kind;
      return k === "reply" ? "Draft ready" : k === "event" ? "Event ready" : k === "reminder" ? "Reminder set" : "Prepared";
    }
    case "approved":
      return "Approved";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "dismissed":
      return "Dismissed";
  }
}

export const STATUS_FLOW: Task["status"][] = ["detected", "reviewed", "prepared", "approved", "completed"];

export function primaryActionLabel(t: Task): { label: string; panel: "reply" | "event" | "reminder" } {
  const has = (k: string) => t.actions.some((a) => a.kind === k);
  if (t.nextStepType === "reply") {
    const sent = t.actions.some((a) => a.kind === "reply" && a.receipts.some((r) => r.what === "Sent with Gmail"));
    return { label: sent ? "View reply" : has("reply") ? "Open draft" : "Draft reply", panel: "reply" };
  }
  if (t.nextStepType === "event") return { label: has("event") ? "Open event" : "Prepare event", panel: "event" };
  return { label: has("reminder") ? "Reminder" : "Remind me", panel: "reminder" };
}
