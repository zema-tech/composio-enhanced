# Memoria condivisa e "second brain" per più agenti

Idea: una sola memoria letta e scritta da tutti i tuoi agenti. Quello che impara Claude lo sa anche Grok.

Codice: [`helpers/ts/shared-memory.ts`](../helpers/ts/shared-memory.ts) · tool: [`helpers/ts/agent-tools.ts`](../helpers/ts/agent-tools.ts) ·
server MCP: [`examples/shared-memory-mcp`](../examples/shared-memory-mcp/README.md)

## Modello dei dati

Ogni voce ha: `space`, `text`, `tags`, `author` (quale agente l'ha scritta), `origin`
(`user` | `agent` | `external`), `verified`, date e scadenza opzionale.

**Spazi**: `personal`, `project:<nome>`, `team:<nome>`. Ogni agente ha una policy `read`/`write` con pattern
(`"personal"`, `"project:*"`, `"*"`).

```ts
import { MemoryStore, ScopedMemory } from "./helpers/ts/shared-memory.ts";

const store = new MemoryStore({ filePath: "./.shared-memory.json" });
const claude = new ScopedMemory(store, { agent: "claude", read: ["personal", "project:*"], write: ["project:*"] });

await claude.write({ space: "project:acme", text: "Deadline il 20 novembre", tags: ["acme"] });
const hits = await claude.search({ query: "deadline acme" });
```

## Sicurezza (il punto delicato)

Una memoria condivisa è un bersaglio per la **prompt injection**: un'email malevola potrebbe far scrivere all'agente un
"ricordo" falso che poi influenza tutti gli altri agenti. Per questo:

- **Quarantena**: le voci con `origin: "external"` (da email, pagine web, output di tool) nascono `verified: false` e
  **non vengono mai restituite agli agenti** finché un umano non chiama `store.verify(id)`.
- Il tool `memory_write` obbliga l'agente a dichiarare la fonte: `user_said`, `own_reasoning` o `external_content`.
- **Segreti rifiutati**: chiavi API (Groq, OpenRouter, OpenAI/Anthropic, GitHub, AWS), token Bearer e chiavi private non vengono salvati.
- **Permessi per spazio** e cancellazione limitata agli spazi scrivibili.
- **Controllo dell'utente**: `store.list({ includeUnverified: true })`, `update`, `verify`, `forget`, `ttlDays`.

Limite onesto: la quarantena funziona se l'agente dichiara correttamente la fonte. Un agente già compromesso potrebbe
mentire; per questo le voci portano sempre `author` e data, e i permessi per spazio limitano il danno.
Abbinala a un firewall sui tool result, se ne usi uno.

## Concorrenza

Più processi possono usare lo stesso file: ogni scrittura prende un lock (`.lock`), rilegge il file, modifica e
sostituisce il file in modo atomico. È testato con scritture concorrenti da due store. Per carichi alti o più macchine
conviene sostituire `MemoryStore` con un database (stessa interfaccia: `write/search/list/get/update/verify/forget`).

## Ricerca

Lessicale, senza dipendenze (accenti normalizzati, prefissi, tag). Non è semantica: "auto" non trova "macchina".
Per la ricerca semantica implementa `search` con embeddings.

## Second brain: cosa manca

L'indicizzazione automatica di Gmail/Notion/Slack **non è inclusa**: richiede permessi espliciti per app e una scelta su
cosa conservare. Il punto di aggancio è `memory_write` con `source: "external_content"` (quarantena inclusa).

## Limiti attuali

- Il server MCP usa **stdio**: va bene per client locali (Claude Code, Cursor). Per agenti remoti serve un trasporto
  HTTP, non ancora implementato.
- Solo TypeScript.
- Non è integrata nel backend di Composio: è un livello che puoi mettere accanto a Composio.
