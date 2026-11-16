import type { AgentRun } from "@/lib/types";
import { converse, messages } from "./agent";
import { sql, type Row } from "./db";
import { HttpError } from "./http";
import type { Ctx } from "./session";

const runOf = (r: Row): AgentRun => ({ id: r.id, task: r.task, status: r.status, error: r.error, topUpUrl: r.top_up_url, createdAt: new Date(r.created_at).toISOString() });

async function expireRuns(userId: string) {
  await sql`update agent_runs set status = 'failed', error = 'This agent was interrupted. Start a new agent to continue; check any pending actions first.', finished_at = now()
    where user_id = ${userId} and status = 'running' and created_at < now() - interval '6 minutes'`;
}

export async function listRuns(userId: string): Promise<AgentRun[]> {
  await expireRuns(userId);
  const rows = await sql`select r.*, case when r.status = 'completed' and exists (
    select 1 from agent_messages m join agent_actions a on a.message_id = m.id where m.run_id = r.id and a.status = 'pending'
  ) then 'needs_approval' else r.status end as status from agent_runs r where r.user_id = ${userId} order by r.created_at desc, r.id desc limit 100`;
  return rows.map(runOf);
}

export async function loadRun(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "Agent not found.");
  await expireRuns(userId);
  const row = (await sql`select * from agent_runs where id = ${id} and user_id = ${userId}`)[0];
  if (!row) throw new HttpError(404, "not_found", "Agent not found.");
  const history = await messages(userId, id);
  const run = runOf(row);
  if (run.status === "completed" && history.some((m) => m.actions.some((a) => a.status === "pending"))) run.status = "needs_approval";
  return { run, messages: history };
}

export async function createRun(userId: string, task: string): Promise<AgentRun> {
  const rows = await sql`insert into agent_runs (user_id, task) values (${userId}, ${task}) returning *`;
  return runOf(rows[0]);
}

export async function executeRun(ctx: Ctx, run: AgentRun): Promise<void> {
  try {
    await converse(ctx, run.task, () => {}, run.id);
    await sql`update agent_runs set status = 'completed', finished_at = now() where id = ${run.id} and user_id = ${ctx.user.id} and status = 'running'`;
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "This agent couldn't finish. Start another agent to try again.";
    await sql`update agent_runs set status = 'failed', error = ${message}, top_up_url = ${e instanceof HttpError ? e.topUpUrl : null}, finished_at = now() where id = ${run.id} and user_id = ${ctx.user.id} and status = 'running'`;
  }
}
