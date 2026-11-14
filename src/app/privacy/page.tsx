import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS: [string, string[]][] = [
  [
    "What LooseEnds stores",
    [
      "The text of messages you paste, the text read from screenshots, and the text extracted from PDFs. Image and PDF files themselves are not kept.",
      "The tasks, drafts, calendar events and reminders created from them, and receipts of what you did with them.",
      "Your list is stored in LooseEnds' database. Your publik install key and any AI key you provide are encrypted there.",
      "Your publik handle, time zone, and simple usage events (without message content) are stored there too.",
    ],
  ],
  [
    "How your content is processed",
    [
      "To find tasks and write drafts, your content is sent to the AI model behind your chosen plan: publik API, or the provider of your own key. publik does not train on requests.",
      "Message content is treated as data. Instructions inside a message can't make LooseEnds do anything.",
      "Gmail and Google Calendar are optional. If you connect them (through Composio), LooseEnds reads recent inbox mail when you ask it to check, and sends a reply or adds an event only after you confirm that exact preview. You can disconnect in Settings.",
    ],
  ],
  [
    "Deleting your data",
    [
      "Delete a task, or delete a source to remove it together with every task found in it.",
      "Settings → Delete everything removes your data from LooseEnds' database and signs out your browsers.",
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
        </a>{" "}
        or <Link className="text-accent-text underline underline-offset-2" href="/">go back home</Link>.
      </p>
    </div>
  );
}
