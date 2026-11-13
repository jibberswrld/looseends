import type { Metadata } from "next";

export const metadata: Metadata = { title: "Connected" };

/** Where Google sign-in lands after connecting an account (the connector's callbackUrl). */
export default async function Connected({ searchParams }: PageProps<"/connected">) {
  const app = (await searchParams).app === "googlecalendar" ? "Google Calendar" : "Gmail";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{app} is connected.</h1>
        <p className="mt-2 text-[15px] text-muted">You can close this tab and go back to LooseEnds.</p>
      </div>
    </main>
  );
}
