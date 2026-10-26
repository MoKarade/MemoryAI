# ADR 0023 — Des faits DÉDUITS par une règle, reliés à ceux d'où ils viennent

- **Statut** : **accepté pour l'âge** ; **OK de Marc pour le code le 26/10/2026 à
  13:07Z** (carte « Je code tout ce qui reste, dans l'ordre proposé ? », réponse « Oui, tout, dans
  cet ordre »), et **niveau de l'âge tranché par Marc le 26/10/2026 à 14:40Z : niveau 1** (carte « Ton
  âge déduit : LIA peut le dire partout ? », option « Niveau 1, LIA le dit partout »). Proposé le
  24/10/2026 (fil MemoryAI) pour appliquer la demande de Marc du 24/10/2026 (18:44Z : « mon âge n'est
  écrit dans aucun papier, mais ça devrait être déduit du reste et créer des liens »). Tâche :
  MemoryAI#185. Première règle livrée : `age` (voir « Mise en œuvre de l'âge »). Les règles suivantes
  restent à décider une à une.
- **Amont** : ADR 0001 (frontière, niveaux), 0003 (un fait mécanique ne passe pas par l'œil de
  Marc), 0007 et 0011 (le niveau 3, papiers d'identité), décision de Marc du 15/09 (règles
  d'abord, modèle ensuite ; ce qui est établi et ce qui est deviné restent distincts).

## Contexte

La mémoire ne garde que ce qu'une source DIT. Beaucoup de ce que Marc attend se CALCULE : son âge
(date de naissance), l'ancienneté d'un bail, l'échéance d'un papier, le nombre d'années à une
adresse. Aujourd'hui personne ne fait ce calcul, et LIA le refait (ou l'invente) à chaque question.

## Décision

1. **Un extracteur `deduction-v1`**, du CODE pur (aucun modèle, aucun coût). Chaque règle est une
   fonction pure, nommée et testée : `age` (date de naissance), `anciennete` (date de début),
   `echeance-dans` (date d'expiration). La liste est FERMÉE ; ajouter une règle est une décision,
   écrite dans cet ADR.
2. **Un fait déduit dit qu'il l'est** : `provenance.extracteur = "deduction-v1"`, la règle dans ses
   attributs, et la liste des `id` de ses sources. Il est dessiné à part dans le graphe et relié à
   chacune de ses sources par un lien `origine: "deduction"`.
3. **Il hérite du niveau le plus haut de ses sources, jamais moins.** Une date de naissance vit dans
   un passeport (niveau 3) : l'âge en déduit l'année, donc il naît au niveau 3, fermé à LIA sur le
   hub. Le descendre est un choix de Marc, pas du code : **pour l'âge, Marc l'a fait, au niveau 1**
   (voir « Mise en œuvre de l'âge »).
4. **Il se valide seul, s'il ne vient que de faits validés** : c'est un fait mécanique au sens de
   l'ADR 0003 (aucun modèle ne l'a touché). Une source proposée ou rejetée laisse le déduit en
   `propose` ; une source qui change ou disparaît le fait recalculer ou retirer au passage suivant.
5. **Il se met à jour seul** : la passe tourne avec l'apprentissage (toutes les 3 h), idempotente
   (même règle, mêmes sources, même jour = même fait). Un âge change au jour anniversaire, pas
   avant.
6. **Jamais** : une déduction tirée d'un fait deviné par un modèle, ou d'un autre fait déduit
   (pas de chaîne, une seule marche). Ligne et test au point d'écriture.

## Mise en œuvre de l'âge (26/10/2026)

Mesuré avant d'écrire, trois points de la décision ne tenaient pas tels quels ; voici ce qui est fait
à la place, et pourquoi.

- **Les sources sont des PAPIERS, pas des faits.** Aucun fait ne porte la date de naissance : elle
  vit dans les champs libres d'un papier (`date de naissance`, AAAA-MM-JJ, écrite par DriveAI). La
  passe (`lib/deductionPasse.ts`) lit les papiers dont le titulaire est Marc (noms de
  `personnes.est_marc`, ADR 0020, comparés à l'ordre des mots près) ; le papier d'un proche ne compte
  pas. Deux papiers de Marc qui se contredisent : abstention (`contradiction`), jamais un choix.
  Aucun nom de Marc connu : abstention (`aucun-nom`). La date est lue en mémoire et ne s'écrit nulle
  part.
- **Le lien à la source passe par la provenance** (point 2) : `source_ref` = le fileId NU du papier,
  comme DriveAI l'écrit. La règle `meme-source` du graphe (MemoryAI#186) relie donc l'âge aux faits
  du même papier, sans origine de lien nouvelle. La règle se lit dans `extracteur = deduction-v1` et
  le prédicat : les attributs sont une liste fermée (`type`, `emetteur`, `annee`, `echeance`).
- **Le prédicat est `profil.age`**, texte (« 36 ans »), une seule valeur, borné par `valide_de` (dernier
  anniversaire) et `valide_a` (veille du prochain). Le domaine `identite` est N3 par construction, et
  le N3 refuse tout texte : l'âge ne peut pas y vivre. La provenance ne porte ni dossier ni type de
  document, qui le monteraient au N3. **Son niveau est 1, choisi par Marc le 26/10/2026 à 14:40Z** :
  LIA le dit partout, et l'année de naissance devient déductible à un an près (conséquence que Marc
  a lue sur la carte). Il entre au profil de LIA (`PREDICATS_PROFIL`) et n'est jamais demandé en
  question.
- **Validation et mise à jour** (points 4 et 5) : la passe valide le fait qu'elle crée (`valider`,
  comme une correction de Marc), ce qui périme l'âge d'avant le jour anniversaire, sans l'effacer.
  Elle tourne une fois par jour avec le cron d'apprentissage (Vercel gratuit n'en permet pas plus) ;
  l'âge change une fois par an, c'est assez. Le sauvetage en cours la suspend (`sauvetage`).

## Ce qui reste ouvert

- [À vérifier] les règles suivantes (durée entre deux emplois, âge d'un véhicule) : une à la fois,
  chacune ajoutée ici.
