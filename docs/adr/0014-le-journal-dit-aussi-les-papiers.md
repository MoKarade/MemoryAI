# ADR 0014 — Le journal d'accès dit aussi les PAPIERS lus, et le bon niveau pour un sommaire

- **Statut** : ACCEPTÉ (Marc, 29/09/2026, page Plans). Appliqué par cette PR.
- **Portée** : `lib/journal.ts` (le module qui SIGNE, pur), `lib/journalAcces.ts` (qui écrit),
  `lib/db/schema.ts` (table `journal_acces`). Ne touche NI au vocabulaire, NI aux niveaux, NI
  au contrat d'écriture des faits ou des pièces.
- **Concordance** : la table que ce texte appelle `journal_acces` s'appelle `acces_journal` dans
  le code (`lib/db/schema.ts`) ; c'est la même table.
- **Origine** : deux constats de la revue #72 (BACKLOG.md, non corrigés) :
  1. `journaliserAcces` ne consigne que les FAITS servis (`idsFaits`) — les papiers lus par le
     chat (N3 compris) n'apparaissent pas au journal d'accès.
  2. Le journal note `niveauMaxServi = 3` pour un papier N3 servi en SOMMAIRE : il note le
     niveau DU PAPIER, pas ce qui est réellement SORTI. Pas une fuite (le sommaire lui-même
     n'expose rien de plus) ; un journal moins précis qu'il n'en a l'air.

## 1. Pourquoi ce n'est pas un simple ajout de colonne

Le journal est **chaîné par HMAC** (`lib/journal.ts`, ADR 0001 §3 menace n° 5) :
`hmac = HMAC(cle, hmac_precedent | ts | lecteur | outil | usage | niveau | idsFaits |
question)`. Ajouter `idsPieces` à ce qui est signé change ce que CHAQUE FUTURE entrée
calcule — mais les entrées DÉJÀ écrites ont été signées avec l'ancien corpus, sans ce champ.
Une vérification naïve (`verifierChaine` recalculé avec le nouveau `signer()` sur d'anciennes
lignes) échouerait sur TOUT l'historique dès le premier redéploiement.

Deux mauvaises réponses, écartées d'entrée :
- **Ignorer le problème** (ajouter le champ, ne pas y penser) : casse `verifierChaine` sur
  toute entrée antérieure à la migration — un journal qui ment sur sa propre intégrité est
  pire qu'un journal incomplet.
- **Retrosigner l'historique** (recalculer `hmac`/`hmac_precedent` de toutes les lignes
  existantes avec `idsPieces: []`) : réécrire un journal tamper-evident, même pour ajouter un
  champ vide, est exactement le geste que ce journal existe pour repérer chez un tiers. Même
  fait ici de façon auditée, c'est un point sensible à éviter s'il existe une option plus sûre.

## 2. Options pour #1 (les papiers au journal)

### Option A (recommandée) — un corpus VERSIONNÉ, l'historique intact

Chaque entrée porte désormais un `version` (entier, colonne `version` avec défaut `1` pour
tout ce qui existe). `signer()` et `verifierChaine` deviennent des fonctions du `version` de
l'entrée : la v1 signe exactement le corpus d'aujourd'hui (compatibilité totale avec
l'historique, AUCUNE ligne retouchée) ; la v2 signe le corpus d'aujourd'hui + `idsPieces`. La
CHAÎNE elle-même ne change pas de mécanique — `hmac_precedent` continue de lier chaque ligne à
la précédente, quelle que soit sa version ; seul ce qui est HACHÉ par ligne dépend de sa
version. Écrire en v2 devient la valeur par défaut à partir du déploiement de cet ADR ;
personne ne relit ni ne resigne les lignes v1.

