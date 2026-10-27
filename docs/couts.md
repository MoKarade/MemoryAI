# Coûts — MemoryAI

Dépôt privé, GitHub Free : 2 000 minutes d'Actions par mois (épuisées le 23/09/2026). Chiffres MESURÉS seulement ; un chiffre non mesuré s'écrit « à mesurer ». Modèle : `modeles/couts/couts.md` de l'Atelier.

## Minutes GitHub Actions
Mesure : `node modeles/couts/compter-runs.mjs MoKarade/MemoryAI 2026-09` (runs par workflow, lecture seule). Relevé du 26/09/2026 (avant cette PR) :

| Workflow | Déclencheurs | Runs en 09/2026 (mesuré) | Minutes (mesuré) | Rôle |
|---|---|---|---|---|
| CI | pull_request 105, push 61, dispatch 17, schedule 1 | 184 (21 échoués, 3 annulés) | ~557 (calendrier) | Gate, audit, qualité, sécurité. |
| Auto-merge | workflow_run 82, status 41, pull_request_target 9, schedule 7, dispatch 1 | 140 (9 échoués) | ~19 (calendrier) | Fusion automatique. |
| Apprentissage continu | schedule 40, dispatch 2 | 42 (2 échoués) | ~6 (calendrier) | Cron fonctionnel : passe d'apprentissage. |
| Dependabot Updates | dynamique 14 | 14 | non fiable (durée de calendrier) | Mises à jour. |

Attendu de cette PR : les 61 runs `push` (branches de PR) disparaissent (push sur `main` seulement, environ 1 run par PR fusionnée reste) ; les PR de docs seules ne lancent plus install, tests ni build (voie rapide) ; les runs périmés d'une PR sont annulés (concurrency). Le chiffre réel : à mesurer après fusion.
Règle : ajouter ou accélérer un cron = mettre ce tableau à jour dans la même PR, avec le coût.

## Crons autorisés
- `auto-merge.yml` : une fois par jour (`23 9 * * *`), sortie immédiate s'il n'y a aucune PR ouverte. La spec autorise au plus un passage toutes les 6 h ; on ne monte pas (chaque passage coûte au moins une minute).
- `ci.yml` : audit hebdomadaire (`17 12 * * 1`).
- `apprentissage.yml` : `23 */3 * * *` (8 passages par jour). Fonctionnel (la mémoire apprend des conversations) : NON modifié par cette PR, décision de Marc requise pour le réduire.
- `vercel.json` : `/api/cron/apprentissage` à 09:07 UTC (fonctionnel), une fois par jour.
- `vercel.json` : `/api/cron/reseau` à 10:27 UTC (26/10, tâche MemoryAI 186 B) : recalcul des liens et liens devinés. Le modèle (≈ 280 Mo) tourne dans la fonction : aucun appel payant, seulement son téléchargement depuis Hugging Face (gratuit) et le temps de la fonction, dans le plan gratuit.

## Quota Claude
- Taille du CLAUDE.md : 36 lignes, 3,4 Ko (plafond 60 lignes, 10 Ko), contre 864 lignes et 74 Ko avant (le détail est dans `docs/claude/`). Chaque session le charge : économie directe de quota.

## Appels IA
- Budget de 3 $/jour, réparti et nommé (chat 1 $ …) : voir `docs/claude/01-principes.md`. Appels et coût réels / mois : à mesurer.

## Autres
- Vercel : `ignoreCommand` (`.github/ci/ignore-command.mjs`) : pas de préversion pour une PR de docs seules ni pour dependabot ; production jamais sautée. Limite : sur la première construction d'une branche, Vercel ne fournit pas de commit précédent, donc on construit (échec fermé).

## Exceptions au gabarit
| Quoi | Raison | Condition de retour |
|---|---|---|
| Auto-merge : kit `modeles/auto-merge` en profil `prive` (dépôt PRIVÉ, vérifié par `gh repo view`), SANS `armement-auto-merge.yml` | Pas d'auto-fusion native en dépôt privé Free : `fusionner.mjs` fusionne (SHA verrouillé, chemins, appId) ; `COPIES.md` atteste la fidélité des copies | Dépôt public ou protection de branche : profil `complet` |
| Pas de neutralisation du quota Vercel : un échec de quota Vercel BLOQUE la fusion | Décision de Marc du 26/09/2026 ; l'ancien `scripts/autoMerge.mjs` de MemoryAI neutralisait ce cas, le kit non ; le Gate (qui contient le build) reste le juge du code | Décision de Marc (lot dédié, conditions strictes de pole-securite) |
| `pull_request_target` (ready_for_review) retiré de l'auto-merge | Condition de pole-securite pour les PR d'adoption ; une PR sortie du brouillon est vue au prochain `status`/`check_run` ou au rattrapage quotidien | Si des PR restent ouvertes après « prête à relire » |
| `securite_login` absent de `.github/auto-merge.json` | Le compte d'attestation (GitHub App) n'est pas encore dans le kit : sans lui aucun chemin sensible ne peut être attesté (donc jamais auto-fusionné : sûr) | PR de configuration après la fusion du lot « App de sécurité » |
| Cron auto-merge quotidien et non toutes les 6 h | Déjà au-dessous du plafond de la spec ; 6 h coûterait 90 min/mois de plus | Si un événement manqué devient fréquent |
| `ci.yml` garde ses jobs `gate`, `audit`, `qualite`, `securite` (pas le workflow réutilisable `ci / portes`) | Renommer le check requis casserait la fusion automatique | Une PR dédiée qui migre les noms de checks et `auto-merge` ensemble |
| `securite` (gitleaks, Semgrep) jamais sauté par la voie rapide | Un secret peut se cacher dans un document | aucune |
