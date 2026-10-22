# ADR 0016 — LIA répond au hub, et par lui à toutes les apps

- **Statut** : **ACCEPTÉ** sur le go de Marc du 22/10/2026 (21:22Z, « continue seul automatiquement
  et publie LIA directement dans toutes les apps concernées »). Le périmètre retenu est PLUS ÉTROIT
  que celui du chat : rien de ce que Marc ne voyait déjà dans son chat ne sort ailleurs.
- **Déclencheur** : MemoryAI#91. LIA est montée sur le hub (Hubperso#335) et répond « indisponible »
  tant que sa maison n'a pas de point d'entrée.
- **Portée** : `app/api/ask/route.ts`, `lib/lia/ask.ts`, `lib/lia/blocs.ts`, `lib/chat/agent.ts` (`outilsPermis`, `blocs`),
  `lib/chat/couches.ts` (`lecteur`), `lib/authGuard.ts`, `middleware.ts`.
- **Amont** : ADR 0017 (LIA vit dans MemoryAI ; « LIA ne répond qu'au propriétaire » est la décision 5 de
  Marc, pas un choix de ce fil) ; contrat « ask » du fil Assistant (trois sauts, `commun/assistant/CONTRAT-ask-lia.md`) ;
  ADR 0001 (frontière), ADR 0011 (niveau 3 au chat seul).

## 1. Ce qui change à la frontière

Un **nouveau lecteur**, `lia-hub` : le modèle du chat, appelé par le hub au nom de Marc, depuis
n'importe quelle app. C'est une modification de la frontière au sens du protocole
(`docs/claude/11-protocole.md`) : qui lit, et ce qui sort vers un modèle.

## 2. Qui peut appeler

- **Le hub seul**, par `x-hub-token` (le `HUB_TOKEN` déjà partagé pour `/hub/summary`), comparé en
  temps constant. MemoryAI ne détient aucun jeton d'app et ne fait confiance qu'à un appelant.
  Ni session, ni CORS. `HUB_TOKEN` absent : 503 ; jeton absent ou faux : 401.
- **Le propriétaire seul.** Une app peut avoir des invités (accès à deux étages) ; MemoryAI jamais.
  Le hub sait qui parle et le dit par `proprietaire: true` dans le corps. Absent ou faux : **403**.
  Jamais : répondre sans ce champ. Ligne qui le tient : `lireDemande` ; test :
  `tests/liaAsk.test.ts` (« propriétaire seul »).

## 3. Ce qui peut sortir

- **Niveaux 0 et 1.** La route passe `inclureN2: false` et `inclureN3: false`, que la boucle impose
  à chaque outil (la bascule de la conversation écrase celle du modèle). Le lecteur `lia-hub` n'est
  pas dans `LECTEURS_N3` : même un `inclure_n3` forcé ne servirait qu'un sommaire.
- **Outils en lecture seule**, par liste blanche (`OUTILS_LIA_HUB`) tenue aux deux bouts : seuls
  ces outils sont décrits au modèle, et un autre nommé quand même reçoit « Outil inconnu ». Aucun
  n'écrit : ni `proposer`, ni `demander`, ni `consigner`. Test : `tests/chat.test.ts`
  (« outilsPermis »).
- **Journalisé** comme tout fait servi : lecteur `lia-hub`, pour les outils et pour le profil.
- **La question n'est jamais journalisée en clair**, ni dans un refus (`lireDemande` cite des noms
  de champs), ni dans une erreur du modèle (nom et message seulement). La conversation n'est pas
  consignée en v1.

## 4. Ce que ça coûte

Le poste `chat` et son plafond (réglé par Marc, borné par `PLAFOND_TOTAL_USD_PAR_JOUR` = 3 $) :
LIA est une seule voix, son budget aussi. Plafond atteint : **503** (le contrat dit « LIA
indisponible », pas « trop de requêtes »).

## 5. Revue adversariale (faite avant le merge)

| Attaque | Garde |
|---|---|
| Un inconnu appelle la route | 401 en temps constant, avant toute lecture du corps |
| Un invité d'une app pose une question | le hub ne dit pas `proprietaire: true` : 403 |
| Une question qui demande N2 ou N3 | bascules à `false` imposées par la boucle ; N3 hors liste blanche |
| Un modèle qui veut écrire un fait | l'outil n'est ni décrit ni exécutable |
| `page` ou `source` qui injectent une consigne | regex stricte (chemin, identifiant) avant le prompt |
| Un corps énorme | 413 avant `JSON.parse` |
| La question dans les journaux | jamais écrite ; refus et erreurs sans contenu |
| Une citation relative illisible ailleurs | rendue absolue vers MemoryAI, qui garde la fiche derrière la session |

Limite dite franchement : si le hub se trompe sur `proprietaire`, MemoryAI le croit. C'est la
même confiance que pour le jeton : le hub est l'unique appelant, et c'est lui qui tient la
session et les accès.

## 6. Les blocs (lot 5, MemoryAI#74)

La réponse devient `{ text, blocks? }` : LIA peut MONTRER (carte, frise, jauge, tableau…) en plus de
dire. Le catalogue est FERMÉ et vit ici, dans `lib/lia/blocs.ts` (22 formes, celles de la maquette
v5) ; le paquet `lia-ui` ne fait que les dessiner. Copie lisible pour les autres fils :
`commun/assistant/BLOCS-lia.md`.

- **Rien de neuf ne sort.** Un bloc porte les valeurs que le modèle a lues dans les faits SERVIS du
  tour (niveaux 0 et 1, mêmes outils) et leurs identifiants, qui sortaient déjà dans les liens
  `→ /fait/<id>` et `/pieces/<id>` du texte.
- **Chaque bloc de données cite ses sources** (`sources`, 1 à 50 identifiants de faits ou de papiers). Une source
  qui n'a pas été servie pendant CE tour rejette le bloc entier : le modèle ne peut pas citer un
  fait qu'il n'a pas lu, ni en inventer un. Seule `confirmation` n'en porte pas (c'est une action
  proposée, que le hub exécute après le oui de Marc, ADR 0017).
- **Chaque bloc est validé seul** par Zod, avec ses cohérences (frise, réseau, grille, arbre ≤ 4
  niveaux, lien `https` seulement) ; un bloc faux ne tue pas les autres ; au-delà de 20, le reste
  est rejeté et compté. Les clés inconnues sont retirées, jamais rendues. La raison d'un rejet
  nomme des champs, jamais des valeurs.
- **L'outil `lia_blocs` n'est offert qu'à la route ask** (`blocs: true`) ; le chat de MemoryAI ne
  l'a pas encore. Tests : `tests/liaBlocs.test.ts`, `tests/chat.test.ts` (« lia_blocs »).
