import type { Connections } from "@/lib/types";
import { TOOLKITS } from "./composio";
import { connectorStatus } from "./connector";
import type { Row } from "./db";

/** GET /api/connections. Never throws for a connector that is down or not configured. */
export async function loadConnections(user: Row): Promise<Connections> {
  const lastScanAt = user.gmail_last_scan_at ? new Date(user.gmail_last_scan_at).toISOString() : null;
  const r = await connectorStatus();
  if (!r.ok) return { available: false, message: r.message, apps: TOOLKITS.map((slug) => ({ slug, name: slug, logo: null, connected: false })), gmail: { connected: false, lastScanAt }, googlecalendar: { connected: false } };
  return { available: true, message: null, apps: r.data.apps, gmail: { connected: !!r.data.gmail, lastScanAt }, googlecalendar: { connected: !!r.data.googlecalendar } };
}
