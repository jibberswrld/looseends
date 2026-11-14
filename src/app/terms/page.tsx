import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

export const metadata: Metadata = { title: "Terms" };

const ISSUES = "https://github.com/jibberswrld/looseends/issues";

const SECTIONS: [string, string[]][] = [
  [
    "Using LooseEnds",
    [
      "LooseEnds is a free, open-source app provided as is, without any warranty. Use it at your own risk.",
      "It may change, break, or stop running at any time, and your data may not be kept forever. Keep your own copy of anything important.",
    ],
  ],
  [
    "You approve what happens",
    [
      "LooseEnds proposes actions such as sending an email, posting a message, adding an event, or changing or deleting something in an app you connected. Nothing happens until you approve it.",
      "You are responsible for every action you approve. Read the card, including its Details, before you press the button.",
    ],
  ],
  [
    "AI can be wrong",
    [
      "Tasks, dates, drafts and answers are written by an AI model and can be wrong or incomplete. Check anything that matters against the original message.",
      "AI use is billed to your own publik plan or your own API key, under their terms.",
    ],
  ],
  [
    "Acceptable use",
    [
      "Use LooseEnds only with accounts and messages you are allowed to use.",
      "Don't use it to send spam, harass anyone, break the law, or get around the limits of LooseEnds, publik, or the apps you connect.",
      "Don't try to break, overload or get into parts of the service that aren't yours.",
    ],
  ],
  [
    "Your data",
    ["What LooseEnds stores and how to delete it is described in the privacy page."],
  ],
];

export default function Terms() {
  return (
    <div className="mx-auto max-w-[680px] px-5 py-10 sm:px-8 sm:py-14">
      <Wordmark />
      <h1 className="mt-12 text-[36px] font-semibold tracking-[-0.03em]">Terms</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">The short, plain-English version of the rules for using LooseEnds.</p>
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
        Questions or problems?{" "}
        <a className="text-accent-text underline underline-offset-2" href={ISSUES}>
          Open an issue on GitHub
        </a>
        . Read the <Link className="text-accent-text underline underline-offset-2" href="/privacy">privacy page</Link>, or{" "}
        <Link className="text-accent-text underline underline-offset-2" href="/">go back home</Link>.
      </p>
    </div>
  );
}
