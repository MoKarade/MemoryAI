<!-- Extrait de l'ancien CLAUDE.md (CLAUDE.md — introduction (contexte, stack, destination)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# CLAUDE.md — introduction (contexte, stack, destination)

La **mémoire** de l'écosystème hub perso : une base de faits typés sur Marc (dates, employeurs,
existence d'un document et où il est, goûts, projets…), chiffrés, avec provenance, servie à
claude.ai (serveur MCP), à un chat plein écran, et plus tard à un widget embarqué dans chaque
app. Elle est **alimentée** par les apps et par le moteur DriveAI ; elle ne détient **aucun
jeton** vers Google ni vers une app — ce sont les apps qui détiennent un jeton vers elle.

**Stack** : Next.js 16 (App Router) · Auth.js v5 (`providers: []` — la session vient du hub) ·
Neon + Drizzle · SDK Anthropic · Zod · TypeScript strict · Vitest.
**Destination** : `memoryai.hubperso.com` (projet Vercel `memory-ai`). Dépôt **privé**.

> 📐 Structure de ce fichier et de `docs/` : [convention commune aux huit dépôts](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md).
>
> Ce fichier se charge à **chaque session** — il reste court. L'état vit dans `HANDOVER.md`
> (à lire en premier), le plan dans `BACKLOG.md`, les décisions dans `docs/adr/`.
>
> **Le brief de démarrage et l'ADR-0059 de DriveAI** sont l'amont de ce dépôt : l'ADR 0001
> d'ici en est la déclinaison. Ce qu'ils ont tranché ne se rouvre pas.
