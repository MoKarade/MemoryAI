# Seed — le premier remplissage de la mémoire (lot 6)

Le seed est la liste des faits PROPOSÉS depuis la session de démarrage du 15/09/2026 (ADR 0001
§8, lot 6) : ce que les cinq apps et le Drive disaient de Marc ce jour-là, mis à la forme du
contrat d'écriture. Il ne décide rien — chaque fait entre en statut « proposé », avec la
fiabilité `seed`, et c'est `/a-valider` qui le confirme, le rejette ou l'oublie.

## Où il vit

- `seed/faits.local.json` — le vrai seed, **hors git** (`.gitignore`) : des faits personnels.
  Marc le reçoit dans la session qui l'a écrit, le relit, puis l'envoie.
- `seed/exemple.json` — la FORME du fichier, avec des entrées fictives ; c'est lui que la CI
  valide quand aucun seed local n'est là.
- `scripts/seed.mjs` — met chaque entrée à la forme de `POST /api/faits`, découpe par lots de
  50 et envoie. `--lister` affiche la liste sans rien envoyer.
- `tests/seed.test.ts` — TOUT fichier `seed/*.json` présent (local compris) passe la vraie
  `validerFait` avec les fiabilités du jeton `seed`, sans base ni réseau. Un seed refusé par la
  route se voit donc AVANT l'envoi.

## La forme d'une entrée

```json
{ "predicat": "vehicule.bail.fin", "valeur": "2031-01-15", "valeur_type": "date",
  "confiance": 0.95, "source": "app:carai" }
```

- `source` : `doc:<alias>` (un document du Drive — le fileId vient de la table `documents`
  du fichier ; alias à `null` = l'origine est connue mais sans pointeur), `app:<id>`,
  `seed:<origine>` ou `session`. Un pointeur (`ref_document`) sans `source` pointe vers lui-même.
- `dossier` et `type_document` ne s'écrivent que sur les entrées dont on veut MONTER le niveau
  (`lib/niveau.ts`) : `04 · Immigration`, un `Passeport`, un `T4` font N3 — donc jamais sur un
  texte, qui serait refusé (`n3_texte`).
- `niveau_propose` monte un niveau à la main (une adresse ancienne en N2). Jamais ne baisse.

## Ce qui n'y entre pas, par construction

Aucun montant (la route refuse `valeur_type: "montant"`, le test refuse « 1 600 $ » dans un
texte), aucune adresse de tiers, aucun numéro d'identité ni de document de voyage, aucune
coordonnée, aucun nom de colocataire ni de proche. Ce que le seed sait d'un passeport, c'est
qu'il existe, où il est, et de quand il date.

## Envoyer

```bash
MEMORYAI_URL=https://memoryai.hubperso.com \
MEMORYAI_TOKEN_SEED_ECRITURE=<la valeur posée dans Vercel> \
node scripts/seed.mjs seed/faits.local.json
```

Idempotent : renvoyer le même fichier rend « déjà présents », rien n'est réécrit. Un fait
oublié dans `/a-valider` ne revient pas (`oublis`). La variable `MEMORYAI_TOKEN_SEED_ECRITURE`
peut être retirée de Vercel une fois le seed envoyé : le jeton `seed` n'a plus de raison d'être.
