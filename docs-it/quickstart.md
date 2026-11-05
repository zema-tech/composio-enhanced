# Quickstart Composio (italiano)

## 1. Ottieni la API key

Vai su [dashboard.composio.dev](https://dashboard.composio.dev/settings) e crea una `COMPOSIO_API_KEY`.

```bash
export COMPOSIO_API_KEY=ck_...
```

## 2. TypeScript (consigliato per agent moderni)

```bash
npm install @composio/core @composio/openai-agents @openai/agents
# oppure la versione slim
npm install @composio/slim
```

```ts
import { Composio } from "@composio/core";
import { OpenAIAgentsProvider } from "@composio/openai-agents";
import { Agent, run } from "@openai/agents";

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new OpenAIAgentsProvider(),
});

// Crea una sessione legata a un tuo utente
const session = await composio.create("utente_42");

// I tool vengono scoperti a runtime (meta-tool)
const tools = await session.tools();

const agent = new Agent({
  name: "Assistente personale",
  instructions: "Sei un assistente utile. Usa i tool Composio quando serve agire.",
  tools,
});

const result = await run(agent, "Controlla se ci sono email importanti oggi");
console.log(result.finalOutput);

// Salva session.session_id e riusalo con composio.use(id) nei turni successivi
```

## 3. Python

```bash
pip install composio composio-openai-agents openai-agents
```

```python
from composio import Composio
from composio_openai_agents import OpenAIAgentsProvider
from agents import Agent, Runner

composio = Composio(
    api_key=os.environ["COMPOSIO_API_KEY"],
    provider=OpenAIAgentsProvider(),
)

session = composio.create(user_id="utente_42")
tools = session.tools()

agent = Agent(
    name="Assistente personale",
    instructions="Sei un assistente utile. Usa i tool Composio quando serve agire.",
    tools=tools,
)

result = Runner.run_sync(
    starting_agent=agent,
    input="Controlla se ci sono email importanti oggi",
)
print(result.final_output)
```

## 4. CLI

```bash
curl -fsSL https://composio.dev/install | sh
composio login
composio search gmail
composio execute GMAIL_FETCH_EMAILS --param maxResults=5
```

## 5. MCP (Claude, Cursor, ecc.)

```ts
const session = await composio.create("utente_42", { mcp: true });
console.log(session.mcp.url); // passa questo URL al client MCP
```
