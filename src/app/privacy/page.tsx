import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

export const metadata: Metadata = { title: "Privacy" };

const APPS = "Gmail, Google Calendar, Outlook, Slack, Notion, Google Drive, Google Docs, Google Sheets, GitHub, Linear and Todoist";

const SECTIONS: [string, string[]][] = [
  [
    "What LooseEnds stores",
    [
      "The text of messages you paste, the text read from screenshots, and the text extracted from PDFs. Image and PDF files themselves are not kept.",
      "When it checks your inbox or reads an email you point it to, the sender, subject and body of each email it reads (up to about 8,000 characters per message). To choose which recent emails to read, it first looks at the sender, subject, date and a short preview of up to about 25 of them; for the ones it passes over it keeps only the sender and subject, so it doesn't look at them again.",
      "The tasks, drafts, calendar events and reminders created from them, and receipts of what you did with them.",
      "Your conversations with the assistant, the tasks and results of agents you launch, and the details of every action it proposes: which app, what it would do, and every value it would send.",
      "Your publik handle, time zone, and simple usage events (without message content).",
      "All of this is stored in LooseEnds' database. Your publik install key and any AI key you provide are encrypted there.",
    ],
  ],
  [
    "How your content is processed",
    [
      "To find tasks, write drafts and answer your questions, your content is sent to the AI model behind your chosen plan: through publik API, or to the provider of your own key. publik does not train on requests.",
      "Message content is treated as data, not instructions. Text inside an email can try to mislead the AI, so anything that changes something outside LooseEnds always waits for your approval, and the card shows exactly what will be sent.",
    ],
  ],
  [
    "Connected apps",
    [
      `You can connect ${APPS}. Every connection is optional.`,
      "Connections are made and held by Composio, which stores the access each app grants. LooseEnds does not see or keep your passwords.",
      "LooseEnds reads a connected app when you ask it something or ask it to check your inbox. It sends, posts, creates, changes or deletes something in a connected app only after you approve that exact action.",
      "You can disconnect any app in Settings.",
    ],
  ],
  [
    "Deleting your data",
    [
      "Delete a task, or delete a source to remove it together with every task found in it.",
      "Settings → Delete everything removes your data from LooseEnds' database, disconnects your connected apps, and signs out your browsers.",
    ],
  ],
  [
    "Sign in",
    [
      "LooseEnds uses Sign in with publik. publik counts that you used the app this week; it does not receive your messages or tasks except as AI requests you make.",
    ],
  ],
];

export default function Privacy() {
  return (
    <div className="mx-auto max-w-[680px] px-5 py-10 sm:px-8 sm:py-14">
      <Wordmark />
      <h1 className="mt-12 text-[36px] font-semibold tracking-[-0.03em]">Privacy</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">Plain-language summary of what happens to what you give LooseEnds.</p>
      <div className="mt-10 space-y-10">
        {SECTIONS.map(([h, items]) => (
          <section key={h}>
            <h2 className="text-[18px] font-semibold">{h}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-2">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-12 text-[14px] text-muted">
        LooseEnds is open source.{" "}
        <a className="text-accent-text underline underline-offset-2" href="https://github.com/jibberswrld/looseends">
          Read the code
        </a>
        .{" "}
        Read the <Link className="text-accent-text underline underline-offset-2" href="/terms">terms</Link>, or{" "}
        <Link className="text-accent-text underline underline-offset-2" href="/">go back home</Link>.
      </p>
    </div>
  );
}
