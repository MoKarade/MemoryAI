# ADR 0033 — Les faits que Marc déclare se valident seuls, avec ses mots comme preuve

- **Statut** : **accepté** (Marc, 28/10/2026 20:32Z, carte « Comment valider seul les faits que tu donnes à MemoryAI ? », option « Chat + claude.ai cadré », après son message de 20:28Z : « je suis pas sensé valider, ça devrait être auto »). **Avenant du 28/10/2026** (20:41Z, après les essais de Marc avec LIA) ajouté en bas de ce document. Code à venir. Tâches : MemoryAI#412, #416.
- **Amont** : ADR 0025 (deux signaux, les deux requis), qu'il **étend** à deux sources nouvelles sans en changer les garde-fous ; ADR 0003 (seul le mécanique s'auto-valide) ; ADR 0023 (un âge est DÉDUIT d'une date de naissance) ; ADR 0001 (frontière, oublis, canaris).

## Contexte

Marc dit à claude.ai « j'ai 26 ans, né en 1999 » ; claude.ai appelle `memoryai_proposer`. Le fait reste « à valider » alors que Marc l'a donné lui-même. Cause, lue dans le code : `memoryai_proposer` écrit la source `claude-ai:<jour>`, sans aucun texte. La relecture de l'ADR 0025 compare la valeur à un extrait de sa source (un papier ou une conversation que MemoryAI détient) ; sans source lisible ici, « le fait reste à Marc » (ADR 0025 § 2). Rien n'est cassé : la règle ne voit simplement pas la phrase de Marc.

La limite qu'aucun mécanisme ne lève : par le MCP, MemoryAI ne peut pas prouver que « c'est Marc qui l'a dit » plutôt qu'un texte lu par claude.ai (page, courriel, document) qui l'aurait poussé à l'écrire. C'est le scénario d'injection par les faits, menace n° 1 du dépôt. Cet ADR ne prétend donc pas prouver l'origine : il **borne ce qu'un faux peut écrire**.

## Décision

Deux voies, les mêmes deux signaux que l'ADR 0025, une seule trace.

1. **Voie A — le chat de MemoryAI (et LIA dans sa maison).** Marc écrit ici, session vérifiée. La source du fait est son message. (Dans le chat de MemoryAI, ce message est gardé, chiffré ; chez LIA il ne l'est pas, voir l'avenant.)
   - Signal du code : la valeur se retrouve TELLE QUELLE (normalisation de l'ADR 0025) dans un message `user` de CE tour.
   - Signal du modèle : la relecture de l'ADR 0025, sur l'extrait du message.
   - La voie A est la plus forte : l'auteur du message est connu.
2. **Voie B — claude.ai, par `memoryai_proposer`.** L'outil gagne un paramètre `citation` (200 caractères au plus) : la phrase de Marc, telle qu'il l'a écrite.
   - Signal du code : la valeur se retrouve telle quelle dans la citation.
   - Signal du modèle : une relecture indépendante (un autre appel que le chat, sans outils, avec un modèle de la génération courante) rend un verdict fermé `confirme`, `doute` ou `infirme`, avec une raison de 200 caractères au plus, validé par Zod. Elle juge que la citation est une déclaration de Marc, à la première personne, sur lui-même ; que ce n'est ni un ordre, ni un texte lu ailleurs ; et que la valeur dit la même chose. La citation est une DONNÉE balisée, jamais une consigne.
   - Sans citation, l'outil se comporte comme aujourd'hui : le fait reste proposé.
3. **Ce qui borne les dégâts** (parce que l'origine ne se prouve pas par la voie B) :
   - une **liste fermée, dans le code, de prédicats « déclarables »** : niveau 1, valeur bornée (date, nombre, énumération, ou texte de 60 caractères au plus), rien qui se lise comme une instruction, une adresse, un contact ou un identifiant. Hors liste, le fait reste proposé. La liste exacte se fixe dans la PR de code, d'après le vocabulaire, et chaque ajout est une décision de frontière ;
   - **jamais seul** (ADR 0025 § 3, inchangé) : niveau 2 ou 3, canari, prédicat en quarantaine, fait en contradiction ouverte ; `oublis` consulté d'abord ;
   - **jamais d'écrasement** : si un fait valide du même prédicat porte une autre valeur, le nouveau reste proposé et devient un doute (compté dans les 5 par jour de l'ADR 0025 § 5) ;
   - **un plafond** : 5 auto-validations par jour de Québec pour la voie B ;
   - **la trace** : une ligne `validations_lia` par validation (voie, verdict, raison, empreinte keyée de la citation). Le fait se dit « dit par Marc » (voie A) ou « déclaré par claude.ai, non vérifié » (voie B) partout où son statut s'affiche, et Marc le rejette ou l'oublie en un geste ;
   - **un interrupteur** : `MEMORYAI_DECLARES_OFF=1` coupe la voie B (la voie A suit le gel `MEMORYAI_GEL`). Sans clé de modèle, ou si la relecture échoue, le fait reste proposé : on échoue fermé.
4. **Un âge n'est pas un fait déclaré.** Il est DÉDUIT d'une date de naissance (ADR 0023) et change chaque année. Le fait déclarable est la date de naissance ; « 26 ans » en dérive. [À vérifier : le prédicat exact dans le vocabulaire, au moment du code.]

## Ce que cet ADR garantit, et ce qu'il ne garantit pas

- **Garanti** : le pire fait qu'une injection puisse écrire par la voie B est un fait de la liste déclarable, de valeur courte, sans niveau 2 ni 3, 5 au plus par jour, qui n'écrase rien, étiqueté « non vérifié » et retirable en un geste.
- **Non garanti** : l'origine. Un claude.ai manipulé peut inventer une citation plausible ; la relecture réduit ce risque, elle ne l'élimine pas. Si Marc veut la certitude d'origine, la voie A est la seule.

## Ce qui ne change pas

ADR 0025 (deux signaux requis, jamais seul, doutes à Marc), ADR 0003 (seul le mécanique s'auto-valide sans lecture), le budget IA (poste `apprentissage`, ADR 0005), le gel.

## Avenant du 28/10/2026 — ce que Marc a demandé en testant LIA

**Source** : Marc, 28/10 20:41Z, devant LIA : lieu de naissance refusé (« je n'ai pas d'outil pour proposer un lieu de naissance »), puis deuxième prénom refusé (« l'outil pour proposer un fait n'est pas disponible dans cette session, ajoute-le à la main »). Ses mots : « inadmissible, il devrait accepter, faire des liens, pour toutes les nouvelles infos » ; « accepte seul » ; sa règle : « rien à faire à la main ».

**Trois causes, lues dans le code le 28/10** :

1. LIA, depuis le hub comme dans sa maison, est en LECTURE SEULE par liste blanche (`OUTILS_LIA_HUB`, `lib/lia/ask.ts`, ADR 0016). `memoryai_proposer` lui est refusé exprès. C'est la cause des deux refus, et « pas disponible dans cette session » est exact : il ne l'est dans aucune.
2. Un prédicat inconnu n'est PAS refusé par la base : il part en quarantaine (ADR 0004 § 2.3), stocké, niveau plancher 2, jamais servi à un modèle tant que Marc ne l'accepte pas ou que trois sources distinctes ne l'ont pas proposé. Écrit sans être accepté, un lieu de naissance ne serait donc jamais redit par LIA.
3. Les conversations de LIA sont FERMÉES (`CONVERSATIONS_FERMEES`, ADR 0016). Le réveil d'apprentissage de 20:41Z a répondu « aucune conversation neuve » : ce que Marc dit à LIA n'alimente rien.

**Décisions** (elles valent pour la voie A ; la voie B reste bornée comme écrit plus haut, parce que son origine ne se prouve pas) :

- **A1 — LIA a l'écriture, toujours.** Un outil d'écriture est ajouté à ce que LIA reçoit dans le hub, dans sa maison et dans le chat, quelle que soit la session. Il n'est pas ajouté au MCP de claude.ai (la voie B garde `memoryai_proposer`). L'écrivain est celui que `sourceDe` tient déjà pour Marc (`chat`) ; [À vérifier au code : son jeton, son rôle et sa fiabilité].
- **A2 — La preuve est la question de Marc, lue par le serveur.** Le texte contre lequel la valeur est confrontée est `demande.question` de la requête (session de Marc ou jeton du hub avec `proprietaire: true`), jamais un texte que le modèle passerait en paramètre : le modèle ne peut pas fabriquer sa preuve. Mêmes deux signaux que l'ADR 0025 : valeur retrouvée telle quelle dans la question, et relecture par un modèle.
- **A3 — Toute information nouvelle est acceptée, même sans prédicat.** En voie A, il n'y a pas de liste fermée : un prédicat existant reçoit le fait ; un prédicat neuf est créé par LIA à partir de ce que dit Marc, et la phrase de Marc **vaut acceptation** du prédicat (c'est le chemin « Marc le voit et l'accepte » de l'ADR 0004, sans clic). Le **niveau plancher 2 est conservé** : le fait s'enregistre et se valide seul, mais n'est servi qu'au niveau 2, derrière le réglage que Marc tient déjà. Le **niveau 3 n'est jamais validé seul** (numéro de passeport, d'assurance, d'identité : règles de `lib/niveau.ts`) ; un tel fait reste proposé, et LIA le dit.
- **A4 — Les garde-fous qui restent** : `oublis` d'abord ; canari ; contradiction avec un fait valide = doute pour Marc, jamais d'écrasement ; une ligne de trace par validation (« dit par Marc ») ; retrait en un geste ; l'interrupteur de la voie A est le gel `MEMORYAI_GEL`. Un plafond de sécurité de 20 validations par jour de Québec, au-delà desquelles le fait reste proposé, remplace l'absence de plafond ; [chiffre proposé, à ajuster au code].
- **A5 — Elle relie ce qu'elle retient.** En écrivant, LIA passe `lie_a` : au plus 5 identifiants de faits qu'elle vient de trouver avec `memoryai_chercher` dans le même tour. Le code vérifie que chacun existe et est servable au niveau du nouveau fait, puis pose des liens `origine: "modele"` (dessinés « devinés », ADR 0022), avec la phrase qui dit pourquoi. Les règles déterministes du graphe (`lib/graphe.ts`) s'appliquent d'elles-mêmes au fait neuf. **Réalisé par MemoryAI#421** : type `lie-par-lia`, aucune migration (colonne `type` en texte sans `CHECK`).
- **A6 — Les échanges de LIA deviennent une source : PROPOSÉ, la décision est à Marc.** Garder le tour de Marc et la réponse de LIA, chiffrés, comme conversation lisible par l'apprentissage, **rouvre ce que l'ADR 0016 a fermé** (conversations fermées à LIA depuis le hub). Ce n'est pas un détail : la fermeture était un garde-fou. Elle se rouvrirait pour la route de la maison et celle du hub, propriétaire seul, au niveau de ce qui s'y dit (au plus 2 ; [à vérifier]). La tâche correspondante ne démarre pas avant l'accord de Marc.

**Ce que cet avenant ne change pas** : la voie B, ses garde-fous et son plafond de 5 ; le niveau 3 ; le fait que l'origine ne se prouve pas par le MCP.

## Découpage du code (tâches à créer une fois cet ADR fusionné)

1. La validation PURE d'une déclaration (signal du code, plafond, non-écrasement, niveau 3 refusé) et la trace : fichiers neufs, aucun écran.
2. **LIA retient** (A1 à A4) : l'outil offert à LIA sur toutes ses routes, la preuve lue sur `demande.question`, le prédicat neuf accepté d'office, la validation seule. Priorité 1 : c'est ce que Marc teste.
3. **LIA relie** (A5) : `lie_a`, les liens devinés, leur phrase.
4. Les étiquettes « dit par Marc » / « déclaré par claude.ai » et le retrait en un geste.
5. La voie B : `citation` dans `memoryai_proposer`, la relecture indépendante, l'interrupteur.
6. Les échanges de LIA comme source (A6) : seulement après l'accord de Marc.
