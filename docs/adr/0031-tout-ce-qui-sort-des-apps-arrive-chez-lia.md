# ADR 0031 — Tout ce qui sort des apps arrive chez LIA, par une porte à jeton par app

- **Statut** : **accepté** (26/10/2026, fil MemoryAI ; OK de Marc le 26/10 à 18:18Z, carte « Oui, tel
  quel », planchers de niveau et rétention compris). Il répond à la demande de Marc du 26/10 à
  14:46Z (« accès à littéralement tout ce qui sort des apps ») et à sa carte de 14:50Z (LIA voit tout,
  FinanceAI incluse en niveau 3 verrouillé, et agit aussi dans les apps). Tâche : MemoryAI#281, dans la
  mission .github#575. Ce sont des données de Marc qui entrent et la frontière d'écriture s'élargit :
  c'est pourquoi le texte a attendu son OK (protocole, `docs/claude/11-protocole.md`).
- **Amont** : ADR 0001 (frontière, niveaux), ADR 0007 et 0011 (niveau 3 sous deux verrous), ADR 0015
  (le jeton dit qui écrit), ADR 0029 (l'agenda, même forme de porte), ADR 0019 (sauvetage).

## Contexte

LIA ne voit aujourd'hui que le bilan du hub, les faits, les messages Messenger (`/api/evenements`,
DriveAI seule), l'agenda (`/api/agenda`, DriveAI seule) et les papiers. Ce que BatchChef, CarAI, JobAI
et FinanceAI produisent (un batch cuisiné, une recharge, une candidature qui bouge, un bilan du mois)
n'arrive pas chez elle.

Deux principes tiennent déjà et ne bougent pas : MemoryAI ne détient **aucun jeton vers une app** (ce
sont les apps qui ont un jeton vers elle), et un texte qui vient d'une app est une **donnée**, jamais
une instruction.

## Options

1. **Une porte unique, `POST /api/sorties`, un jeton d'écrivain par app** (recommandée). Une seule
   forme de corps, une seule table, l'app connue par son jeton. Ajouter une app = une ligne dans une
   liste fermée.
2. **Une porte par app**, comme l'agenda. Cinq routes, cinq contrats à tenir à jour, et chaque nouvelle
   app en demande une de plus. Gain : un contrat sur mesure par app. Perte : le plus gros de la dette.
3. **MemoryAI va chercher** (tirer chez les apps). Il lui faudrait un jeton vers chaque app, ce que le
   principe « aucun jeton détenu » interdit. Écartée.

## Décision (option 1)

1. **La porte** : `POST /api/sorties`, hors du middleware de session (égalité stricte, jamais un
   préfixe), comme les autres routes machine.
   - Jeton d'écrivain, rôle `ecriture` : `MEMORYAI_TOKEN_<APP>_ECRITURE` (ADR 0015). **L'app se déduit
     du nom de la variable qui a reconnu le jeton, jamais du corps.** Un `app` écrit dans le corps est
     ignoré et nommé dans `ignores`.
   - Liste fermée dans le code : `APPS_SORTIES = { batchchef, carai, driveai, financeai, jobai }`. Une
     app qui n'y figure pas reçoit le même `401 non_autorise` qu'un jeton inconnu (`refusJeton()`).
     En ajouter une est une décision de frontière : un ADR et l'OK de Marc.
   - Ordre des gardes, comme l'agenda : gel (`MEMORYAI_GEL=1` → 503), jeton (401 indiscernable), clé
     absente (503 `cle_absente`), base absente (503 `base_absente`), taille (413), JSON (400), forme
     (422). **Pas de porte de sauvetage** : les tables sont neuves, aucune ligne de l'ancienne clé ne
     peut s'y doubler (ADR 0019 §2).
2. **Le corps** (JSON, 64 Ko au plus) :

   ```json
   {
     "source": "sorties",
     "evenements": [
       { "type": "recharge", "date": "2026-10-26T13:30:00-04:00", "titre": "Recharge fictive", "resume": "42 kWh en 50 minutes", "ref": "abc-123", "niveau": 2 }
     ]
   }
   ```

   - `evenements` : 1 à 50 par envoi (au-delà : 422 `trop_d_evenements`).
   - `type` : un mot en minuscules, `a-z0-9_`, 1 à 40 caractères (« recharge », « batch », « candidature »).
     Le vocabulaire n'est pas fermé : il est rangé sous l'app du jeton, donc deux apps peuvent employer
     le même mot sans se mélanger.
   - `date` : ISO avec décalage, pas plus d'un jour dans le futur, pas plus de 400 jours dans le passé.
   - `titre` : 1 à 120 caractères, une ligne. `resume` : 0 à 600 caractères. MemoryAI retire les
     balises et les caractères de contrôle des deux.
   - `ref` : optionnel, 1 à 80 caractères, l'identifiant de l'objet dans l'app. Sans `ref`, l'empreinte
     est celle de `type|date|titre`. **Un même événement renvoyé ne se double jamais** (clé unique
     app + empreinte) : l'app peut rejouer tout un lot.
   - `niveau` : optionnel, 1 à 3. **Il ne peut que monter** : la valeur retenue est `max(niveau reçu,
     plancher de l'app)`. Une app ne descend jamais un niveau.
   - **Rien d'autre** : une clé en trop est ignorée et nommée dans `ignores`. Un événement hors forme
     est refusé seul, compté dans `refuses` avec son index et un code fermé ; les autres passent.
