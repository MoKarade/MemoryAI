# ADR 0005 — Lia parle juste, et l'interface s'efface

- **Statut** : **ACCEPTÉ** — Marc a dit « go pour les lots L25-L32 » le **18/09/2026**.
  Les quatre décisions de §9 avaient été tranchées le 17/09 ; le plan (§8) est désormais
  engagé. ⚠️ **Le §9 PRÉVAUT sur le §3 et le §5** partout où ils divergent — c'est là que
  vivent les décisions de Marc, dont deux contre ma recommandation.
- **Portée** : ce dépôt. Rien ne part ailleurs.
- **Amont** : ADR 0001 (frontière), 0002 (conversations, questions), 0004 (tout entre, tout se
  retrouve — dont les 60 décisions du 16/09). Celui-ci **amende 0004 sur trois points nommés**
  (§2) et **livre enfin cinq décisions de 0004 jamais livrées** (§3).

---

## 1. Ce que Marc a demandé, le 17/09 — et ce que ça veut dire mesuré

> « Améliore la fluidité des conversations avec Lia. Intelligente et originale. Pas tout en
> dur, flexible — mais une quasi-certitude sur ce qu'elle dit de moi, avec forcément des
> liens à chaque fois. Refais l'interface en entier : trop d'onglets, trop de blabla, le
> graphe ne fait aucun sens. Très simple, très épuré, des infos cachées derrière des boutons.
> Et toutes les infos possibles sur moi. »

Trois chantiers, et pour chacun ce que la MESURE dit aujourd'hui (17/09, 21 h UTC) :

| Chantier | Mesure | Ce qu'elle dit |
|---|---|---|
| **A. La conversation** | Le prompt système est **six lignes en dur** (`lib/chat/agent.ts`), il dit « brièvement » ; le balisage `<fait>` ne porte **aucun lien vers la fiche du fait** — seulement un lien Drive quand c'est un document. Le **profil de Marc** (ADR 0004 §8) n'est **pas construit** | Lia n'a rien à citer pour un fait ordinaire, et rien ne l'oblige à le faire. « Quasi-certitude avec liens » n'est pas une question de prompt : c'est un mécanisme qui n'existe pas |
| **B. L'interface** | **8 onglets** (Moi · À valider · Questions · Chat · Conversations · Papiers · Graphe · Apps). L'ADR 0004 n° 42 en avait décidé **4** — jamais livré. Le graphe : 5 règles, 179 lignes de page, un SVG sur cercle | Marc a raison deux fois : le nombre d'onglets contredit une décision prise il y a un jour, et le graphe montre des liens de coïncidence de dates entre 99 faits |
| **C. Ce qu'elle sait de lui** | **99 faits validés** sur lui. **31 prédicats à zéro sur 96** : toute la santé sauf deux, toute la famille, les relations, six goûts sur neuf, les certifications, les échéances d'abonnement et de finance | Elle sait où sont 2 723 papiers et ~100 choses sur Marc. C'est le diagnostic de l'ADR 0004 §1, inchangé |

