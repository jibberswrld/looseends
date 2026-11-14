import type { Metadata } from "next";

export const metadata: Metadata = { title: "Connected" };

const NAMES: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  outlook: "Outlook",
  slack: "Slack",
  notion: "Notion",
  googledrive: "Google Drive",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  github: "GitHub",
  linear: "Linear",
  todoist: "Todoist",
};

/** Where an app's sign-in lands after connecting it (the connection's callback URL, `/connected?app=<toolkit>`). */
export default async function Connected({ searchParams }: PageProps<"/connected">) {
  const app = (await searchParams).app;
  const name = typeof app === "string" ? NAMES[app.toLowerCase()] : undefined;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{name ? `${name} is connected.` : "Your account is connected."}</h1>
        <p className="mt-2 text-[15px] text-muted">You can close this tab and go back to LooseEnds.</p>
      </div>
    </main>
  );
}
