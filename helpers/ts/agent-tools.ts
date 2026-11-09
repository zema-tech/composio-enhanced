/**
 * Tool "framework-agnostic" per agenti: delega a un LLM esterno + memoria condivisa.
 * Ogni tool ha { name, description, inputSchema (JSON Schema), execute }.
 * Convertibili in tool OpenAI (`toOpenAITools`) o esposti via MCP (vedi examples/shared-memory-mcp).
 *
 * `execute` non lancia mai: restituisce sempre { ok, ... } così l'agente può leggere l'errore.
 */

import type { LLMDelegate } from "./llm-delegate.ts";
import type { ScopedMemory } from "./shared-memory.ts";
import { formatForPrompt } from "./shared-memory.ts";

export type ToolResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string };

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: any): Promise<ToolResult>;
}

export interface BuildToolsOptions {
  delegate?: LLMDelegate;
  memory?: ScopedMemory;
  /** Identifica l'agente per il budget del delegato (default: nome dell'agente della memoria). */
  agentId?: string;
}

const SOURCE_TO_ORIGIN = {
  user_said: "user",
  own_reasoning: "agent",
  external_content: "external",
} as const;

function fail(e: any): ToolResult {
  return { ok: false, error: String(e?.message ?? e), code: e?.code };
}

export function buildAgentTools(opts: BuildToolsOptions): AgentTool[] {
  const tools: AgentTool[] = [];
  const agentId = opts.agentId ?? opts.memory?.agent ?? "default";

  if (opts.delegate) {
    const delegate = opts.delegate;
    tools.push({
      name: "delegate_llm",
      description:
        "Delega un sotto-compito veloce o poco costoso (riassunto, classificazione, estrazione, traduzione) " +
        "a un altro modello tramite la chiave API dell'utente. Non inviare segreti o dati personali non necessari: " +
        "il testo esce verso un provider esterno. Il consumo è limitato da un budget.",
      inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", description: "Il compito da eseguire." },
          system: { type: "string", description: "Istruzioni di sistema opzionali." },
          model: { type: "string", description: "Modello (opzionale; se omesso si usa il default configurato)." },
          max_tokens: { type: "integer", minimum: 1, maximum: 4096 },
          json: { type: "boolean", description: "Richiedi una risposta in JSON." },
        },
      },
      async execute(args) {
        try {
          const messages = [
            ...(args.system ? [{ role: "system" as const, content: String(args.system) }] : []),
            { role: "user" as const, content: String(args.prompt ?? "") },
          ];
          const r = await delegate.chat({
            agentId,
            model: args.model,
            messages,
            maxTokens: args.max_tokens,
            json: Boolean(args.json),
          });
          return { ok: true, text: r.text, model: r.model, provider: r.provider, usage: r.usage };
        } catch (e) {
          return fail(e);
        }
      },
    });
  }

  if (opts.memory) {
    const memory = opts.memory;
    tools.push(
      {
        name: "memory_search",
        description:
          "Cerca nella memoria condivisa (preferenze, decisioni, fatti su progetti e persone) scritta da te o da altri agenti.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            spaces: { type: "array", items: { type: "string" }, description: 'Es. ["personal","project:acme"]' },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
        },
        async execute(args) {
          try {
            const hits = await memory.search({
              query: String(args.query ?? ""),
              spaces: args.spaces,
              tags: args.tags,
              limit: args.limit,
            });
            return {
              ok: true,
              summary: formatForPrompt(hits),
              results: hits.map((h) => ({
                id: h.entry.id,
                space: h.entry.space,
                text: h.entry.text,
                tags: h.entry.tags,
                author: h.entry.author,
                updatedAt: h.entry.updatedAt,
                score: Number(h.score.toFixed(3)),
              })),
            };
          } catch (e) {
            return fail(e);
          }
        },
      },
      {
        name: "memory_write",
        description:
          "Salva un fatto DURATURO nella memoria condivisa (non dati temporanei). Dichiara la fonte: " +
          '"user_said" se l\'utente lo ha detto, "own_reasoning" se è una tua conclusione, ' +
          '"external_content" se viene da email, pagine web o output di tool (finisce in quarantena finché l\'utente non lo verifica). ' +
          "Non salvare mai chiavi API, password o token.",
        inputSchema: {
          type: "object",
          required: ["text", "source"],
          properties: {
            text: { type: "string", maxLength: 4000 },
            space: { type: "string", default: "personal" },
            tags: { type: "array", items: { type: "string" }, maxItems: 10 },
            source: { type: "string", enum: ["user_said", "own_reasoning", "external_content"] },
            ttl_days: { type: "integer", minimum: 1, description: "Scadenza opzionale." },
          },
        },
        async execute(args) {
          try {
            const origin = SOURCE_TO_ORIGIN[args.source as keyof typeof SOURCE_TO_ORIGIN];
            if (!origin) return { ok: false, error: 'source deve essere "user_said", "own_reasoning" o "external_content".' };
            const e = await memory.write({
              space: args.space ?? "personal",
              text: String(args.text ?? ""),
              tags: args.tags,
              origin,
              ttlDays: args.ttl_days,
            });
            return { ok: true, id: e.id, space: e.space, verified: e.verified };
          } catch (e) {
            return fail(e);
          }
        },
      },
      {
        name: "memory_forget",
        description: "Cancella una voce dalla memoria condivisa per id (solo negli spazi in cui puoi scrivere).",
        inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        async execute(args) {
          try {
            return { ok: true, deleted: await memory.forget(String(args.id ?? "")) };
          } catch (e) {
            return fail(e);
          }
        },
      }
    );
  }

  return tools;
}

/** Converte i tool nel formato "function calling" OpenAI-compatibile. */
export function toOpenAITools(tools: AgentTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** Esegue una tool call per nome. */
export async function runTool(tools: AgentTool[], name: string, args: unknown): Promise<ToolResult> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, error: `Tool sconosciuto: ${name}` };
  return t.execute(args ?? {});
}