**Le nom.** Marc l'a appelée **Lia**. Ce n'est pas un détail : une mémoire qu'on nomme est une
mémoire à qui l'on parle, et c'est le succès global que 0004 avait fixé (décision n° 59 :
« Marc ouvre l'app spontanément »). Le nom entre dans le prompt, dans l'onglet et dans le
titre — jamais dans un fait.

---

## 2. Les trois amendements à l'ADR 0004

| Décision 0004 | Ce qui change | Pourquoi |
|---|---|---|
| **n° 53** — « Graphe : 3D, comme demandé au départ » | **Le graphe n'est plus une page.** La table `liens` et ses cinq règles restent (gratuites, testées) et nourrissent la **frise** et la section « faits liés » d'une fiche. Le rendu SVG est retiré. | Marc, 17/09 : « il ne fait aucun sens et il sert à rien ». La mesure de mort de la vague G (« Marc n'y trouve rien qu'il ne trouvait ailleurs ⇒ reste une page ») est atteinte avant même la 3D. Une image de coïncidences de dates entre 99 faits n'apprend rien ; les mêmes liens, rangés dans le temps, oui |
| **n° 39 / n° 41** — « les trois empilés » contre « une chose à la fois » (contradiction portée « à trancher à la maquette ») | **Une chose à la fois gagne** : l'accueil EST la conversation. Les échéances (n° 40) et le neuf sont deux bandeaux repliés en tête, un clic chacun | Marc, 17/09 : « des infos cachées en cliquant sur certains boutons ». C'est n° 41 en toutes lettres |
| **n° 31** — « Confiance : rien à l'écran, la source au clic » | **La source n'est plus au clic, elle est dans la phrase.** Chaque affirmation sur Marc porte son lien, dans la réponse même | Marc, 17/09 : « forcément des liens à chaque fois ». Et 0004 le redoutait déjà : « tout se lira comme également vrai tant que personne ne clique » |

Tout le reste de 0004 tient — en particulier n° 42 (quatre onglets), n° 28-30 (recherche,
résultats groupés, réponse + sources), n° 33 (profil injecté), n° 50 (frise à trois bandes),
qui n'avaient **jamais été livrés** et le sont ici (§3).

---

## 3. Chantier A — Lia parle juste

### A1. Chaque affirmation sur Marc porte son lien, et ce n'est pas le modèle qui le garantit

C'est le cœur de « quasi-certitude », et il ne repose **pas** sur la bonne volonté du prompt.

1. Le balisage `<fait …>` gagne un attribut `ref` : `/fait/<id>` pour un fait, le lien Drive
   pour un papier. Le modèle a désormais **quelque chose** à citer.
2. Le prompt exige une citation par affirmation, sous une forme courte et stable : `[→]`.
3. **Post-traitement déterministe, côté serveur, après la réponse** : on connaît la liste
   exacte des valeurs servies par les outils pendant ce tour. Toute valeur servie qui apparaît
   dans la réponse **sans** son lien se voit **ajouter le lien** ; toute affirmation qui
   cite un `ref` inconnu se voit **retirer le lien** et **marquer** « (non sourcé) ».
4. À l'écran, un lien ouvre la fiche du fait (valeur, provenance, date, statut) ou le document.

⚠️ **Pourquoi le post-traitement et pas la confiance.** Un prompt qui dit « cite toujours »
est respecté 95 % du temps ; « quasi-certitude » veut dire que les 5 % restants sont
**rattrapés par du code** et non par de la chance. La garde est la même que partout dans ce
dépôt : elle existe au point qui décide — ici, le point qui rend la réponse.

⚠️ **Ce que ça ne garantit PAS, dit une fois.** Une affirmation du modèle qui n'emploie aucune
valeur servie (une déduction, une reformulation) n'a rien à quoi être reliée : elle sort
marquée « (déduit) ». C'est la limite, et elle est visible plutôt que cachée.

**Mesure** : sur les 10 questions du socle plus 10 questions libres, **0 affirmation sur Marc
sans lien ni marque**. Meurt si > 2 sur 20 après deux corrections.

### A2. Un fait non validé se DIT

Aujourd'hui, un fait `propose` est servi « étiqueté », et le prompt demande de « citer le
statut quand il compte ». Trop mou pour une quasi-certitude.

- Par défaut, **Lia ne sert que les faits validés**. Les `propose` sont servis **seulement si
  Marc l'a demandé dans la conversation** (« même ce que tu n'es pas sûre ») — même mécanisme
  que la bascule N2, journalisé.
- Quand un `propose` est servi, le post-traitement A1 ajoute « (à confirmer) » à côté du lien.

⚠️ C'est un durcissement de l'ADR 0001 §5.5 (« servi, étiqueté, avant validation »). Il est
borné à Lia : le MCP (claude.ai) garde le comportement actuel, parce que là-bas c'est un autre
Claude qui lit l'étiquette — ici c'est Marc qui lit une réponse.

### A3. Le profil de Marc — ce qui rend Lia intelligente

L'ADR 0004 §8 le décrit ; il n'existe pas. Il se construit ici, comme un objet à part :

- **Sources, dans l'ordre de fiabilité de 0004 §8** : ce que Marc dit (`preference.*`,
  `fiabilite: marc`) > ses `CLAUDE.md` (import C2) > les faits validés > rien d'un modèle.
