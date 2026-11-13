const DAY = 86_400_000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dayDiff(iso: string, now = new Date()) {
  return Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / DAY);
}

const time = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });

/** "Today, 3 PM" · "Tomorrow" · "Thu, Nov 19, 3 PM" · "Dec 3" */
export function formatDue(iso: string, allDay: boolean, now = new Date()): string {
  const d = new Date(iso);
  const diff = dayDiff(iso, now);
  let day: string;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (diff > 1 && diff < 7) day = d.toLocaleDateString(undefined, { weekday: "long" });
  else
    day = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  return allDay ? day : `${day}, ${time(d)}`;
}

export function isOverdue(iso: string, allDay: boolean, now = new Date()) {
  if (allDay) return dayDiff(iso, now) < 0;
  return new Date(iso).getTime() < now.getTime();
}

export function timeAgo(iso: string, now = new Date()) {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < DAY / 1000) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ISO -> value for <input type="datetime-local"> in local time */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toLocalDateInput(iso: string | null): string {
  return toLocalInput(iso).slice(0, 10);
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T09:00` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function snoozePresets(now = new Date()) {
  const laterToday = new Date(now.getTime() + 3 * 3600_000);
  const tomorrow = startOfDay(new Date(now.getTime() + DAY));
  tomorrow.setHours(9);
  const nextWeek = startOfDay(new Date(now.getTime() + ((8 - now.getDay()) % 7 || 7) * DAY));
  nextWeek.setHours(9);
  const presets = [
    { label: "Tomorrow morning", at: tomorrow },
    { label: "Next week", at: nextWeek },
  ];
  if (now.getHours() < 19) presets.unshift({ label: "In 3 hours", at: laterToday });
  return presets;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
