# @12-apps/product-research

Multi-source price research: store connectors, a paid search provider and
manual price lists, scored for relevance and ranked by unit price. This page
covers only the copy a host supplies; the types carry the rest.

- **Every sentence is host config.** The package compiles in no wording a
  reader sees. Each surface takes its copy as a REQUIRED field, either a table
  or a resolver `(ctx) => table` (`ResearchCopySource<T>`, the shape
  `localeCopy(PACK)` from `@12-apps/i18n` returns).
- **Both languages ship, as named packs.** `./en-US` and `./pt-BR` export
  them; nothing defaults to either. The root entry and `./locales` export the
  same packs keyed by tag, for a resolver.

## The packs, and where each one plugs in

| field | en-US | pt-BR | keyed by tag |
|---|---|---|---|
| `diagnostics` on `createApiProductResearch` (`./http`), on `ConnectorContext` and on `ResearchDeps` (`runResearch`) | `EN_US_RESEARCH_DIAGNOSTICS` | `PT_BR_RESEARCH_DIAGNOSTICS` | `RESEARCH_DIAGNOSTICS` |
| `messages` on `createApiProductResearch` | `EN_US_RESEARCH_MESSAGES` | `PT_BR_RESEARCH_MESSAGES` | `RESEARCH_HTTP_MESSAGES` |
| the argument of `createResearchBudgetBlueprint` (`./manifest`) | `EN_US_RESEARCH_BUDGET_COPY` | `PT_BR_RESEARCH_BUDGET_COPY` | `RESEARCH_BUDGET_COPY` |
| permission segment labels, composed beside the contribution by hand | `EN_US_RESEARCH_PERMISSION_LABELS` | `PT_BR_RESEARCH_PERMISSION_LABELS` | `RESEARCH_PERMISSION_LABELS` |

```ts
import { PT_BR_RESEARCH_DIAGNOSTICS } from '@12-apps/product-research/pt-BR';

const ctx: ConnectorContext = {
  logger,
  fetchJson,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  locale: 'pt-BR',
};
```

Pass the same `diagnostics` (and `locale`) to `ConnectorContext` and
`ResearchDeps`: the pipeline's own verdicts and the connectors' failures land
in one report.

`MARKET_VOCABULARY` (`EN_US_MARKET_VOCABULARY`, `PT_BR_MARKET_VOCABULARY`) is
not copy. It is the words the package READS in a store's pages and a supplier's
sheet, so it follows the market being searched, never the reader, and
`vocabulary` takes a table rather than a resolver.

### Connector failures

`diagnostics.connectors` words the connectors' own failures: the Mercado Livre
search and catalog lookup answering nothing (`mercadoLivreSearchUnreachable(url)`,
`mercadoLivreCatalogUnreachable(url)`), a missing access token
(`mercadoLivreAuthFailed(sourceLabel)`), the manual price store throwing
(`manualStoreUnavailable(cause)`) and a source type with no connector
(`noConnector(sourceType)`). The block is OPTIONAL so an older pack keeps
compiling; without it the connectors record the English of
`EN_US_RESEARCH_DIAGNOSTICS.connectors`, which is what they always recorded.
Both packs fill it. The reasons carry the failing request's URL or the store's
cause, because the reason on the source row is the only diagnosis an admin
gets.