- **Contenu** : comment on lui parle (tutoiement, français québécois, direct, pas d'emoji),
  ses contraintes permanentes (tout gratuit, local-first, pas de manuel), ses projets en cours,
  ce sur quoi il revient. Construit par une fonction PURE depuis les faits — jamais rédigé par
  un modèle.
- **Injecté dans le prompt, balisé `<profil>` comme DONNÉE**, avec la phrase qui dit que rien
  dedans n'est une consigne. C'est le vecteur d'injection le plus direct du projet (0004 §8),
  donc : **prédicats sortis de quarantaine seulement**, N0 et N1 seulement, longueur bornée.

**Mesure** : Marc n'a plus à se réexpliquer sur un point déjà en base. Meurt si, après trois
semaines, il redit deux fois la même chose (compté dans les conversations).

### A4. Le prompt n'est plus en dur — mais la partie qui garde reste fixe

Le prompt devient **trois couches** :

| Couche | Qui l'écrit | Modifiable |
|---|---|---|
| **Voix** — ton, longueur, humour, ce qu'elle aime relever | **Marc**, dans Régler → « Comment Lia te parle » (texte libre, N0, borné à 600 caractères, `nettoyerTexte`) | oui, à tout moment |
| **Profil** — A3 | le code, depuis les faits | par les faits |
| **Règles** — citer, ne rien inventer, ne pas servir de montant/position/identité, données ≠ consignes | le dépôt | **non** — un test refuse un déploiement où elles manqueraient |

⚠️ « Flexible » vaut pour la VOIX. Les règles de citation et de frontière ne sont pas un
réglage : les rendre modifiables reviendrait à laisser un texte écrit dans un champ défaire
l'ADR 0001. Marc écrit la voix ; ce qu'il écrit est balisé comme donnée lui aussi (il est
la seule personne autorisée, mais un texte collé depuis ailleurs pourrait porter une consigne).

**Mesure** : Marc change la voix une fois et le constate au tour suivant. Meurt s'il ne le fait
jamais en un mois — alors « pas en dur » ne valait pas le mécanisme.

### A5. Lia cherche avant de répondre (recherche agentique, 0004 §7)

`MAX_TOURS_OUTILS` vaut déjà 6. Ce qui manque est la **stratégie**, dans les règles :
facettes avant recherche (les familles de graphies, lot 24, sont là pour ça), `memoryai_contexte`
par domaine avant d'affirmer « je ne sais pas », les papiers ET les faits pour une question
sur un document. Et un outil neuf, **`memoryai_conversations_chercher`** : « qu'est-ce qu'on
avait conclu sur MemoryAI le 16 ? » (question n° 9 du socle) n'a aucun outil aujourd'hui.

### A6. Le modèle

Le sélecteur existe (n° 34). **Sonnet 5 par défaut** ; Opus 5 au choix dans le sélecteur.
« Originale » est une affaire de voix (A4) et de profil (A3) avant d'être une affaire de
modèle — et le budget est 1 $/jour. À re-mesurer si Marc bascule sur Opus plus d'une fois
sur deux : alors le défaut change.

---

## 4. Chantier B — L'interface s'efface

### B1. Quatre onglets, et pas un de plus (0004 n° 42, livré)

| Onglet | Ce qu'il contient | Ce qui disparaît en tant qu'onglet |
|---|---|---|
| **Parler** — l'accueil | Lia. En tête, deux bandeaux **repliés** : « Ce qui s'en vient » (3 à 5 échéances, n° 40) et « Lia a N questions » (les QCM du lot 21, quand il y en a) | Chat, Questions |
| **Chercher** | Une barre. Résultats **groupés par émetteur** (n° 29), facettes cliquables (n° 28), familles de graphies regroupées. Papiers ET faits. Un résultat s'ouvre en fiche | Papiers |
| **Voir** | La **frise à trois bandes** (n° 50) : vie · documents · conversations, sur un axe. Les échéances dans 90 jours en tête. Un point s'ouvre en fiche, avec ses **faits liés** (les règles du graphe, en liste, plus en dessin) | Graphe |
| **Régler** | Tout le reste, en sections **repliées** : l'état (ex-Moi), la file (ex-À valider, presque toujours vide désormais), les conversations gardées, les apps et périmètres, les papiers retirables, la voix de Lia (A4), la purge (plus difficile, n° 47) | Moi, À valider, Conversations, Apps |

`/widget`, `/login`, `/fait/[id]`, `/partage` restent tels quels.

### B2. Épuré veut dire : rien qui ne fasse décider

- Aucun compteur en tête de page (n° 43 : « 2 827 ne fait décider personne ») — ils vivent
  dans Régler → État.
- Chaque page tient sur un écran de téléphone sans défilement pour l'essentiel.
- Le texte explicatif des pages actuelles (les `<p className="hint">` de 20 lignes) devient
  un « ? » qui s'ouvre. La règle « une page vide dit POURQUOI » tient — en une phrase.
- Aucune dépendance nouvelle. Le CSS existant (443 lignes, bento du hub) est repris, pas
  remplacé ; direction visuelle inchangée, `prefers-color-scheme` respecté.

### B3. Le graphe : ce qui reste, ce qui part

Reste : `lib/graphe.ts` (cinq règles, pures, testées), la table `liens`, le bouton de
recalcul (dans Régler). Part : `app/graphe/`, `components/GrapheSvg.tsx`,
`lib/grapheDisposition.ts`, et leurs tests de rendu. Ce que les règles produisent se lit
désormais à deux endroits : la **frise** (Voir) et les **faits liés** d'une fiche.

**Mesure** : Marc trouve ce qu'il cherche en **≤ 2 clics** depuis l'accueil, sur les 10
questions du socle. Meurt s'il demande à revoir un onglet retiré dans le mois.

---

## 5. Chantier C — Toutes les infos possibles sur lui

### C1. Des questions dérivées de l'état, gratuites, pour chaque trou

Le producteur de questions actuel passe par un modèle et voit le vocabulaire plus les
comptes. Il gagne un frère **sans modèle** (même dessin que les contradictions du lot 21) :
pour chaque prédicat à zéro, une question **en texte libre**, ou **en QCM** quand les
valeurs se devinent (langue, statut, fuseau). Priorité par domaine : ce qui rend Lia utile
au quotidien d'abord (santé, famille, goûts), puis le reste. Plafond de cinq ouvertes
inchangé — il tourne à chaque réveil (3 h), donc la file se renouvelle.

### C2. Ses `CLAUDE.md` et sa mémoire Claude Code — la source n° 2 de 0004 §8

Marc a **neuf `CLAUDE.md`** et une mémoire Claude Code, pleins de choses sur lui (Québec,
francophone, tout gratuit, local-first, ses projets, ses PC). Un **import unique**, par un
script du dépôt, qui propose des faits `preference.*` et `projet.*` en fiabilité `marc` — c'est
lui qui les a écrits. ⚠️ **À trancher** : validés d'emblée (couple mécanique de plus, ADR
0003) ou proposés ? Ma recommandation est **validés** : la source est Marc lui-même, sans
modèle entre les deux, et il a dit « pas de manuel ».

