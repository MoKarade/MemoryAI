# ADR 0007 — Le contenu des papiers d'identité peut sortir, sous deux verrous

- **Statut** : ACCEPTÉ (décision de Marc, 2026-09-19)
- **Amende** : l'ADR 0001 §5 (les niveaux) et l'ADR 0004 §3 (ce qui est servi à un modèle).
  Ne touche ni au vocabulaire, ni au contrat d'écriture, ni à la quarantaine.

## 1. Le défaut, observé avant d'être raconté

Marc, le 19/09, dans le chat de MemoryAI : « J'ai quel age ». La réponse :

> Je ne trouve pas de date de naissance ni d'âge dans ta mémoire — la recherche ne remonte
> que ton passeport, sans info d'âge […]

La Mémoire **avait** le passeport. Elle ne pouvait pas en dire l'âge de son titulaire, et sa
réponse laissait croire qu'elle n'en savait rien. Ce n'était ni une lacune de données ni un
réglage oublié : `niveauMaxServi` rendait `1 | 2`, et `sortDeLaPiece` sert un papier de
niveau 3 en **sommaire** — domaine, année, dates. Aucune bascule n'existait, donc aucun
chemin ne menait au contenu.

⚠️ **Le pire n'était pas le silence, c'était sa FORME.** « Je ne trouve pas » et « je trouve
et je ne sers pas » appellent deux gestes opposés — saisir la donnée, ou ouvrir la bascule.
La première rendait la seconde invisible.

## 2. La décision

**Le plafond de service peut atteindre 3**, c'est-à-dire le contenu des papiers d'identité et
d'immigration : type, émetteur, résumé, champs structurés et champs libres — **numéros
compris**.

Marc l'a tranché trois fois, dans le même sens, la dernière avec les conséquences écrites
devant lui : « oui même toutes les infos confidentielles traités » (16/09), « Oui, qu'il me
réponde » à propos de son NAS (16/09), et le 19/09, en réponse à un choix où l'option la plus
étroite était recommandée : **« Pour tout les docs niveau 3 max tout tout tout »**.

⚠️ **Sa réponse est allée PLUS LOIN que les options posées** — elles portaient sur les papiers
d'identité, il a répondu « tous les documents ». C'est la formulation retenue : le plafond
n'est pas une liste de domaines, c'est un niveau.

## 3. Ce qui l'encadre, et pourquoi chaque verrou existe

**Deux verrous, et il faut les deux** (`niveauMaxServi`) :

1. `MEMORYAI_N3_CHAT=1` — une variable d'environnement, donc un geste de Marc hors du produit.
2. `inclure_n3` — une demande **par appel**, posée par la bascule de la conversation.

La variable seule ferait sortir un passeport à **chaque** question, y compris depuis claude.ai
par le serveur MCP — qui s'authentifie par un JETON, pas par la session de Marc. La demande
seule serait à la main de l'appelant, donc d'un modèle. C'est exactement l'arbitrage déjà pris
pour le niveau 2 (ADR 0001) ; il n'y avait aucune raison de l'affaiblir pour ce qui est plus
sensible.

⚠️ **La bascule de la conversation ÉCRASE ce que le modèle demande** (`lib/chat/agent.ts`) :
`inclure_n3` venant du modèle est remplacé par celui de Marc. Un modèle ne s'ouvre pas les
papiers d'identité tout seul.

⚠️ **Le plafond est MONOTONE** : demander N3 sert aussi N2, même sans `MEMORYAI_N2_CHAT`.
L'écrire autrement ferait sortir MOINS pour une demande PLUS large — un défaut qui ne se
remarque sur aucun écran. Un test le garde, et la mutation qui le casse fait rougir trois cas.

**Le journal ne change pas, et c'est voulu** : `journaliserAcces` écrit déjà `niveauMaxServi`
à chaque appel d'outil. Une lecture à 3 est donc tracée par le mécanisme existant — ce que
Marc avait demandé le 16/09 (« Seulement les lectures SENSIBLES ») était déjà en place.

## 4. Ce que cette décision NE fait pas

- **Elle n'ouvre rien par défaut.** Les deux verrous sont fermés à la livraison :
  `MEMORYAI_N3_CHAT` n'est pas posée, la case n'est pas cochée.
- **Elle ne change rien aux FAITS.** Un fait de niveau 3 n'a jamais de contenu — `validerFait`
  le refuse (`n3_texte`) et la base aussi (`faits_n3_sans_texte`). Ce plafond ne leur ajoute
  rien : ils sortaient déjà. Ce qu'il ouvre, ce sont les colonnes chiffrées d'une **pièce**.
- **Elle ne touche pas au chiffrement.** `champs_structures` et `champs_libres` restent
  chiffrés au repos dans les deux régimes, l'AAD reste `id|niveau`. Ce qui change est la
  LECTURE, pas le stockage.
- **Elle ne remplace pas la re-authentification** que Marc avait évoquée le 16/09. Elle
  n'existe nulle part dans ce dépôt — mesuré le 19/09 — et il a choisi d'ouvrir sans elle,
  en connaissance de cause. C'est écrit ici plutôt que sous-entendu.

## 5. Ce que ça coûte, dit une fois

Une session ouverte sur le téléphone de Marc, case cochée, suffit à lire le contenu de ses
papiers d'identité. C'est le prix de sa décision, et il l'a prise en voyant l'alternative.

Le contrepoids réel n'est pas un garde de plus, c'est que **la case est par conversation** :
elle retombe à chaque fois. Rien ne la mémorise, et rien ne doit la mémoriser.

## 6. Ce qui reste ouvert

⚠️ **Le passeport déjà lu ne se ré-extrait pas.** L'ADR 0006 §2 n'autorise le remplacement
d'une pièce que dans UN sens : un extracteur de modèle remplace `moteur-inventaire-v1`, et
rien d'autre ne remplace jamais. Donc si la date de naissance n'est pas dans les champs de
l'extraction du 17/09, améliorer le prompt côté DriveAI (fait le 19/09) ne la fera pas
apparaître : ça ne vaut que pour les papiers **à venir**.

La bascule dira laquelle des deux situations est la vraie — et c'est la seule façon de le
savoir, puisque le contenu était justement ce qu'on ne pouvait pas lire. Si la date manque,
le geste suivant est un amendement de l'ADR 0006, pas un contournement.
