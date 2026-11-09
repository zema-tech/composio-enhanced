import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

function startServer(file: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = { ...(process.env as any), MEMORY_FILE: file, ...extraEnv };
  delete env.GROQ_API_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.MEMORY_AGENT;
  Object.assign(env, extraEnv);
  const p = spawn(process.execPath, ["examples/shared-memory-mcp/server.ts"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (m: any) => void>();
  createInterface({ input: p.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let next = 1;
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = next++;
      const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 8000);
      pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return { rpc, close: () => p.kill() };
}

test("due client MCP diversi condividono la stessa memoria", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-"));
  const file = join(dir, "shared.json");
  const a = startServer(file);
  const b = startServer(file);
  try {
    const init = await a.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } });
    assert.equal(init.result.serverInfo.name, "shared-memory-mcp");
    await b.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cursor", version: "1" } });

    const list = await a.rpc("tools/list");
    assert.deepEqual(list.result.tools.map((t: any) => t.name), ["memory_search", "memory_write", "memory_forget"]); // niente delegate senza chiave

    const w = await a.rpc("tools/call", { name: "memory_write", arguments: { text: "Il deploy si fa il venerdì mattina", space: "project:acme", source: "user_said" } });
    assert.equal(w.result.isError, false);

    const r = await b.rpc("tools/call", { name: "memory_search", arguments: { query: "deploy venerdì" } });
    const payload = JSON.parse(r.result.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].author, "claude-code"); // provenienza dal clientInfo

    const bad = await b.rpc("tools/call", { name: "nope", arguments: {} });
    assert.equal(bad.error.code, -32602);
  } finally {
    a.close();
    b.close();
  }
});

test("con chiave Groq compare delegate_llm", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-"));
  const s = startServer(join(dir, "m.json"), { GROQ_API_KEY: "gsk_TESTKEY1234567890abcdefghij" });
  try {
    await s.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grok", version: "1" } });
    const list = await s.rpc("tools/list");
    assert.ok(list.result.tools.some((t: any) => t.name === "delegate_llm"));
  } finally {
    s.close();
  }
});
