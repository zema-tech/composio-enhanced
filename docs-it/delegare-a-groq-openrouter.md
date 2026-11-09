# Delegare sotto-compiti a Groq / OpenRouter con la tua chiave

Idea: colleghi **una volta** la tua chiave Groq (o OpenRouter) e qualsiasi agente (Claude, Grok, Codex, Cursor…) può
usare quei modelli per i sotto-compiti veloci ed economici, mentre il ragionamento difficile resta all'agente principale.

Codice: [`helpers/ts/llm-delegate.ts`](../helpers/ts/llm-delegate.ts) · tool pronti: [`helpers/ts/agent-tools.ts`](../helpers/ts/agent-tools.ts)

## Uso rapido

```ts
import { createLLMDelegate } from "./helpers/ts/llm-delegate.ts";

const groq = createLLMDelegate({
  provider: "groq",                         // legge GROQ_API_KEY
  allowedModels: ["llama-3.3-70b-versatile"],
  budget: { maxCalls: 50, maxTotalTokens: 200_000 },
});

const r = await groq.chat({
  agentId: "claude",                        // il budget è per agente
  messages: [{ role: "user", content: "Classifica questa email: ..." }],
  json: true,
});
console.log(r.text, r.usage);
```

OpenRouter: `provider: "openrouter"` (legge `OPENROUTER_API_KEY`). Qui **devi** indicare il modello
(`defaultModel` o `model` nella chiamata), perché non esiste un default sensato. Per altri servizi OpenAI-compatibili
usa `provider: "custom"` con `baseUrl` e `apiKey`.

## Cosa protegge

| Rischio | Protezione |
|---|---|
| Un agente in loop brucia la chiave | `budget.maxCalls` e `budget.maxTotalTokens`, **per agente** |
| Uso di modelli costosi non previsti | `allowedModels` (whitelist) |
| Fuga della chiave | Non finisce mai in errori, log o risultati (viene sostituita con `[REDACTED]`) |
| Abuso dell'account provider | Espone solo le chat completions: niente batch, fine-tuning o gestione chiavi |
| Risposte lente o instabili | Timeout, retry con backoff su 429/5xx (rispetta `Retry-After`) |

Il tetto sui token è "morbido": il consumo reale si conosce a risposta ricevuta, quindi l'ultima chiamata può superarlo
leggermente. `maxOutputTokens` limita la singola risposta.

## Come usarlo da più agenti

1. **Stesso processo / framework**: `buildAgentTools({ delegate })` ti dà il tool `delegate_llm` (convertibile con `toOpenAITools`).
2. **Agenti diversi (Claude Code, Cursor, …)**: avvia il server MCP in
   [`examples/shared-memory-mcp`](../examples/shared-memory-mcp/README.md) con `GROQ_API_KEY` impostata: espone
   `delegate_llm` insieme alla memoria condivisa.

## Privacy

Il testo passato a `delegate_llm` **esce verso Groq/OpenRouter**. La descrizione del tool avvisa l'agente di non
inviare segreti o dati personali non necessari, ma la decisione finale è tua: usa `allowedModels` e valuta le policy di
conservazione dei dati del provider.

## Limiti attuali

- Non è una funzione del backend di Composio: la chiave vive nel **tuo** ambiente (variabile d'ambiente o secret manager),
  non nel vault di Composio.
- Solo TypeScript (nessun equivalente Python per ora).
- Nessun streaming e nessun tool-calling lato modello delegato: è pensato per sotto-compiti a singolo passaggio.
