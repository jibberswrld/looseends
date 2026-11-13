import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif-display", subsets: ["latin"], weight: ["400", "500"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "LooseEnds: the assistant for everyday admin",
    template: "%s · LooseEnds",
  },
  description:
    "Paste a message, email, screenshot or PDF. LooseEnds finds what needs doing, prepares the next step, and keeps you in control.",
  applicationName: "LooseEnds",
  openGraph: {
    title: "LooseEnds",
    description: "Turn messages and paperwork into a short list of things you can actually finish.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f5f0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} antialiased`}>
      <body className="min-h-[100dvh] bg-bg text-ink">{children}</body>
    </html>
  );
}
