/**
 * Esempio minimo TypeScript con helper di questo repo.
 *
 * npm install @composio/core @composio/openai-agents @openai/agents
 * npx tsx index.ts
 */

import { Composio } from "@composio/core";
import { OpenAIAgentsProvider } from "@composio/openai-agents";
import { Agent, run } from "@openai/agents";
import { createSessionWithRetry } from "../../helpers/ts/session";
import { safeExecute } from "../../helpers/ts/safe-execute";

async function main() {
  const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
    provider: new OpenAIAgentsProvider(),
  });

  const session = await createSessionWithRetry(composio, {
    userId: "demo-user",
    toolkits: ["gmail"], // limita il context
  });

  console.log("Session ID:", session.session_id);

  const tools = await session.tools();

  const agent = new Agent({
    name: "Demo Assistant",
    instructions: "Rispondi in italiano. Usa i tool solo se necessario.",
    tools,
  });

  const result = await safeExecute(() =>
    run(agent, "Quante email non lette ho?")
  );

  if (result.ok) {
    console.log("Output:", (result.data as any).finalOutput);
  } else {
    console.error("Errore:", result.error);
    if (result.inputRequired) {
      console.log("L'utente deve fornire input aggiuntivo:", result.inputRequired);
    }
  }
}

main().catch(console.error);
