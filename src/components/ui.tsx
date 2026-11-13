import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "text-danger hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-[15px] gap-2",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-xl font-medium transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("size-3.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent opacity-80", className)}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.97] disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "accent" | "warn" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-text",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};
export function Chip({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {children}
      </label>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

const fieldBase =
  "w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-muted/80 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(fieldBase, "py-2.5 leading-relaxed", className)} {...rest} />;
});

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, "h-10 appearance-none bg-[length:12px] pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton rounded-lg", className)} />;
}
