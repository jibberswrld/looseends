"use client";

import { CaptureForm } from "@/components/app/capture";
import { Page, PageHeader } from "@/components/app/page-header";

export default function CapturePage() {
  return (
    <Page>
      <PageHeader title="What needs doing?" sub="Paste a message or add a screenshot or PDF. You review everything before it goes on your list." />
      <div className="mt-8">
        <CaptureForm />
      </div>
    </Page>
  );
}
