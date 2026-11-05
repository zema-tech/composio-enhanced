# Pattern consigliati per agent

## 1. Retry + gestione errori

Gli errori di rete e i 429 sono comuni. Usa sempre un wrapper:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as any)?.status ?? (err as any)?.response?.status;
      if (status === 429 || status >= 500) {
        await new Promise(r => setTimeout(r, 500 * 2 ** i));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
```

## 2. Gestire `input_required`

Alcuni tool richiedono input aggiuntivi dall’utente (conferme, scelta account, ecc.).  
Il provider dovrebbe propagare chiaramente questo stato invece di restituire un successo vuoto.

## 3. Preferisci MCP quando possibile

Se il tuo agent parla già MCP (Claude, Cursor, custom), usa:

```ts
const session = await composio.create(userId, { mcp: true });
// passa session.mcp.url al client MCP
```

Meno codice, stessa potenza.

## 4. Non caricare tutto

```ts
// male
const tools = await session.tools(); // può essere molto grande

// meglio
const tools = await session.tools({ toolkits: ["gmail", "calendar"] });
```

## 5. Logging e osservabilità

Logga sempre:
- `session_id`
- toolkit usato
- esito (success / error / input_required)
- latenza

Utile per debug e per capire quali tool falliscono più spesso.