Précédent direct dans l'écosystème : le plan `auth-asym-hubperso` (§5, phase 4) prévoit
exactement ce patron — deux `kid` publiés le temps d'une rotation — pour un problème jumeau
(changer ce qui est signé sans casser ce qui l'a déjà été). Aucune pièce neuve à inventer,
seulement le même principe appliqué à `lib/journal.ts`.

⚠️ **Deux points ajoutés après revue adversariale de pole-securite (29/09), avant tout code :**
1. **`verifierChaine` doit REJETER activement une baisse de version dans la chaîne**, pas
   seulement compter sur `signer()` pour ne jamais en produire à l'écriture. Un bug ou une
   base compromise pourrait sinon produire une chaîne v2→v1 sans que la VÉRIFICATION s'en
   aperçoive — un journal tamper-evident doit détecter cette régression après coup, pas
   seulement la prévenir avant. Invariant à coder : la version d'une entrée ne redescend
   jamais sous celle de la précédente, contrôlé PAR `verifierChaine` lui-même.
2. **`version` doit figurer EXPLICITEMENT comme premier champ du corpus haché**, pour les
   deux versions — pas seulement déduit du fait que le corpus v1 et le corpus v2 diffèrent en
   octets. Cette dernière protection dépend de l'encodage exact (un `idsPieces` vide qui
   sérialiserait un jour par accident comme un champ absent ferait collisionner v1 et v2).
   Domaine-séparation par un `version` explicite dans le corpus est une hygiène
   cryptographique standard, peu coûteuse, indépendante des détails de sérialisation futurs.

### Option B — retrosigner l'historique (idsPieces = [] pour les lignes passées)

Écartée : voir §1. Le bénéfice (un seul format, tout le temps) ne vaut pas le risque de
manipuler un journal tamper-evident, même de façon documentée et auditée.

### Option C — `ids_pieces` en colonne séparée, HORS chaîne (non signée)

La plus simple à coder : une colonne de plus, jamais dans le corpus HMAC. Écartée pour l'usage
visé : ça affaiblirait la garantie précisément pour ce que #1 corrige — un accès à un papier
resterait falsifiable après coup (modifiable en base) sans casser la chaîne, alors que le but
est justement de le rendre aussi infalsifiable qu'un accès à un fait. Reste une option de
repli si Marc juge le coût de l'option A disproportionné pour ce que ça protège.

## 3. Option pour #2 (le niveau réellement servi)

**Recommandée, indépendante de A/B/C** — ne change PAS la forme du corpus signé (aucun champ
neuf), seulement la VALEUR de `niveauMaxServi` calculée avant signature : pour une entrée qui
ne sert QUE des papiers en SOMMAIRE (aucun fait ni papier COMPLET de niveau 3), le niveau
consigné reflète ce qui est réellement SORTI (domaine, année, dates — l'équivalent d'un
niveau 1 exposé), pas le niveau intrinsèque du papier. C'est un changement de VALEUR future
uniquement : aucune ligne existante n'est retouchée, aucune resignature nécessaire — risque
bien plus bas que #1, mais reste dans cet ADR parce que c'est un arbitrage sur ce qu'un champ
SIGNÉ affirme, pas un simple bug de calcul.

La règle exacte (quel nombre est « vrai » pour un mélange faits + papiers complets + papiers
sommaire dans la même entrée) reste À TRANCHER — proposition : le niveau consigné est le MAX
des niveaux réellement exposés (un fait de niveau 2 et un sommaire de niveau-source 3 comptent
2, pas 3 ; un papier COMPLET de niveau 3 compte toujours 3).

## 4. Ce que cet ADR NE fait PAS

- Ne touche pas `idsFaits` ni son format actuel : `idsPieces` est un champ NEUF, pas une
  réutilisation d'`idsFaits` avec des id mélangés — une colonne nommée « faits » qui contient
  des id de papiers serait fausse à la lecture, y compris pour un audit humain.
- Ne change rien à ce qui est SERVI au modèle ni à la politique de lecture des papiers (ADR
  0011) : uniquement ce que le journal ENREGISTRE après coup.
- Ne retire ni ne réécrit aucune ligne existante du journal, dans aucune option retenue.

## 5. Risques

