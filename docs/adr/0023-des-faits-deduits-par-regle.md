# ADR 0023 — Des faits DÉDUITS par une règle, reliés à ceux d'où ils viennent

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique la demande de Marc du 24/10/2026
  (18:44Z : « mon âge n'est écrit dans aucun papier, mais ça devrait être déduit du reste et créer
  des liens »). Tâche : MemoryAI#185. Le code attend l'OK de Marc (protocole,
  `docs/claude/11-protocole.md`).
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
   hub. Le descendre est un choix de Marc, pas du code (voir « ouvert »).
4. **Il se valide seul, s'il ne vient que de faits validés** : c'est un fait mécanique au sens de
   l'ADR 0003 (aucun modèle ne l'a touché). Une source proposée ou rejetée laisse le déduit en
   `propose` ; une source qui change ou disparaît le fait recalculer ou retirer au passage suivant.
5. **Il se met à jour seul** : la passe tourne avec l'apprentissage (toutes les 3 h), idempotente
   (même règle, mêmes sources, même jour = même fait). Un âge change au jour anniversaire, pas
   avant.
6. **Jamais** : une déduction tirée d'un fait deviné par un modèle, ou d'un autre fait déduit
   (pas de chaîne, une seule marche). Ligne et test au point d'écriture.

## Ce qui reste ouvert

- **Le niveau de l'âge** : le garder au niveau 3 (LIA du hub ne le voit pas) ou le servir au
  niveau 1 (LIA le dit partout, l'année de naissance devient déductible). Choix de Marc.
- [À vérifier] les règles suivantes (durée entre deux emplois, âge d'un véhicule) : une à la fois,
  chacune ajoutée ici.