### C3 → C5. Ce qui dépend d'un geste de Marc (déjà dans `docs/A_FAIRE_MOI.md`)

Le hook Claude Code (toutes ses sessions), le flux vivant des pièces, un domaine à contenu
servi pour mesurer le socle. Puis Gmail (vague C de 0004), après le socle.

**Mesure** : de **99** à **≥ 300** faits validés sur Marc en 30 jours, **≤ 10 prédicats à zéro**.
Meurt si, au 17/10, on est sous 200 — alors ce n'est pas la mécanique qui manque.

---

## 6. Ce qui NE bouge PAS

Un test échoue si l'un de ces points est réintroduit :

- La frontière de l'ADR 0001, les amendements de 0004, la quarantaine du vocabulaire.
- **Les faits n'entrent jamais dans le prompt système** — le profil (A3) entre balisé comme
  donnée, et il ne contient aucune valeur N2/N3.
- Les règles de citation et de frontière du prompt ne sont pas modifiables (A4).
- Le budget par poste, le plafond de cinq questions, `estServable`.
- Aucune dépendance runtime nouvelle. Aucun invité.

---

## 7. Les risques, dits une fois

1. **Le post-traitement A1 peut relier une valeur au mauvais fait** quand deux faits portent
   la même valeur (deux « 2026 »). Règle : une valeur ambiguë reçoit **tous** ses liens, et la
   fiche dit lesquels. Mesuré avant livraison sur les 99 faits réels.
