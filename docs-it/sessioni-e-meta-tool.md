# Sessioni e Meta-Tool

## Perché le sessioni

Ogni chiamata a `composio.create(user_id)` crea una **sessione isolata** per quell’utente.  
All’interno della sessione:

- i tool sono già autenticati (o pronti per il link OAuth)
- lo stato (connected accounts, auth config) è condiviso tra i turni
- puoi limitare i toolkit disponibili

## Meta-tool (il vero superpotere)

Invece di caricare 200+ tool definitions nel prompt, Composio espone pochi **meta-tool**:

- cerca tool disponibili
- autentica un toolkit
- esegue un tool specifico

Questo mantiene il context window leggero e permette agli agent di scoprire cosa serve a runtime.

## Pattern multi-turno corretto

```ts
// Primo turno
const session = await composio.create(userId);
const sessionId = session.session_id;

// Turni successivi
const session = await composio.use(sessionId);
const tools = await session.tools();
```

Non ricreare la sessione a ogni messaggio: perdi lo stato di autenticazione.

## Limitare i toolkit

```ts
const session = await composio.create(userId, {
  // solo questi toolkit saranno disponibili
  toolkits: ["gmail", "slack", "github"],
});
```

Utile per ridurre ulteriormente il rumore e aumentare la sicurezza.
