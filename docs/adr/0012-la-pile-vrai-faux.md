# ADR 0012 — La pile « vrai / faux » : Marc juge ce que la mémoire a lu et déduit

- **Statut** : ACCEPTÉ (Marc, 24/09/2026 — « fait L3 », puis quatre arbitrages le même soir).
- **Portée** : lot 3 du chantier « la Mémoire sait tout de moi ». Ne touche ni au vocabulaire,
  ni aux niveaux, ni au contrat d'écriture des PIÈCES (une pièce n'est jamais modifiée par un
  avis). Ajoute une table, et un attribut dans ce que le chat reçoit.

## 1. Ce qui a été mesuré avant d'écrire

- **Il n'y a presque rien à valider côté faits** : 1 fait `propose` sur 364 le 24/09. Le
  « vrai / faux » de Marc ne trouverait rien à juger s'il ne portait que sur les faits.
- **Ce qui est nouveau et incertain, ce sont les PAPIERS LUS** : la lecture vision (ADR 0010)
  extrait tout d'une photo — titulaire, numéros, dates — et personne ne l'a relue. Le chat
  s'en sert déjà pour répondre (ADR 0011). Une lecture fausse d'un passeport est servie avec
  l'aplomb d'une vraie.
- **`/questions` affiche toutes les questions ouvertes d'un coup**, et `/a-valider` est une
  liste de cent faits. Aucune des deux n'est un geste qu'on fait debout, au pouce.

## 2. La décision

1. **Une PILE, une carte à la fois**, à la place de la page Questions. Trois familles :
   - *Ce que j'ai lu* : un papier LU (extracteur autre que l'inventaire), vivant, pas encore
     jugé. **Une carte par papier** (arbitrage de Marc) : son titre, son résumé, 3 à 5 champs
     clés, et le lien vers sa fiche et vers le document ;
   - *Ce que j'ai déduit* : un fait `propose` ;
   - *Ce qui manque* : une question ouverte (texte libre ou choix).
2. **L'ordre : le plus utile d'abord** (arbitrage de Marc). Un papier dont le titulaire est lu
   avec moins de 80 % de certitude passe en tête (« ce papier est-il bien à toi ? » est la
   question qui change le plus de réponses), puis identité (04) et administratif (01), puis
   les échéances de l'année qui vient, puis le reste du plus récent au plus ancien. Les
   déductions et les questions **s'intercalent** : une carte sur quatre, tant qu'il y en a.
   L'ordre est une fonction PURE (`lib/pile/composer.ts`), testée sans base. ⚠️ L'intercalage
   se compte sur les cartes JUGÉES depuis la dernière déduction ou question, pas sur la
   position : l'écran ne montre que la carte du dessus (revue #73).
3. **Les gestes** : Vrai / Faux / Passer, **trois boutons toujours visibles** (clavier et
   lecteur d'écran), et **glisser** la carte sur téléphone (droite = vrai, gauche = faux), qui
   ne fait que déclencher le bouton correspondant (arbitrage de Marc).
   - *Papier, vrai* : l'avis `vrai` est consigné. Le chat reçoit `avis_marc="confirme"`.
   - *Papier, faux* : l'avis `faux` est consigné, avec une remarque facultative (≤ 200
     caractères, **chiffrée** : elle peut nommer un numéro). Le papier **reste servi**, marqué
     `avis_marc="conteste"`, et le chat a pour consigne de ne jamais présenter sa lecture comme
     sûre (arbitrage de Marc : « contesté, relu »). Rien n'est effacé.
   - *Fait, vrai / faux* : `valider` / `rejeter`, les mutateurs de `/a-valider`, inchangés.
   - *Question* : les formulaires existants (réponse libre, choix, écarter).
   - *Passer* : consigné, la carte repart en fin de pile.
4. **Une table `avis_pile`**, en ajout seul (jamais de mise à jour) : genre, identifiant,
   verdict, remarque chiffrée, date. Le verdict EN VIGUEUR est le plus récent. Changer d'avis
   ajoute une ligne ; l'ancien reste lisible. Un papier RELU (nouvelle pièce, ADR 0008) a un
   nouvel identifiant : il revient dans la pile, sans avis, et c'est voulu — c'est une autre
   lecture.
5. **Une seule carte rendue par chargement.** Le garde-fou de `/pieces` (« cent résumés en
   clair dans le HTML à chaque chargement ») vaut ici : la page ne déchiffre que la carte
   montrée. Elle applique la même politique que la fiche `/pieces/[id]`.

## 3. Ce que cette décision NE fait pas (lot 3b)

- **La relecture d'un papier contesté.** « Contesté, relu » demande que DriveAI relise ce
  papier en priorité ET que la Mémoire accepte cette relecture alors qu'elle vient d'un
  extracteur du MÊME rang (ADR 0008 n'accepte qu'un rang strictement supérieur). Les deux
  touchent deux dépôts et un amendement de l'ADR 0008 : lot 3b, à part. D'ici là, un papier
  contesté reste marqué comme tel dans le chat.
- **Les doublons** (« ces cinq photos sont-elles le même passeport ? ») : fusionner des pièces
  est une écriture, pas un avis. Lot 3b.
- **Aucun modèle ne fabrique les cartes.** Tout vient de ce qui est déjà en base. Rien de neuf
  ne part vers un modèle hormis l'attribut `avis_marc` dans les résultats d'outil — du chat ET
  du MCP, puisque les deux passent par la même balise. C'est une métadonnée (« Marc a contesté
  cette lecture »), jamais un contenu : la remarque ne sort d'aucun outil.

## 4. Les gardes

- `tests/pile.test.ts` : l'ordre (titulaire incertain d'abord, intercalage, passé en fin) ;
  un papier jugé ne revient pas ; un papier relu revient ; un avis ne modifie aucune pièce ;
  la remarque est chiffrée en base ; le chat reçoit `avis_marc` ; le MCP n'y gagne aucun
  contenu ; chaque action revérifie la session (`tests/gardePages.test.ts`).