3. **Planchers de niveau par app** (validés par Marc le 26/10 à 18:18Z) :

   | app | plancher | pourquoi |
   |---|---|---|
   | financeai | **3** | demande de Marc : niveau 3 verrouillé |
   | carai | 2 | trajets et recharges : lieux et habitudes |
   | driveai | 2 | tout ce qu'elle publie vient de documents |
   | jobai | 2 | candidatures et réponses de recruteurs |
   | batchchef | 1 | recettes et listes d'épicerie |

4. **Le stockage** (migration additive, numéro pris au code) : trois tables, hors `schema.ts` comme
   `lib/idees/table.ts`.
   - `sorties` : `id`, `app`, `type`, `date`, `niveau`, `empreinte`, `recu_le`, plus `titre` et `resume`
     **chiffrés** au niveau retenu (AAD `sorties|<id>|<niveau>`). Clé unique `(app, empreinte)`.
     Un texte qui ne se déchiffre pas est compté, jamais montré.
   - `sorties_refus` : `jour`, `code`, `n`. C'est le compteur de refus et de dépassements de taille ;
     il ne garde ni texte ni app.
   - **Rétention** (validée par Marc le 26/10 à 18:18Z) : 180 jours et 2 000 sorties par app ; la plus
     ancienne part la première. Le passage quotidien existant (cron d'apprentissage) purge.
   - **Ni dans `faits`, ni dans l'apprentissage.** Une sortie est un événement daté, pas un fait
     durable : aucun modèle n'en tire de fait dans ce lot.
5. **La réponse 200** : `{ recus, ecrits, doublons, refuses: [{ index, code }], ignores: [noms de clés] }`.
   **Que des nombres et des codes : aucun titre ni résumé ne revient**, ni dans la réponse ni dans les
   journaux serveur. `GET /api/etat` ne gagne que deux nombres globaux (sorties gardées, refus des
   sept derniers jours), jamais découpés par app (ADR 0015 §2.3).
6. **La lecture par LIA** : un outil MCP neuf, `memoryai_sorties` (recherche par app, type, période et
   texte). Le texte étant chiffré, la recherche déchiffre en mémoire, ce que la borne de rétention
   rend tenable. Chaque résultat porte son **app**, sa **date**, son **niveau** et sa **source**
   (« reçu de CarAI le … »).
   - Niveau 3 : mêmes verrous que les faits (ADR 0007 et 0011). Sans eux, l'outil ne rend que le
     compte (« 3 sorties de niveau 3 masquées »).
   - Chaque sortie rendue est **balisée comme une donnée** (`lib/mcp/balisage.ts`) : un titre qui
     ressemble à une consigne reste un titre.
   - Chaque lecture passe par le journal d'accès (ADR 0014), qui dit combien et de quel niveau,
     jamais quoi.
7. **Ce que cela change dans la tâche #281** : la ligne « Fini quand » disait « retrouvé par
   `memoryai_chercher` ». `memoryai_chercher` rend des FAITS (prédicat, fiabilité, lignée) : y mêler des
   événements en brouillerait la forme. L'outil dédié fait la même preuve. Si Marc préfère un seul outil,
   c'est un paramètre `source` en plus sur `memoryai_chercher`, sans autre changement ici.

## Ce que cet ADR n'autorise pas

- Aucun jeton vers une app, aucune lecture chez elle : elles poussent, MemoryAI reçoit.
- Aucun modèle ne lit les sorties pendant un tour de chat dans ce lot. Les rendre à LIA là-dedans est
  un autre ADR (balisage, niveau, budget).
- Aucun jeton n'est créé par ce code. Chaque variable `MEMORYAI_TOKEN_<APP>_ECRITURE` est posée par le
  fil Secrets, sur le oui de Marc, app par app.
- Aucune donnée perso dans les tests ni la doc : tout est fictif (dépôt public).
- Le côté « LIA agit dans les apps » n'est pas ici : il vit dans le catalogue d'outils (MemoryAI#282).

## Ce qui reste ouvert

- Côté chaque app : l'envoi lui-même (quoi pousser, à quel rythme), une tâche par dépôt, après le
  déploiement de la porte.
- Un chemin d'oubli (Hubperso#450) viderait aussi `sorties` pour une app ou un type, à la demande de Marc.
