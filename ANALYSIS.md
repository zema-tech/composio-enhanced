# Analisi tecnica di ComposioHQ/composio (novembre 2026)

## Panoramica

- **Tipo**: monorepo grande (TypeScript + Python + CLI + docs)
- **Stars**: ≈ 31k
- **Branch principale di lavoro**: `next`
- **Toolchain**: mise (Node ≥ 24, pnpm, Python 3.11–3.15, uv, Bun)
- **Package manager TS**: pnpm workspaces + turbo
- **Package manager Python**: uv + pyproject.toml

## Layout principale

```text
ts/
  packages/core/          → @composio/core
  packages/slim/          → versione leggera senza source/docs
  packages/cli/           → CLI (Effect-based)
  packages/providers/*    → adapter per framework agent
  packages/experimental/
python/
  composio/               → SDK Python
  providers/              → adapter Python
docs/                     → sito documentazione (Fumadocs)
.agents/skills/           → skill per coding agent
```

## Punti di forza

1. **Sessioni per-utente** + meta-tool → ottimo per non esplodere il context window
2. **Provider layer** pulito e estendibile
3. **MCP hosted** out-of-the-box
4. **Agent guidance** di prima classe (`AGENTS.md` + skill tree validato in CI)
5. **Release process** maturo (Changesets + uv.lock + CLI binary)

## Punti deboli / opportunità di miglioramento

| Area | Problema | Possibile miglioramento |
|------|----------|-------------------------|
| Dimensioni monorepo | Clone lento, CI pesante | Sparse checkout, o package più autonomi |
| DX locale | `mise` + pnpm + uv obbligatori | Script di bootstrap più permissivi |
| Errori toolkit | Alcuni toolkit falliscono su auth/region (Alpaca paper, Cloudflare token, Drive shared) | Client-side retry + better error mapping |
| MCP hosted | `data_preview` su risposte grandi | Flag per forzare full data o streaming |
| Documentazione | Solo inglese | Layer IT / multilingua (questo repo) |
| Context | Meta-tool ancora generici | Helper per filtrare toolkit per dominio |
| Python ↔ TS parity | Qualche differenza di comportamento | Test di parity più aggressivi |

## Note sul Contribution Policy

- Contributor esterni **devono** aprire un issue prima di un PR (tranne small fix)
- Reviewer designato: @jkomyno
- Non accettano PR cosmetici o drive-by
- AI assistance ok, ma l’autore deve aver letto e verificato tutto il diff

## Raccomandazioni per chi vuole contribuire

1. Apri prima un issue chiaro
2. Lavora su branch da `next`
3. Aggiungi changeset se tocchi package pubblicati
4. Esegui i check locali (`pnpm lint`, `pnpm test`, `make chk` lato Python)
5. Non modificare path generati (`ts/packages/core/generated/**`, lockfile, vendor)

## Cosa contiene questo repo enhanced

- Helper client-side più robusti
- Documentazione in italiano
- Pattern di uso consigliati per agent multi-turno
- Esempi minimali pronti
- Nessuna modifica al codice proprietario del backend Composio
