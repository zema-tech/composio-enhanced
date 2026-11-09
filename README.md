# Composio Enhanced

> Miglioramenti, helper DX e documentazione in italiano basati su [ComposioHQ/composio](https://github.com/ComposioHQ/composio).

**Repository originale**: [ComposioHQ/composio](https://github.com/ComposioHQ/composio) (≈31k stars)  
**Questo repo**: estensioni pratiche, guide in italiano, helper per agent e note di miglioramento.

---

## Perché questo repo?

Il monorepo ufficiale di Composio è ottimo ma molto grande (TS + Python + CLI + docs).  
Qui trovi:

1. **Documentazione in italiano** chiara e orientata agli agent
2. **Helper e pattern** per usare meglio le sessioni e i meta-tool
3. **Analisi dei punti deboli** attuali (da issue tracker)
4. **Esempi minimi** pronti all’uso (TypeScript + Python)
5. **Idee di integrazione** con progetti MCP open-source (es. OmniMCP)

---

## Cos’è Composio (in breve)

Composio fornisce agli AI agent:

- **1000+ toolkit** pre-autenticati (Gmail, Slack, GitHub, Notion, …)
- **Sessioni per utente** (`composio.create(user_id)`)
- **Meta-tool** che scoprono, autenticano ed eseguono tool a runtime (non carichi centinaia di definizioni nel context)
- **Provider** per OpenAI Agents, Claude Agent SDK, Vercel AI SDK, LangChain, ecc.
- **CLI** e endpoint **MCP** hosted

### Quickstart ufficiale (TypeScript)

```bash
npm install @composio/core @composio/openai-agents @openai/agents
```

```ts
import { Composio } from "@composio/core";
import { OpenAIAgentsProvider } from "@composio/openai-agents";
import { Agent, run } from "@openai/agents";

const composio = new Composio({ provider: new OpenAIAgentsProvider() });
const session = await composio.create("user_123");
const tools = await session.tools();

const agent = new Agent({
  name: "Assistente",
  instructions: "Usa i tool Composio per agire.",
  tools,
});

const result = await run(agent, "Riassumi le email di oggi");
console.log(result.finalOutput);
```

### Quickstart ufficiale (Python)

```bash
pip install composio composio-openai-agents openai-agents
```

```python
from composio import Composio
from composio_openai_agents import OpenAIAgentsProvider
from agents import Agent, Runner

composio = Composio(provider=OpenAIAgentsProvider())
session = composio.create(user_id="user_123")
tools = session.tools()

agent = Agent(
    name="Assistente",
    instructions="Usa i tool Composio per agire.",
    tools=tools,
)

result = Runner.run_sync(starting_agent=agent, input="Riassumi le email di oggi")
print(result.final_output)
```

---

## Miglioramenti di questo repo

### 1. Documentazione in italiano
Vedi cartella [`docs-it/`](docs-it/).

### 2. Helper TypeScript (`helpers/`)
- `createSessionWithRetry` — retry automatico su errori di rete / rate-limit
- `filterToolsByToolkit` — riduce il context caricando solo i toolkit necessari
- `safeExecute` — wrapper che normalizza errori e input_required

### 3. Pattern consigliati
- Usa **sempre** `session_id` e `composio.use(session_id)` tra i turni
- Preferisci i **meta-tool** (search + execute) invece di caricare tutti i tool
- Per MCP: passa `mcp: true` a `create()` e usa `session.mcp.url`

### 4. Problemi noti (novembre 2026)
Dal tracker ufficiale:
- Alcuni toolkit (Alpaca paper trading, Cloudflare Workers API token, Google Drive shared XLSX) hanno bug di auth o staging
- Hosted MCP a volte restituisce `data_preview` invece dei dati completi per risposte grandi
- Mancano ancora alcuni toolkit richiesti (OneNote, ZeptoMail multi-region, …)

Questo repo non risolve i bug backend, ma fornisce workaround e pattern più robusti lato client.

---

## Novità: delega a Groq/OpenRouter e memoria condivisa

Due funzioni pensate per agenti diversi (Claude, Grok, Codex, Cursor…) che lavorano con gli stessi strumenti:

1. **Delega LLM con la tua chiave** (`helpers/ts/llm-delegate.ts`): un agente può passare i sotto-compiti veloci a Groq o
   OpenRouter usando la tua chiave API, con budget per agente, whitelist di modelli e chiave mai esposta.
   Guida: [`docs-it/delegare-a-groq-openrouter.md`](docs-it/delegare-a-groq-openrouter.md)
2. **Memoria condivisa / second brain** (`helpers/ts/shared-memory.ts`): spazi (`personal`, `project:*`, `team:*`),
   provenienza per agente, quarantena dei contenuti esterni contro la prompt injection, rifiuto dei segreti, file condivisibile.
   Guida: [`docs-it/memoria-condivisa.md`](docs-it/memoria-condivisa.md)
3. **Server MCP** (`examples/shared-memory-mcp/`) che espone memoria e delega a qualsiasi client MCP con trasporto stdio.

Tool pronti per qualsiasi framework in `helpers/ts/agent-tools.ts`. Test: `npm test` (Node >= 22.18, nessuna dipendenza).
Queste funzioni sono livelli lato client accanto a Composio, **non** modifiche al suo backend.

---

## Struttura del repo

```text
composio-enhanced/
├── README.md                 # questo file
├── docs-it/                  # documentazione in italiano
│   ├── quickstart.md
│   ├── sessioni-e-meta-tool.md
│   └── pattern-agent.md
├── helpers/
│   ├── ts/                   # helper TypeScript
│   └── python/               # helper Python
├── examples/
│   ├── ts-minimal/
│   └── python-minimal/
└── ANALYSIS.md               # analisi tecnica del monorepo originale
```

---

## Come contribuire / usare

1. Clona questo repo
2. Usa gli helper e gli esempi come base
3. Per modifiche al core SDK → apri issue sul repo ufficiale e segui `CONTRIBUTING.md` di ComposioHQ

---

## Licenza

MIT (come il progetto originale).  
Il codice ufficiale di Composio rimane proprietà di ComposioHQ; questo repo contiene solo documentazione, helper e esempi aggiuntivi.

---

**Autore**: [zema-tech](https://github.com/zema-tech)  
**Progetti correlati**: [omni-mcp](https://github.com/zema-tech/omni-mcp) (alternativa MCP-native open-source)
