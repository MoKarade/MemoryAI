# MemoryAI

La **mémoire** de l'écosystème hub perso (`hubperso.com`). Une app privée,
`memoryai.hubperso.com`, qui détient une base de **faits typés sur Marc** — « mon bail finit
le 14 juillet 2030 », « mon avis de cotisation 2024 est dans ce document » — et la sert à
trois familles de lecteurs :

1. **claude.ai et Claude Code**, par un serveur MCP (`memoryai_*`) ;
2. un **chat plein écran** dans l'app elle-même ;
3. plus tard, un **widget** embarqué dans chacune des autres apps (JobAI, CarAI, BatchChef,
   DriveAI, FinanceAI, le hub).

Elle est **alimentée** par les apps et par le moteur DriveAI, qui classe déjà les documents
et lit les mails importants. Elle ne détient **aucun jeton** vers Google ni vers une app : ce
sont les apps qui détiennent un jeton vers elle.

## Ce qui ne sort jamais

Aucun texte de document ni de mail (un fait est une valeur courte et un pointeur), **jamais un
montant** (FinanceAI reste la source des chiffres), aucune valeur d'identité, d'immigration ou
fiscale (seulement l'existence et l'échéance), aucune position GPS, aucune adresse de tiers.
Les faits de niveau 1 et plus sont chiffrés (AES-256-GCM, clé hors base). Tout accès est
journalisé. Tout peut être oublié, et tout peut être purgé.

Le détail : [`docs/adr/0001`](docs/adr/0001-une-base-de-faits-sur-marc-hors-de-son-compte-google.md).

## État

Phase 0 — voir `HANDOVER.md` (état réel, gestes de Marc) et `BACKLOG.md` (lots).

## Développement

```bash
npm install
cp .env.example .env.local   # puis remplir
npm run dev                  # http://localhost:3000
npm run typecheck && npm run lint && npm run test && npm run build
```

Né d'[`app-template`](https://github.com/MoKarade/app-template) le 15/09/2026.
