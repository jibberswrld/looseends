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
    "Ask about your inbox or tell it what to do. LooseEnds works across Gmail, your calendar and your other apps, gets the next step ready, and sends nothing until you approve.",
  applicationName: "LooseEnds",
  // The share image is src/app/opengraph-image.jpg and twitter-image.jpg (1200x630, a real screenshot).
  openGraph: {
    title: "LooseEnds",
    description: "Turn messages and paperwork into a short list of things you can actually finish.",
    type: "website",
    siteName: "LooseEnds",
  },
  twitter: {
    card: "summary_large_image",
    title: "LooseEnds",
    description: "Turn messages and paperwork into a short list of things you can actually finish.",
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
