import Image from "next/image";
import Link from "next/link";
import { cx } from "./ui";

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      priority
      className={cx("shrink-0 select-none", className)}
    />
  );
}

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center gap-2 rounded-lg", className)} aria-label="LooseEnds home">
      <LogoMark size={26} />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">LooseEnds</span>
    </Link>
  );
}
