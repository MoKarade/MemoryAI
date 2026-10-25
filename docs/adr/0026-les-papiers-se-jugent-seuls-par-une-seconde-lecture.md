# ADR 0026 — Un papier se juge seul quand une seconde lecture de DriveAI concorde avec la première

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique le choix de Marc sur la carte du
  24/10 21:55Z, « Seconde lecture par DriveAI », et sa demande de 18:42Z : « pour pas avoir à tout
  valider ». Tâche : MemoryAI#219.
- **Amont** : ADR 0012 (la pile vrai / faux), ADR 0015 (le jeton d'écrivain de DriveAI), ADR 0025
  (deux signaux ou rien, pour les faits), ADR 0004 §6.2 (une pièce rapporte ce qu'un papier dit).

## Contexte

La mesure de l'ADR 0025 en production (24/10 21:44Z, `relecture.file`) donne **0 fait `propose`**.
Le PC a ensuite relevé (21:48Z, en lecture seule) **2 295 papiers à juger** dans la pile. Les
« 3 000 » à valider sont donc des PAPIERS (« Ce que j'ai lu, est-ce juste ? ») et non des faits.

Un papier ne peut pas se vérifier ici contre sa source : MemoryAI ne garde que ce que DriveAI en a
EXTRAIT, jamais le document (ni jeton Google, ni fichier). Comparer l'extraction à elle-même ne
prouverait rien. Seul DriveAI tient le document.

## Décision

1. **Deux lectures indépendantes, comparées par du code.**
   - La **première** est celle que MemoryAI garde déjà : la pièce (Sonnet en vision pour la
     campagne `v3-a`, selon `RATTRAPAGE_PIECE_VISION` de DriveAI).
   - La **seconde**, DriveAI la fait **à l'aveugle** : elle ne voit pas la première lecture. Elle
     passe par un **autre canal** (Haiku sur le texte OCR) et un prompt dédié, qui ne demande que
     les champs comparés.
   - **Champs comparés** : titulaire, date du document, échéance, émetteur. Ils sont normalisés
     (casse, espaces, accents ; une date se lit sous ses formes usuelles, comme dans l'ADR 0025).
     Un champ présent d'un côté et absent de l'autre compte comme une discordance.
   - **Concordance complète** : le papier est jugé « vrai par LIA ». **Toute** discordance le
     laisse à Marc.
2. **La porte** : `POST /api/pieces/relecture`, réservée au jeton d'écrivain de DriveAI, sur le
   modèle de `/api/pieces` (temps constant, 401 avec un jeton faux, 503 sans le réglage côté
   serveur, gel et sauvetage respectés). Le corps contient le `fileId` de l'exemplaire principal,
   les quatre champs (bornés, validés par Zod, sans texte libre) et l'extracteur. La réponse ne
   porte que des nombres et une décision fermée.
3. **Jamais seul** : un papier de niveau 2 ou 3, un papier dont un champ porte un canari
   (`estCanari`), un papier oublié ou remplacé. Ceux-là restent à Marc, quoi que disent les
   lectures.
4. **La trace** : chaque comparaison écrit une ligne `relectures_pieces` (migration additive). Elle
   contient la pièce, la décision, les champs qui divergent (leurs NOMS seulement), les empreintes
   keyées des deux lectures, les deux extracteurs et l'heure. Les valeurs de la seconde lecture ne
   sont pas gardées : seules leurs empreintes le sont. Un papier jugé ainsi se dit « vrai par LIA »
   sur sa carte et dans l'onglet Apprentissage. Marc peut le dire faux comme tout autre.
5. **Le verdict « vrai par LIA »** sort le papier de la pile, sans entrer dans `avis_pile` : un avis
   de la pile reste un geste de Marc. La pile lit la trace pour l'écarter.
6. **Les doutes vont à Marc, cinq par jour au plus** : les papiers discordants passent en tête de
   la pile, avec les noms des champs qui divergent (« la date d'échéance ne concorde pas »).
7. **Le coût est chez DriveAI**, sous ses freins de campagne. Estimation : environ 0,004 $ par
   papier en Haiku sur OCR (mesure de DriveAI du 21/09), soit environ 9 $ pour 2 295 papiers
   [Probable]. Ce chiffre se remesure sur une première tranche avant le reste.

## Ce qui reste ouvert

- [À vérifier] La part des papiers de niveau ≥ 2 dans les 2 295. Ils restent à Marc : si elle est
  grande, la pile ne descendra pas sous 50, et il faudra le dire à Marc, chiffres à l'appui.
- [À vérifier] Les papiers sans texte OCR (photos) : la seconde lecture doit alors passer par la
  vision avec un AUTRE modèle que la première, ou bien le papier reste à Marc.

## Amendement du 25/10/2026 : Marc ne juge plus rien

Marc, 25/10/2026 à 20:21Z : « jveux plus jamais juger des déductions de lia de memory ou autre ».
Tâche : MemoryAI#231. Cet amendement remplace ce qui, plus haut, « laisse à Marc » un papier :

- **Rien n'est plus posé à Marc** : ni pastille « N à juger », ni bulle de LIA, ni lien « Juger
  maintenant », ni doutes en tête de la pile. Le point 6 (cinq doutes par jour) est abandonné.
- **Un papier sans concordance** (discordance, pas encore relu, niveau 2 ou 3, canari) reste
  « non confirmé ». Il n'est jamais dit « vrai par LIA ». Seule une concordance (point 1) le
  confirme. Ce que LIA fait d'un papier non confirmé dans ses réponses (le citer comme tel, ou
  l'écarter) suit le choix de Marc sur la carte du 25/10.
- **Les verrous ne bougent pas** : trancher seule ne baisse aucun verrou de niveau (ADR 0007).
- **Par étapes** : l'accueil et l'onglet Mémoire cessent de dire « à juger » d'abord. La pile
  (`en_pile`, `/questions`) et le compte « à juger par Marc » de `GET /api/etat` suivent dans une
  PR à part.

## Amendement du 25/10/2026 : un autre canal, et la liste de ce qui reste à relire

Questions de DriveAI (25/10, tâche DriveAI#678), au moment de construire la seconde lecture :

- **Un autre canal, vérifié par la porte.** Le point 1 dit « un autre canal » ; la porte ne
  refusait que la même étiquette. Une seconde lecture Haiku sur le même texte OCR qu'une première
  lecture Haiku sur OCR hériterait de la même erreur d'OCR, et la concordance ne prouverait rien.
  La porte refuse donc `meme_canal` : deux lectures du texte OCR, jamais ; deux lectures par la
  vision, seulement par deux modèles différents ; texte et vision, oui (`lecturesIndependantes`).
  Le canal se lit dans l'étiquette (« vision » ou non), le modèle dans son premier mot.
- **La liste à relire** : `GET /api/pieces/relecture?canal=texte|vision&limite=1..50`, même jeton
  d'écrivain que le POST. Elle rend le `file_id` de l'exemplaire principal et l'étiquette de la
  première lecture des papiers vivants, lus, de niveau 0 ou 1, jamais relus, lisibles par ce canal ;
  plus le compte de ce qui reste, par étiquette. Ni valeur, ni domaine, ni nom : la seconde lecture
  reste aveugle. Les `file_id` sont ceux de DriveAI, qui détient déjà les documents. Sans elle,
  DriveAI paierait des lectures que la porte refuserait (`inconnu`, niveau 2 ou 3).
- **Conséquence, dite à Marc** : un papier dont la première lecture est Haiku sur OCR ne peut être
  confirmé que par une lecture par la vision, plus chère. La répartition des étiquettes se lit
  dans `parExtracteur`.
