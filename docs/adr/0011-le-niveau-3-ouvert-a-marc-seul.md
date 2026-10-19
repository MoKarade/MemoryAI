# ADR 0011 — Le niveau 3 ouvert par défaut à Marc, et à lui seul

- **Statut** : ACCEPTÉ (Marc, 24/09/2026 — « go » sur le plan du lot 2).
- **Amende** : l'ADR 0007 §3 (qui peut demander N3), §4 (« n'ouvre rien par défaut ») et §5
  (« la case retombe à chaque fois »). Ne touche ni au chiffrement, ni au vocabulaire, ni au
  contrat d'écriture.
- **Portée** : lot 2 du chantier « la Mémoire sait tout de moi » (L1 = lecture vision, DriveAI
  C49-29/30 et ADR 0010 ici).

## 1. Ce qui a été mesuré avant d'écrire

- **Le connecteur MCP sert le contenu du passeport.** Le 24/09, les numéros du passeport de
  Marc ont été obtenus par `memoryai_papiers_chercher` depuis une session Claude Code — pas
  depuis le chat. Il suffit de `MEMORYAI_N3_CHAT=1` (posée) et d'un `inclure_n3: true` choisi
  par le modèle appelant. Or le MCP s'authentifie par un JETON OAuth, pas par la session de
  Marc : c'est exactement ce que l'ADR 0007 §3 disait vouloir empêcher, et le deuxième verrou
  (« la demande par appel ») était, côté MCP, à la main d'un modèle.
- **Le chat ne trouve pas le passeport** pour deux raisons, aucune liée aux droits :
  - son prompt système ne nomme que les outils de FAITS (`memoryai_chercher`, `_contexte`,
    `_inventaire`) : les outils de PAPIERS existent et ne sont jamais suggérés ;
  - un papier N3 est au régime chiffré, donc sans colonne `recherche` : il ne se retrouve que
    par domaine, année, type ou émetteur. Le titulaire a une clé keyée **indexée**
    (`pieces_titulaire_cle`) que **aucune requête ne consulte**.
- **La case « niveau 3 » retombe à chaque conversation** (ADR 0007 §5). Marc, le 24/09 :
  « je veux mettre en place une sécurité pour que ces infos ne sortent jamais, que ce soit
  seulement moi qui puisse voir, **mais ouvert par défaut** ».

## 2. La décision

1. **N3 n'est servi qu'à une liste FERMÉE de lecteurs**, et cette liste ne contient que le
   chat du propriétaire (`LECTEURS_N3 = {"chat"}`, `lib/lecture.ts`). Tout autre lecteur —
   `claude-ai` (le MCP), et tout lecteur ajouté plus tard — reçoit le sommaire, **quoi qu'il
   demande**. Le verrou est dans `politique()`, le seul point par lequel TOUS les outils
   construisent leur politique ; et `tools/list` ne propose plus `inclure_n3` à ces lecteurs.
   ⚠️ Une LISTE BLANCHE et non une exclusion de `claude-ai` : un lecteur neuf est fermé par
   défaut, et un défaut de configuration n'est pas une décision.
2. **Dans le chat, la case est cochée par défaut.** Elle reste décochable pour une
   conversation. Ce qui garantit « seulement moi » n'est pas la case, c'est la route :
   `/api/chat` est derrière le middleware ET revérifie la session à chaque tour
   (`requireSession`), et l'app n'a pas d'invité (CLAUDE.md §1). `MEMORYAI_N3_CHAT` reste
   l'interrupteur hors produit : l'enlever referme tout, chat compris.
3. **Le titulaire devient un filtre** (`titulaires`, clé keyée — le même mécanisme que type
   et émetteur, sans rien écrire en clair).
4. **Le plein texte atteint les papiers N3 — en mémoire, jamais en base.** Quand la politique
   sert N3 et qu'une question est posée, les papiers N3 correspondant aux AUTRES filtres sont
   déchiffrés à la volée et comparés à la question (type, émetteur, titulaire, résumé,
   champs). Rien n'est écrit en clair : le régime chiffré de l'ADR 0004 reste entier. C'est le
   mécanisme « plein texte après filtrage » que Marc avait écarté le 16/09 **pour tout le
   corpus**, au profit de la vitesse ; il ne revient ici que pour le seul sous-ensemble qui n'a
   pas de plein texte, et seulement pour le lecteur qui a le droit de le lire.
5. **Le prompt du chat nomme les outils de papiers**, et dit quand s'en servir.

## 3. Ce que cette décision NE fait pas

- **Elle ne change rien à ce qui part vers Anthropic** quand le chat répond : pour qu'un
  modèle réponde « ton passeport expire le… », il doit lire le numéro. C'était déjà le cas
  avec la case cochée ; seul le défaut change. Écrit ici pour qu'aucune session ne présente
  « seulement moi » comme « jamais hors de la base ».
- **Elle ne ferme pas N2 au MCP.** Marc n'a parlé que des papiers confidentiels ; N2 garde ses
  deux verrous d'origine.
- **Elle n'ajoute pas de re-authentification.** Elle n'existe toujours nulle part ici.

## 4. Ce que ça coûte, dit une fois

- Marc perd le contenu de ses papiers d'identité **dans claude.ai** (le connecteur) : il y
  voit qu'ils existent, leurs dates, leur domaine. Le contenu ne se lit que dans le chat de la
  Mémoire.
- La recherche N3 en mémoire est bornée à la fenêtre de lecture (`LIMITE_LECTURE_BASE`) :
  au-delà, elle le DIT et invite à filtrer. Mesuré le 24/09 : 44 papiers dans `04` et 63 dans
  `01`, plus les papiers fiscaux de `02` — loin des 500.

## 5. Les gardes

- `tests/niveau3Lecteurs.test.ts` : un lecteur hors liste ne reçoit jamais de N3, même avec
  `MEMORYAI_N3_CHAT=1` et `inclure_n3: true` ; `tools/list` ne propose plus `inclure_n3` au
  MCP ; le chat, lui, le reçoit ; la recherche par titulaire et le plein texte N3 marchent pour
  le chat et ne rendent rien de N3 au MCP.

## 6. Ce que la relecture critique a trouvé avant la fusion (PR #71)

Le contenu N3 ne sortait déjà plus vers le MCP ; trois canaux restaient ouverts, tous fermés
dans la même PR :

- **Un oracle par filtre** : `types: ["passeport"]` rendait au MCP le SOMMAIRE du passeport, et
  « aucune pièce » pour un type absent — le type et l'émetteur d'un papier N3, que le sommaire
  cache justement, se déduisaient. Désormais, tant que la politique ne sert pas N3, un filtre
  de facette exclut les papiers N3.
- **Les facettes ne suivaient que le LECTEUR** : le chat rendait les titulaires N3 interrupteur
  coupé et case décochée. Elles suivent maintenant la politique entière (`niveauMaxServi`) — le
  MCP n'y voit plus non plus les facettes N2 sans `inclure_n2`, ce qui était vrai des pièces et
  pas de leurs facettes.
- **Le journal** notait `niveauMaxServi: 0` pour des facettes N3 déchiffrées.

Et côté chat : une conversation illisible, un double clic pendant une réouverture, un
identifiant de session Claude Code accepté comme suite par `/api/chat`.
