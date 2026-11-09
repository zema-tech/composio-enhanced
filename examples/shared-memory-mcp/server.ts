/**
 * Server MCP (stdio) con memoria condivisa + delega LLM opzionale.
 * Nessuna dipendenza: implementa il minimo del protocollo JSON-RPC di MCP.
 *
 * Più agenti (Claude Code, Cursor, ...) che avviano questo server con lo stesso MEMORY_FILE
 * condividono la stessa memoria. Il nome dell'agente (campo `author`) viene da MEMORY_AGENT
 * oppure da clientInfo.name inviato dal client in fase di initialize.
 *
 * Variabili d'ambiente:
 *   MEMORY_FILE          percorso del file JSON (default ./.shared-memory.json)
 *   MEMORY_AGENT         nome agente (opzionale)
 *   MEMORY_READ/WRITE    spazi consentiti, separati da virgola (default "*")
 *   GROQ_API_KEY | OPENROUTER_API_KEY   abilita delegate_llm
 *   DELEGATE_PROVIDER    "groq" (default) | "openrouter"
 *   DELEGATE_MODEL       modello di default (obbligatorio per openrouter)
 *   DELEGATE_ALLOWED_MODELS  elenco separato da virgola
 *   DELEGATE_MAX_CALLS / DELEGATE_MAX_TOKENS   budget per agente
 */

import { createInterface } from "node:readline";
import { MemoryStore, ScopedMemory } from "../../helpers/ts/shared-memory.ts";
import { createLLMDelegate } from "../../helpers/ts/llm-delegate.ts";
import { buildAgentTools } from "../../helpers/ts/agent-tools.ts";
import type { AgentTool } from "../../helpers/ts/agent-tools.ts";

const env = process.env;
const list = (v: string | undefined, d: string[]) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);
const log = (...a: unknown[]) => console.error("[shared-memory-mcp]", ...a); // stdout è riservato al protocollo

const store = new MemoryStore({ filePath: env.MEMORY_FILE ?? "./.shared-memory.json" });

let delegate;
const provider = (env.DELEGATE_PROVIDER ?? "groq") as "groq" | "openrouter";
const keyVar = provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY";
if (env[keyVar]) {
  try {
    delegate = createLLMDelegate({
      provider,
      defaultModel: env.DELEGATE_MODEL,
      allowedModels: env.DELEGATE_ALLOWED_MODELS ? list(env.DELEGATE_ALLOWED_MODELS, []) : undefined,
      budget: {
        maxCalls: env.DELEGATE_MAX_CALLS ? Number(env.DELEGATE_MAX_CALLS) : 50,
        maxTotalTokens: env.DELEGATE_MAX_TOKENS ? Number(env.DELEGATE_MAX_TOKENS) : 200_000,
      },
    });
  } catch (e: any) {
    log("delegate_llm disabilitato:", e.message);
  }
}

let tools: AgentTool[] = [];
let clientName = env.MEMORY_AGENT ?? "mcp-client";

function buildTools() {
  const memory = new ScopedMemory(store, {
    agent: clientName,
    read: list(env.MEMORY_READ, ["*"]),
    write: list(env.MEMORY_WRITE, ["*"]),
  });
  tools = buildAgentTools({ memory, delegate, agentId: clientName });
}
buildTools();

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg: any) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      if (!env.MEMORY_AGENT && params?.clientInfo?.name) {
        clientName = String(params.clientInfo.name);
        buildTools();
      }
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "shared-memory-mcp", version: "0.1.0" },
        },
      });
    }
    case "ping":
      return isRequest && send({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return send({
        jsonrpc: "2.0",
        id,
        result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) {
        return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Tool sconosciuto: ${params?.name}` } });
      }
      const r = await tool.execute(params?.arguments ?? {});
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(r) }], isError: !r.ok },
      });
    }
    default:
      if (isRequest) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Metodo non supportato: ${method}` } });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON non valido" } });
  }
  handle(msg).catch((e) => {
    log("errore:", e?.message ?? e);
    if (msg?.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Errore interno" } });
  });
});
log(`pronto (agente: ${clientName}, delegate_llm: ${delegate ? "on" : "off"})`);
