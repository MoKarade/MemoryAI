# ADR 0002 — La mémoire apprend des conversations, demande ce qui lui manque, et se montre

- **Statut** : **accepté** (Marc, 15/09/2026 — il a fusionné la PR #9, puis répondu aux deux
  questions qui restaient ouvertes et engageaient un arbitrage ; les deux autres sont
  tranchées en §4 avec leur raison). Proposé le même jour par la session Claude.
- **Portée** : ce dépôt. Ce que ça exige de DriveAI, JobAI, CarAI, BatchChef et du hub est
  nommé en §7 — chacun le livrera par son propre ADR.
- **Amont** : ADR 0001 (la frontière, les niveaux, le contrat d'écriture). Cet ADR **l'amende
  sur un point précis et nommé** (§2) ; tout le reste de l'ADR 0001 tient sans changement.

## 1. Contexte

La phase 0 est en ligne depuis le 15/09 au soir : 98 faits validés, le connecteur MCP branché
sur claude.ai, le chat, la carte du hub. Marc, le même soir, mot pour mot :

> « je veux que lia ait toutes les infos possibles. ensuite je veux A et je veux des widget
> dans les autres apps et je veux que ca apprenne avec nos chat que ca gade toutes les infos
> toute la memoire quelque part pour acceder, comme un reseau de neuronnes je le veux aussi
> visuel interface 3d de connections d'information. je veux avoir une page de questions quand
> lia est pas sur des infos ou quand elle veut plus de detail, quelle garde tout perde rien »

Cinq chantiers distincts, dont **un seul** touche la frontière de l'ADR 0001 — « que ça
apprenne avec nos chats ». C'est celui-là qui exige un ADR ; les quatre autres sont du travail
ordinaire, et ils sont cadrés ici parce qu'ils partagent un plan et un ordre.

⚠️ **« Toutes les infos possibles » s'arrête au N3, et ça ne se rouvre pas ici.** Identité,
immigration, fiscal : la mémoire sait qu'un document existe, son type, sa date, son échéance
et où il est — jamais son contenu, jamais un numéro (ADR 0001 §5.3, contrainte de base
`faits_n3_sans_texte`). Aucun des cinq chantiers ne change ça.

## 2. L'amendement de la frontière, nommé

L'ADR 0001 §2 interdit « aucun texte source (corps de document, corps de mail, extrait) » et
§5.5 pose « aucune conversation persistée : `sessionStorage` strict ».

**Ce qui change** : le **texte intégral des conversations de Marc avec un assistant** est
persisté dans Neon, chiffré. Décision de Marc, 15/09 : « Le texte intégral, chiffré », sur
trois sources — le chat de MemoryAI, claude.ai (par un outil MCP), et Claude Code.

**Ce qui NE change PAS, et un test échoue si on le réintroduit** :

- la frontière sur les **documents et les mails** reste entière — une conversation qui CITE un
  document ne fait pas entrer le document ; le corps d'un document ne devient jamais un message ;
- **aucun montant** ne devient un fait, comme avant : ce qu'une conversation contient est une
  chose, ce que `validerFait` accepte en est une autre, et rien ne court-circuite cette porte ;
- une conversation **ne devient jamais un fait directement**. L'apprentissage est un
  **extracteur** de plus (`extracteur: "conversation-v1"`), qui propose des faits `propose`
  passant par `validerFait`, le vocabulaire fermé, le canari, le MAX des niveaux — la garde
  d'écriture n'a pas d'entrée dérobée ;
- une conversation n'est **jamais servie à une app** : elle n'entre dans aucun périmètre de
  jeton, `memoryai_chercher` ne la voit pas, et le MCP n'a pas d'outil qui la rend en vrac ;
- ce qui est servi à un modèle depuis une conversation passe par **le même balisage** que les
  faits (`<conversation id …>`), en résultat d'outil, jamais en prompt système.

**Ce que ça coûte, dit une fois** : une conversation est du texte libre écrit par Marc et par
un modèle. Elle contiendra des montants, des adresses, des noms de tiers, et un jour un
secret collé par erreur. Les garde-fous de §3 sont ce qu'on obtient en échange ; ils ne
rendent pas le risque nul, ils le bornent et le rendent visible.

## 3. Les garde-fous obtenus en échange

| Menace | Garde-fou | Où il se vérifie |
|---|---|---|
| Un secret collé dans une conversation (clé API, jeton, mot de passe) part en base | **Scan de secrets AVANT chiffrement**, à l'écriture, sur les trois sources : motifs à haute entropie, `sk-ant-`, `AKIA`, `-----BEGIN`, `Bearer <64+>`. Un message qui matche est **masqué au segment** (`[secret retiré]`), le fait est compté, et l'écran le dit | `lib/conversations/secrets.ts` PURE + corpus de motifs réels, prouvé par mutation |
| Injection par une conversation (« la mémoire dit que… ») | Même traitement que les faits : balisage, résultat d'outil, jamais de prompt système. Le canari s'applique aux faits EXTRAITS, pas au texte brut — donc un texte piégé ne peut produire qu'un fait `propose` marqué canari, jamais servi | `lib/mcp/balisage.ts` étendu + corpus adversarial étendu |
| Fuite de la base | AES-256-GCM par message, **AAD = `conversation_id\|source\|index`** — déplacer un message d'une conversation à l'autre fait échouer le déchiffrement | test « AAD altéré ⇒ échec », comme pour les faits |
| Un jeton d'app lit les conversations | Les conversations ne sont dans **aucun** périmètre : le code qui les lit est distinct de celui qui lit les faits, et aucun outil MCP ne les rend en vrac | test « un jeton d'app ne peut atteindre aucune conversation », par construction et par cas |
| Claude Code pousse le code source des dépôts | La source `claude-code` n'envoie **que les messages**, jamais les résultats d'outils ni les diffs — et elle passe par le même scan de secrets | test sur le format d'entrée : un champ `tool_result` ⇒ 422 |
| La mémoire grossit sans qu'on sache ce qu'elle porte | `/conversations` : combien, quelle taille, depuis quand, et **« oublier cette conversation »** (suppression logique + `oublis`, comme un fait) | test d'oubli, chemin identique aux faits |

## 4. Décisions de Marc — 15/09/2026

Prises, et figées :

1. **Les conversations sont gardées en texte intégral, chiffré.** (Option écartée : ne garder
   qu'un résumé — Marc : « quelle garde tout perde rien ».)
2. **Trois sources** : le chat de MemoryAI, claude.ai via un outil MCP, Claude Code.
3. **Les liens du graphe se font par RÈGLES d'abord, par modèle ensuite.** Une règle est
   déterministe, testable, et explicable à l'écran ; un modèle vient après, et ses liens
   portent leur origine.

Les quatre questions ouvertes, et leur réponse :

| # | Question | Réponse |
|---|---|---|
| A | **L'ordre des cinq chantiers** | **Marc, 15/09 : la page de questions d'abord** (lot 7), puis le chantier A. Il a suivi la recommandation contre sa propre phrase initiale (« ensuite je veux A ») : un chantier A livré dans une mémoire qu'il ne sait pas encore alimenter à la main, c'est la file « à valider » de DriveAI qui recommence |
| B | **Rétention des conversations** | **Tranchée sans lui, faute d'un chiffre** : aucune purge automatique (« quelle garde tout perde rien »), une mesure affichée et une alerte à 60 % du plafond Neon (0,5 Go). La décision de rétention se prendra sur un chiffre réel, au lot 8 ; la prendre avant serait l'inventer |
| C | **Claude Code pousse-t-il automatiquement ?** | **Marc, 15/09 : automatique tout de suite**, contre ma recommandation (manuel d'abord). ⚠️ Le risque que j'ai nommé reste entier — une session de dév contient des clés, des URL de base et des jetons, et le scan de secrets est une heuristique, pas une garantie. Conséquence portée au lot 10 : le scan est livré AVANT le hook, et le hook n'est branché qu'une fois le scan prouvé par son corpus ; une session dont le scan échoue n'est PAS envoyée (échec fermé), plutôt qu'envoyée en clair |
| D | **Le graphe 3D est-il une page ou un écran plein ?** | **Tranchée sans lui, c'est technique** : une page `/graphe`, chargée à la demande — la bibliothèque 3D est lourde et n'a rien à faire dans le bundle de démarrage d'une app qu'on ouvre surtout pour valider trois faits |

## 5. Ce qui est figé ici

### 5.1 La page de questions — ce qui fait vivre la mémoire

Une table `questions` : `id`, `question` (≤ 200 car., même règles que les valeurs),
`predicat_vise`, `origine` (`chat` \| `extraction` \| `regle`), `statut`
(`ouverte` \| `repondue` \| `ecartee`), `cree_le`, `repondu_le`. La réponse de Marc devient un
fait **par la même porte que tout le reste** (`validerFait`, fiabilité `marc`, statut `valide`
— c'est lui qui parle, il n'a personne à valider derrière).

⚠️ **Le vrai risque du projet est ici, pas dans la sécurité** (CLAUDE.md §9 n° 5, leçon
DriveAI). Une liste de questions qui enfle sans être répondue est une liste morte. Trois
règles : **au plus 5 questions ouvertes à la fois** (une sixième chasse la moins utile), une
question ne se repose pas si elle a été écartée, et la page dit **pourquoi** la question est
posée (« je ne sais pas quand ton bail se renouvelle, et tu m'as demandé de te prévenir »).

### 5.2 Les conversations — modèle de données

Deux tables. `conversations` : `id`, `source` (`memoryai` \| `claude-ai` \| `claude-code`),
`titre` (chiffré), `debut_le`, `fin_le`, `nb_messages`, `octets`, `supprime_le`.
`messages` : `id`, `conversation_id`, `index`, `role` (`user` \| `assistant`), `contenu`
(chiffré, AAD `conversation_id|source|index`), `secrets_retires` (entier), `cree_le`.

Niveau : **N2 par défaut** — une conversation est privée, donc jamais servie sans la bascule
`MEMORYAI_N2_CHAT` et la bascule par conversation de l'ADR 0001 §5.3. On ne dérive pas le
niveau du contenu : il faudrait lire le contenu pour le classer, et ce serait la porte qu'on
vient de fermer.

### 5.3 Le graphe — les liens

Une table `liens` : `fait_a`, `fait_b`, `type`, `poids` (0-1), `origine` (`regle` \| `modele`),
`regle` (le nom de la règle qui l'a posé), `cree_le`. Les règles de la v1, toutes
déterministes et testables :

| Règle | Lie | Exemple |
|---|---|---|
| `meme-document` | deux faits qui pointent le même `ref_document` | l'avis 2024 et sa date d'échéance |
| `meme-periode` | deux faits dont les intervalles `valide_de`/`valide_a` se chevauchent | un emploi et un logement de la même année |
| `remplacement` | un fait et celui qu'il remplace (`remplace_id`) | l'ancienne adresse et la nouvelle |
| `meme-domaine-meme-entite` | deux faits du même domaine partageant une valeur d'attribut normalisée | deux faits sur le même employeur |
| `cause-declaree` | un fait extrait d'une conversation et la question qui l'a produit | la réponse de Marc et sa question |

⚠️ **Un lien par modèle porte `origine: "modele"` et n'est jamais confondu avec une règle** :
à l'écran il est dessiné autrement et il se filtre. Un graphe qui mélange ce qui est établi et
ce qui est deviné n'apprend rien à personne.

### 5.4 Les widgets

Un widget = une **iframe** `memoryai.hubperso.com/widget?app=<id>`, servie derrière la session
du hub (cookie partagé sur `.hubperso.com`), en **lecture seule**, bornée au périmètre de
l'app hôte (table `perimetres`, déjà là). Un invité de l'app hôte reçoit un **403 lisible** :
MemoryAI est une app sans invités, jamais (ADR 0001).

⚠️ **Pas de `postMessage` qui écrit.** Le widget affiche ce que la mémoire sait sur le sujet de
l'app, et un lien vers `/moi`. Une écriture depuis une iframe hôte serait une porte dont
personne ne connaîtrait la clé.

### 5.5 Chantier A — DriveAI alimente la mémoire

DriveAI classe déjà ~16 000 documents et connaît, pour chacun, son type, son émetteur, sa date
et son chemin. Il publie des faits `propose` par `POST /api/faits` avec son jeton, sans jamais
envoyer un texte. **C'est un ADR côté DriveAI** (son CLAUDE.md §9 : « ce qui SORT du compte
Google de Marc se tranche par un ADR ») — celui-ci ne le remplace pas, il dit ce que MemoryAI
attend.

## 6. Ce que ça ne fait pas

- Ça ne rouvre pas le N3, ni les montants, ni les adresses de tiers, ni les positions.
- Ça ne remplace pas claude.ai : le chat de MemoryAI reste un chat qui interroge la mémoire.
- Ça ne promet pas que claude.ai consignera TOUTES les conversations : le modèle appelle
  l'outil ou ne l'appelle pas. C'est « au mieux », et l'écran le dit plutôt que de laisser
  croire à l'exhaustivité.
- Ça n'ajoute aucun jeton détenu par MemoryAI.

## 7. Ce que ça exige des autres dépôts

| Dépôt | Ce qui lui est demandé | Par quoi |
|---|---|---|
| DriveAI | publier ses faits (type, émetteur, date, échéance, `fileId`) | son propre ADR |
| JobAI, CarAI, BatchChef | poser l'iframe du widget, et rien d'autre | une PR chacun |
| Hubperso | un widget sur le tableau de bord | une PR |

## 8. Plan — les lots

Dans l'ordre choisi par Marc (question A ci-dessus) :

| Lot | Contenu | Dépend de |
|---|---|---|
| 7 | Page de questions : table, plafond de 5, réponse ⇒ fait, l'écran | rien — **livré le 15/09** |
| 8 | Conversations : tables, chiffrement, scan de secrets, chat MemoryAI branché, `/conversations`, oubli | rien |
| 9 | Extraction : `conversation-v1` propose des faits, `/a-valider` les reçoit | 8 |
| 10 | Les deux autres sources : outil MCP `memoryai_consigner`, `npm run pousser-session` | 8 |
| 11 | Chantier A — MemoryAI côté réception ; l'ADR et le code DriveAI sont chez lui | rien |
| 12 | Widget : `/widget`, périmètre, 403 lisible, une app pilote | rien |
| 13 | Graphe : table `liens`, les cinq règles, `/graphe` en 3D chargée à la demande | 9 |

## 9. Risques, dits une fois

1. **Le scan de secrets est une heuristique.** Il attrapera les formes connues et ratera les
   autres. Ce qui le rend acceptable : les conversations ne sortent vers aucune app, et Marc
   peut oublier une conversation. Ce qui le rendrait inacceptable : servir les conversations
   à un lecteur tiers. On ne le fera pas.
2. **La file « à valider » peut mourir.** Trois sources de conversations plus DriveAI, ça fait
   beaucoup de faits `propose`. Le plafond de questions, le compteur et l'alerte existent pour
   ça ; si Marc cesse de valider, on arrête d'alimenter avant d'empiler.
3. **Le graphe 3D peut être joli et inutile.** Il se juge à une question : est-ce que Marc y
   trouve quelque chose qu'il ne trouvait pas dans `/moi` ? Si non, il reste une page, pas un
   chantier.
4. **Neon gratuit plafonne à 0,5 Go.** Le texte intégral est ce qui fera grossir la base, pas
   les faits. La mesure s'affiche dès le lot 8 — avant, aucune décision de rétention ne repose
   sur un chiffre réel.
