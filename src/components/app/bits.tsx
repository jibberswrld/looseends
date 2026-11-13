import { cx } from "../ui";

/** Brand marks for the two accounts LooseEnds can connect. Real logos read faster than generic icons. */
export function GmailLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 256 193" width={size} height={(size * 193) / 256} aria-hidden className={cx("shrink-0", className)}>
      <path fill="#4285F4" d="M58.182 192.05V93.14L27.507 65.077L0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455z" />
      <path fill="#34A853" d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837l-27.026 25.798z" />
      <path fill="#EA4335" d="m58.182 93.14l-4.174-38.647l4.174-36.989L128 69.868l69.818-52.364l4.669 34.992l-4.669 40.644L128 145.504z" />
      <path fill="#FBBC04" d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945z" />
      <path fill="#C5221F" d="m0 49.504l26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23z" />
    </svg>
  );
}

export function CalendarLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className={cx("shrink-0", className)}>
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#fff" stroke="#4285F4" strokeWidth="3" />
      <rect x="2" y="2" width="28" height="9" rx="4" fill="#4285F4" />
      <text x="16" y="25" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#4285F4">
        31
      </text>
    </svg>
  );
}

/** "City Power <billing@x.com>" -> "City Power" */
export function senderName(from: string | null | undefined): string | null {
  if (!from) return null;
  const name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return name || from.replace(/[<>]/g, "").trim() || null;
}

/** A soft, stable color per sender so the list is scannable by who it came from. */
export function Avatar({ name, size = 32, className }: { name: string | null; size?: number; className?: string }) {
  const n = (name ?? "You").trim();
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-full font-[560]", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.925 0.045 ${h})`, color: `oklch(0.4 0.1 ${h})` }}
    >
      {(n.match(/[A-Za-z0-9]/)?.[0] ?? "•").toUpperCase()}
    </span>
  );
}

/** A connected app's logo: Composio's image when there is one, else our Google marks, else its initial. */
export function AppLogo({ slug, name, logo, size = 16, className }: { slug: string; name: string; logo: string | null; size?: number; className?: string }) {
  if (logo)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote logos from Composio; next/image would need remotePatterns for every host
      <img src={logo} alt="" width={size} height={size} loading="lazy" className={cx("shrink-0 object-contain", className)} style={{ width: size, height: size }} />
    );
  if (slug === "gmail") return <GmailLogo size={size} className={className} />;
  if (slug === "googlecalendar") return <CalendarLogo size={size} className={className} />;
  return <Avatar name={name} size={size} className={cx("rounded-[4px]", className)} />;
}

/** Who a task came from, by name: the sender, else the source title without "Email from". */
export function sourceLabel(source: { from: string | null; title: string } | null | undefined): string | null {
  if (!source) return null;
  return senderName(source.from) ?? (source.title.replace(/^(an? )?(e-?mail|message|text|letter|note|notice) from\s+/i, "").trim() || source.title);
}