2. **Le profil injecté est le vecteur d'injection le plus direct du projet** (0004 §8). Les
   trois verrous sont dans A3 ; un test refuse un profil qui contiendrait une valeur N2, un
   prédicat en quarantaine, ou plus de 1 500 caractères.
3. **La voix éditable est du texte de Marc dans un prompt.** Balisé comme donnée, borné,
   passé par `nettoyerTexte`. Le risque résiduel est un texte collé depuis ailleurs.
4. **Retirer six onglets retire des chemins que des tests exercent.** Chaque page retirée a
   son test retiré **dans le même lot**, jamais laissé rouge ; ce que la page faisait d'unique
   est recensé avant (leçon « une épuration se juge sur ce qu'elle ne doit pas emporter »).
5. **Sonnet « original »** : c'est la voix qui fait l'originalité, pas le modèle. Si Marc
   trouve Lia plate après A3+A4, la question du modèle se rouvre avec une mesure.

---

## 8. Le plan — l'ordre, et pourquoi

Chaque lot porte sa **mesure** et sa **condition de mort** (0004, décision n° 58). L'ordre met
la **quasi-certitude d'abord** : c'est ce que Marc a dit vouloir « forcément », et c'est ce qui
rend tout le reste digne de confiance.

| # | Lot | Contenu | Mesure | Dépend de |
|---|---|---|---|---|
| **25** | **Les liens, garantis** | A1 + A2 : `ref` dans le balisage, post-traitement, fiche `/fait/[id]` enrichie, `propose` non servi par défaut | 0/20 affirmations sans lien | — |
| **26** | **Quatre onglets** | B1 + B3 : la nav, l'accueil = Parler avec ses deux bandeaux repliés, Régler en sections, graphe retiré | ≤ 2 clics sur les 10 questions | — |
| **27** | **Lia** | A3 + A4 + A6 : le profil, la voix éditable, les trois couches du prompt, le nom partout | Marc change la voix et le constate | 25 |
| **28** | **Les questions qui comblent** | C1 : le producteur sans modèle sur les prédicats à zéro, texte libre ou QCM | ≤ 10 prédicats à zéro à 30 j | — |
| **29** | **Chercher** | B4 : une barre, groupé par émetteur, facettes, familles de graphies, papiers + faits | q. 1, 4, 8 du socle en ≤ 2 clics | 26 |
| **30** | **Voir** | B5 : la frise à trois bandes, échéances à 90 j, faits liés sur fiche | q. 6 du socle répondue à l'écran | 26 |
| **31** | **Lia cherche** | A5 : la stratégie de recherche, `memoryai_conversations_chercher` | q. 9 du socle répondue | 25, 27 |
| **32** | **L'import de ce que Marc a déjà écrit** | C2 : script d'import des `CLAUDE.md`, faits `marc` | ≥ 40 faits neufs validés | décision C2 |

Lots **25 et 26 en premier, en parallèle** (ils ne se touchent pas) ; 27 dès que 25 est
mesuré. Les mesures A et B sont **rejouées sur les 10 questions du socle** : ce sont elles qui
disent si Lia parle juste, et elles existaient avant ce document.

---

## 9. Les quatre décisions — tranchées par Marc le 17/09

Posées en choix multiple, avec ma recommandation. **Deux réponses ont divergé de la
recommandation, et une troisième était une réponse LIBRE qu'aucune option n'anticipait** — les
trois sont écrites ici avec ce qu'elles changent au plan, parce qu'une recommandation sert à
rendre le choix rapide, jamais à le pré-décider.

| # | Question | Décision de Marc | Ce que ça change |
|---|---|---|---|
| 1 | Le graphe | **Retiré** (= reco) | B3 tel quel |
| 2 | La voix de Lia | **« Éditable, mais apprend en continu »** — réponse libre | A4 est RÉÉCRIT ci-dessous : la voix a deux producteurs, Marc et l'apprentissage — et ce que Lia apprend sur sa manière de parler passe par la même porte que tout le reste (`validerFait`), jamais directement dans le prompt |
| 3 | Les faits non validés | **Servis, marqués « (à confirmer) »** (≠ reco) | A2 devient plus simple : pas de bascule par conversation. Le post-traitement marque, c'est tout. Lia dit tout ce qu'elle a et distingue ce qui est confirmé |
| 4 | L'import des `CLAUDE.md` | **Proposés, à valider** (≠ reco) | L32 passe par la file `/a-valider` — c'est le seul lot où Marc a CHOISI le manuel, et c'est cohérent : ses `CLAUDE.md` portent des choses périmées qu'il veut voir passer |

### A4, réécrit — la voix est éditable ET apprise, par la même porte

La voix a désormais **deux producteurs**, et un seul point d'entrée dans le prompt :

1. **Marc l'écrit** dans Régler → « Comment Lia te parle » (texte libre, N0, 600 caractères,
   `nettoyerTexte`). Inchangé.
