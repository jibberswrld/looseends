"use client";

import { Toaster } from "sonner";
import { AgentProvider } from "@/components/app/agent";
import { Gate } from "@/components/app/gate";
import { Shell } from "@/components/app/shell";
import { StoreProvider } from "@/components/app/store";
import { WorkProvider } from "@/components/app/work";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Gate>
        <StoreProvider>
          <WorkProvider>
            <AgentProvider>
              <Shell>{children}</Shell>
            </AgentProvider>
          </WorkProvider>
        </StoreProvider>
      </Gate>
      <Toaster
        position="bottom-right"
        offset={{ bottom: 88, right: 16 }}
        mobileOffset={{ bottom: 84 }}
        toastOptions={{
          classNames: {
            toast: "!rounded-lg !border !border-line !bg-surface !text-ink !shadow-float !font-sans",
            description: "!text-muted",
            actionButton: "!bg-accent !text-accent-ink !rounded-lg",
          },
        }}
      />
    </>
  );
}
