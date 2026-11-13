"use client";

import { Toaster } from "sonner";
import { Gate } from "@/components/app/gate";
import { Shell } from "@/components/app/shell";
import { StoreProvider } from "@/components/app/store";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Gate>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </Gate>
      <Toaster
        position="bottom-right"
        offset={{ bottom: 88, right: 16 }}
        mobileOffset={{ bottom: 84 }}
        toastOptions={{
          classNames: {
            toast: "!rounded-xl !border !border-line !bg-surface !text-ink !shadow-float !font-sans",
            description: "!text-muted",
            actionButton: "!bg-accent !text-accent-ink !rounded-lg",
          },
        }}
      />
    </>
  );
}
