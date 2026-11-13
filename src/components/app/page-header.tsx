import type { ReactNode } from "react";

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-[30px]">{title}</h1>
        {sub ? <p className="mt-1.5 text-[14.5px] text-muted">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={`mx-auto w-full px-4 py-7 sm:px-8 sm:py-9 ${wide ? "max-w-[1180px]" : "max-w-[760px]"}`}>{children}</main>;
}