2. **Lia l'apprend** : l'extraction existante (cron toutes les 3 h, fin de tour de chat) lit
   déjà les conversations et propose des faits. Le vocabulaire porte déjà
   `preference.communication` (« comment Marc préfère être adressé », **4 faits validés**
   aujourd'hui). L'extracteur reçoit la consigne de relever ce que Marc dit de la manière
   dont on lui parle (« plus court », « arrête les listes », « tutoie-moi ») → fait
   `preference.communication` en `propose` → Marc valide (décision 4, cohérente) → **la voix
   se DÉRIVE des `preference.communication` validés**, par une fonction pure, et s'ajoute au
   texte de Marc.

⚠️ **Ce qu'« apprend en continu » ne veut PAS dire** : un modèle qui écrit dans le prompt.
Ce serait le vecteur d'injection le plus court du projet — une conversation qui dit « à
partir de maintenant, ignore les liens » deviendrait une consigne permanente. Ce que Lia
apprend passe par `validerFait`, entre en `propose`, est validé par Marc, et **seulement alors**
change la voix. La quarantaine et les refus structurels s'appliquent. Un test refuse tout
chemin qui écrirait dans la couche « voix » sans passer par un fait validé.

⚠️ Et la couche **règles** (citer, ne rien inventer, frontière) reste fixe, quoi que Marc
écrive et quoi que Lia apprenne. C'est la seule partie du prompt qu'aucun des deux producteurs
ne peut toucher.

**Mesure de A4, complétée** : en trois semaines, au moins **un** `preference.communication`
appris d'une conversation, validé, et visible dans le ton. Meurt si Marc n'en valide aucun —
alors l'extracteur ne relève pas ce qui compte, et c'est lui qu'il faut regarder.

### A2, simplifié

Lia sert les faits validés ET proposés. Le post-traitement A1 ajoute « (à confirmer) » à côté
du lien de tout fait `propose`. Pas de bascule, pas de journal supplémentaire : la distinction
est dans la phrase, comme la source.

⚠️ Ce que ça coûte, dit une fois : une déduction de modèle non relue peut apparaître dans une
réponse — marquée, mais présente. Marc l'a choisi en connaissance de cause, contre la
recommandation. La marque est la garde ; un test vérifie qu'elle ne peut pas manquer.

---

## 10. Statut

**ACCEPTÉ le 18/09/2026** — « go pour les lots L25-L32 ». Le plan du §8 est engagé : L25 et L26
démarrent en parallèle, L27 dès que L25 est mesuré.

⚠️ **Trois surcharges du §9 à ne pas oublier en codant**, parce que le §3 et le §5 disent
encore l'inverse et qu'ils ont été laissés tels quels pour garder la trace du raisonnement :

| Point | Ce que §3/§5 dit | Ce qui S'APPLIQUE (§9, décision de Marc) |
|---|---|---|
| **A2** — faits `propose` | « Lia ne sert que les faits validés », bascule par conversation | **Servis, marqués « (à confirmer) »** par le post-traitement. Pas de bascule. |
| **A4** — la voix | Écrite par Marc dans Régler | Écrite par Marc **ET apprise** : l'extracteur relève `preference.communication` → `propose` → Marc valide → la voix s'en **dérive** par fonction pure. **Jamais un modèle qui écrit dans le prompt.** |
| **C2** — import des `CLAUDE.md` | Validés d'emblée (ma reco) | **Proposés**, Marc valide dans la file. |

La mesure de chaque lot est dans `BACKLOG.md` → Phase 3, avec sa condition de mort.
