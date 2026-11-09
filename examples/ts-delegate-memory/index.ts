/**
 * Esempio senza framework: un agente che delega a Groq e usa la memoria condivisa.
 *
 *   GROQ_API_KEY=gsk_... node examples/ts-delegate-memory/index.ts
 */

import { createLLMDelegate } from "../../helpers/ts/llm-delegate.ts";
import { MemoryStore, ScopedMemory } from "../../helpers/ts/shared-memory.ts";
import { buildAgentTools, runTool, toOpenAITools } from "../../helpers/ts/agent-tools.ts";

// 1) Delegato: la TUA chiave Groq, con budget e whitelist di modelli.
const delegate = createLLMDelegate({
  provider: "groq", // legge GROQ_API_KEY
  allowedModels: ["llama-3.3-70b-versatile"],
  budget: { maxCalls: 20, maxTotalTokens: 50_000 },
});

// 2) Memoria su file condivisibile tra agenti, con permessi per agente.
const store = new MemoryStore({ filePath: "./.shared-memory.json" });
const memory = new ScopedMemory(store, {
  agent: "claude",
  read: ["personal", "project:*"],
  write: ["project:*"],
});

// 3) Tool pronti per qualsiasi framework (formato OpenAI-compatibile).
const tools = buildAgentTools({ delegate, memory });
console.log("Tool disponibili:", toOpenAITools(tools).map((t) => t.function.name));

await runTool(tools, "memory_write", {
  space: "project:acme",
  text: "Il cliente Acme vuole report brevi in italiano",
  source: "user_said",
  tags: ["acme", "report"],
});

const found: any = await runTool(tools, "memory_search", { query: "report acme" });
console.log(found.summary);

const out: any = await runTool(tools, "delegate_llm", {
  prompt: "Riassumi in una frase: la memoria condivisa permette a più agenti di ricordare le stesse cose.",
});
console.log(out.ok ? out.text : `Errore: ${out.error}`);
console.log("Consumo:", delegate.usage("claude"));