| Risque | Gravité | Parade |
|---|---|---|
| Bug dans le `signer()` versionné : une v2 vérifiée avec le corpus v1 (ou l'inverse) | élevée | tests dédiés : chaîne mixte v1→v2→v1 impossible (une v1 ne peut suivre une v2 qu'en v2+), `verifierChaine` choisit le corpus par la colonne `version`, jamais par déduction |
| Une chaîne dont la version REDESCEND (v2→v1) passe la vérification (pole-securite, 29/09) | élevée | `verifierChaine` REJETTE activement toute entrée dont la version est inférieure à celle de la précédente — invariant monotone contrôlé À LA VÉRIFICATION, pas seulement empêché à l'écriture |
| Collision d'octets entre le corpus v1 et le corpus v2 si un encodage futur fait sérialiser `idsPieces` vide comme un champ absent (pole-securite, 29/09) | moyenne | `version` explicite comme PREMIER champ du corpus haché, dans les deux versions — domaine-séparation indépendante des détails de sérialisation |
| Migration qui pose `version=1` par défaut mais qu'un chemin d'écriture oublie de fixer `version=2` après le déploiement | moyenne | valeur par défaut du CODE (jamais de la colonne) pour les écritures neuves ; test de garde qui échoue si `journaliserAcces` omet `version` |
| Le niveau consigné (§3) devient un TROISIÈME calcul de niveau dans le code (à côté de celui du papier et de celui de la politique), source de divergence | moyenne | une seule fonction pure, testée, appelée aux DEUX endroits qui en ont besoin (journal + notes servies au modèle) |
| Effort sous-estimé côté vérification (`verifierChaine` doit rester en temps constant, §ADR 0001) | faible | mesuré par les tests existants de `tests/journal.test.ts`, étendus |

## 6. Décisions demandées à Marc

1. Option A (corpus versionné, recommandée) pour #1, ou Option C (colonne hors chaîne, plus
   simple mais plus faible) si le coût de A semble disproportionné ?
2. La règle du §3 (MAX des niveaux réellement exposés) pour le niveau consigné d'une entrée
   mixte — ou une autre règle ?
3. Ordre : #1 et #2 dans le MÊME lot de code (même migration, même PR) ou deux lots séparés,
   #2 pouvant partir seul puisqu'il ne touche pas la forme du corpus ?

## 7. Effort estimé (une fois ce brouillon accepté sans réserve)

- Option A (`version`, `signer`/`verifierChaine` versionnés, migration, tests de chaîne
  mixte) : 1,5 à 2h.
- Propagation d'`idsPieces` depuis `lib/chat/agent.ts` / `lib/mcp/protocole.ts` (là où
  `journaliserAcces` est appelé) jusqu'au dépôt : 0,5h.
- §3 (niveau réellement servi) : 0,5h, indépendant.
- Total : 2,5 à 3h, une PR (ou deux si Marc sépare #1 et #2 au §6.3).

## 8. Question ouverte pour pole-securite (bl-citation-sommaire, commit fe1b1e9, hors périmètre
de cet ADR mais liée à la même revue #72)

Une citation appuyée sur un papier servi en SOMMAIRE reçoit désormais « (sommaire) » au lieu
d'être traitée comme n'importe quelle autre citation valide (`lib/chat/liens.ts`,
`PieceServie.forme`). La question : est-ce que la marque seule suffit comme garde, ou faut-il
en plus EMPÊCHER le modèle d'affirmer un détail précis (numéro, date) à côté d'une citation
ainsi marquée ? Rien de tel n'a été ajouté — seulement le signalement.

**Réponse de pole-securite (29/09) : la marque seule NE SUFFIT PAS.** C'est un signal pour un
lecteur humain, pas une contrainte sur ce que le modèle peut affirmer — rien n'empêche
techniquement un chiffre ou une date précis d'apparaître à côté d'une citation ainsi marquée.
Garde active recommandée en plus du marquage : une consigne système explicite (couche
`REGLES_CITATION`, verrouillée — ADR 0005 §3 A4) qui interdit d'associer un détail
chiffré/daté à une citation « (sommaire) », ou plus fort, un contrôle après génération qui
détecte un tel motif et le bloque ou le signale. Décision pour Marc : go pour cette garde
active maintenant, ou elle attend elle aussi son feu vert explicite (ça change le
comportement du chat, une couche que ni Marc ni l'apprentissage ne peuvent modifier
d'ordinaire) ?

---
Brouillon rédigé par memoryai-7e (session Claude Code), 29/09/2026, à la demande du gérant.
Numéro 0014 provisoire : la PR #79 (mémoire de l'agence) réserve déjà 0013 sur sa branche —
à confirmer/renuméroter selon l'ordre réel de fusion.
