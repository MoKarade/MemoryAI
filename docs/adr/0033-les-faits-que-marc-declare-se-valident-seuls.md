# ADR 0033 — Les faits que Marc déclare se valident seuls, avec ses mots comme preuve

- **Statut** : **accepté** (Marc, 28/10/2026 20:32Z, carte « Comment valider seul les faits que tu donnes à MemoryAI ? », option « Chat + claude.ai cadré », après son message de 20:28Z : « je suis pas sensé valider, ça devrait être auto »). Code à venir. Tâche : MemoryAI#412.
- **Amont** : ADR 0025 (deux signaux, les deux requis), qu'il **étend** à deux sources nouvelles sans en changer les garde-fous ; ADR 0003 (seul le mécanique s'auto-valide) ; ADR 0023 (un âge est DÉDUIT d'une date de naissance) ; ADR 0001 (frontière, oublis, canaris).

## Contexte

Marc dit à claude.ai « j'ai 26 ans, né en 1999 » ; claude.ai appelle `memoryai_proposer`. Le fait reste « à valider » alors que Marc l'a donné lui-même. Cause, lue dans le code : `memoryai_proposer` écrit la source `claude-ai:<jour>`, sans aucun texte. La relecture de l'ADR 0025 compare la valeur à un extrait de sa source (un papier ou une conversation que MemoryAI détient) ; sans source lisible ici, « le fait reste à Marc » (ADR 0025 § 2). Rien n'est cassé : la règle ne voit simplement pas la phrase de Marc.

La limite qu'aucun mécanisme ne lève : par le MCP, MemoryAI ne peut pas prouver que « c'est Marc qui l'a dit » plutôt qu'un texte lu par claude.ai (page, courriel, document) qui l'aurait poussé à l'écrire. C'est le scénario d'injection par les faits, menace n° 1 du dépôt. Cet ADR ne prétend donc pas prouver l'origine : il **borne ce qu'un faux peut écrire**.

## Décision

Deux voies, les mêmes deux signaux que l'ADR 0025, une seule trace.

1. **Voie A — le chat de MemoryAI (et LIA dans sa maison).** Marc écrit ici, session vérifiée, et son message est déjà gardé (chiffré) par MemoryAI. La source du fait est ce message.
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

## Découpage du code (tâches à créer une fois cet ADR fusionné)

1. La validation PURE d'une déclaration (signal du code, liste des prédicats, plafond, non-écrasement) et la trace.
2. La voie B : `citation` dans `memoryai_proposer`, la relecture indépendante, l'interrupteur.
3. La voie A : la source « message de Marc » dans le chat et chez LIA.
4. Les étiquettes « dit par Marc » / « déclaré par claude.ai » et le retrait en un geste.
