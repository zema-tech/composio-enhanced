# Server MCP: memoria condivisa + delega LLM

Senza dipendenze. Richiede Node >= 22.18 (esegue TypeScript direttamente).

```bash
MEMORY_FILE=$HOME/.agent-memory.json node examples/shared-memory-mcp/server.ts
```

Tool esposti: `memory_search`, `memory_write`, `memory_forget` e, se imposti `GROQ_API_KEY` (o `OPENROUTER_API_KEY` con
`DELEGATE_PROVIDER=openrouter` e `DELEGATE_MODEL`), anche `delegate_llm`.

## Collegarlo a un client (esempio Claude Code)

```bash
claude mcp add shared-memory --env MEMORY_FILE=$HOME/.agent-memory.json -- node /percorso/composio-enhanced/examples/shared-memory-mcp/server.ts
```

Altri client MCP con trasporto stdio: stesso comando e variabili d'ambiente. Se più client usano lo stesso `MEMORY_FILE`,
condividono la memoria; il campo `author` viene dal nome del client (oppure da `MEMORY_AGENT`).

## Variabili d'ambiente

| Variabile | Significato |
|---|---|
| `MEMORY_FILE` | File JSON della memoria (default `./.shared-memory.json`) |
| `MEMORY_AGENT` | Nome agente (altrimenti `clientInfo.name`) |
| `MEMORY_READ` / `MEMORY_WRITE` | Spazi consentiti, separati da virgola (default `*`) |
| `DELEGATE_PROVIDER` | `groq` (default) o `openrouter` |
| `DELEGATE_MODEL` | Modello di default (obbligatorio con openrouter) |
| `DELEGATE_ALLOWED_MODELS` | Whitelist, separata da virgola |
| `DELEGATE_MAX_CALLS` / `DELEGATE_MAX_TOKENS` | Budget per agente (default 50 / 200000) |

Test: `npm test` (usa il test runner di Node, nessuna installazione).
Limiti e sicurezza: vedi [`docs-it/memoria-condivisa.md`](../../docs-it/memoria-condivisa.md).
