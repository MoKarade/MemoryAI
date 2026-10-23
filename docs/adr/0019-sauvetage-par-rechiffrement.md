# ADR 0019 — Sauver la mémoire par re-chiffrement, l'ancien déploiement servant d'oracle

- **Statut** : **PROPOSÉ** le 23/10/2026. Marc a choisi la voie (« option 2 », fil Secrets, 14:54Z) ;
  chaque étape irréversible attend encore son oui sur une carte (§ 6).
- **Déclencheur** : incident du 23/10. La synchro Infisical → Vercel a vidé ou supprimé les variables
  de `memory-ai`, dont `MEMORYAI_CHIFFREMENT` et `MEMORYAI_JOURNAL_CLE`. Aucune autre copie connue.
  Seul le déploiement de 12:37Z (`dpl_6rALo2S7biASr7gytWCoLPGcMA4C`, commit 8a1b681) les porte encore
  dans son environnement figé ; la production a été remise dessus, et l'auto-promotion est coupée.
- **Portée** : `lib/chiffrement.ts` (une seconde version de scellé), un module de sauvetage
  (`lib/sauvetage/`), une action de Régler, une table d'archive, et la fermeture des écritures des
  apps tant que le sauvetage n'est pas clos.

## 1. Ce qu'on ne peut pas faire

- **Ressortir les clés.** Le code de 8a1b681 n'a aucune route qui rende une clé, et un déploiement
  Vercel est immuable : on n'y ajoute pas de code. Tout code neuf part dans un déploiement neuf, qui
  n'a pas les clés.
- **Passer par le MCP.** Il ne sert jamais le N3, plafonne à 100 résultats par appel, et ses jetons
  sont signés par `MCP_SIGNING_KEY`, effacée elle aussi.
- **Re-signer le journal d'accès.** Sa valeur est d'être une chaîne qu'on ne réécrit pas (ADR 0014).

## 2. La voie : l'ancien déploiement lit, le nouveau écrit

Le déploiement de 12:37Z déchiffre encore tout, une entité par page, pour le propriétaire :

- `/fait/[id]` : le fait complet, tous niveaux. La valeur exacte est dans le champ « Corriger »
  (`defaultValue`), donc sans mise en forme.
- `/pieces/[id]` : résumé, champs, facettes et chemins d'un papier, N3 compris si l'environnement
  figé de ce déploiement l'autorise.

**Le passage.** Le nouveau déploiement, avec une **nouvelle** clé, devient la production : Marc s'y
connecte normalement. L'ancien reste joignable à son adresse propre (`memory-85luh46gm-…vercel.app`).
Cette adresse est fermée par la protection de Vercel (302, vérifié le 23/10) ; le sauvetage y passe
avec le secret de contournement pour l'automatisation, que Vercel fournit au déploiement
(`VERCEL_AUTOMATION_BYPASS_SECRET`, en-tête `x-vercel-protection-bypass`).

**Le sauvetage**, lancé par Marc depuis Régler, relançable, ligne par ligne :

1. Il prend les lignes encore scellées en `v1`, par leur `id` (en clair en base).
2. Il demande leur page à l'ancien déploiement, avec une session de Marc fabriquée par `AUTH_SECRET`
   (la même valeur que le hub) pour `AUTHORIZED_EMAIL`.
3. Il en extrait le clair, et **vérifie sa taille** : AES-GCM ne change pas la longueur, donc le clair
   doit faire exactement autant d'octets que le chiffré `v1`. Sinon, la ligne reste en `v1`, en
   échec, et le bilan le dit.
4. Dans une transaction : il copie le scellé `v1` dans une archive (`chiffre_v1_archive`), scelle le
   clair en `v2`, recalcule les empreintes, et écrit.

Si Marc retrouve un jour l'ancienne clé, tout redevient lisible depuis l'archive. Une ligne déjà en
`v2` n'est plus touchée ; une ligne en échec se retente à la relance suivante.

**Pendant le sauvetage**, les lignes encore en `v1` sont illisibles en production : elles se disent
« illisibles », comme aujourd'hui pour un chiffré altéré. Les écritures des apps (`/api/faits`,
`/api/pieces`, `/api/conversations`) répondent 503 tant qu'une ligne `v1` sauvable reste : sinon un
écrivain recréerait en `v2` un fait encore en `v1`, et la ligne sauvée heurterait son double.

Le clair ne fait que passer en mémoire. Il ne s'écrit nulle part, ne se journalise pas, et ne sort
pas du serveur. Le trajet entre les deux déploiements reste en HTTPS.

## 3. Ce que chaque donnée devient

| Donnée | Voie | Issue attendue |
|---|---|---|
| Faits (valeur, attributs, empreinte) | `/fait/[id]` | sauvés |
| Noms des proches (`sujets.nom_chiffre`) | page du fait qui les porte | sauvés si un fait les montre |
| Papiers lus (résumé, champs) | `/pieces/[id]` | sauvés ; N3 seulement si l'ancien environnement l'ouvrait |
| Papiers d'inventaire (facettes, chemins) | `/pieces/[id]`, sinon relecture de Drive par DriveAI | sauvés ou relus |
| Conversations d'ici (LIA) | pas de page complète | **perdues**, sauf voie trouvée à l'implémentation |
| Conversations importées (Claude) | ré-import depuis l'export d'origine | refaites si l'export existe |
| Avis de la pile (remarques), banc | pas de page | remarques **perdues** ; banc régénéré |
| Oublis | empreintes keyées sans préimage | **la garde se perd** (§ 4) |
| Journal d'accès | aucune | gardé tel quel, **invérifiable** ; une chaîne neuve repart |

## 4. Les oublis : le point le plus fragile

Un oubli n'est gardé que comme empreinte keyée de ce qui a été oublié. Sous une nouvelle clé, aucune
de ces empreintes ne reconnaîtra plus rien. Un papier ou un fait oublié pourrait donc revenir si une
source le repousse.

Parade retenue :
- les lignes d'oubli sont gardées ;
- le sauvetage compte combien d'oublis deviennent aveugles, et Marc le voit dans le bilan ;
- tant qu'un oubli `v1` existe, une relecture **complète** de Drive par DriveAI reste interdite.

## 5. Ce qui ne change pas

- L'échec fermé : sans nouvelle clé, rien ne s'écrit (`deriverCle`).
- `v1` reste lisible par le code si l'ancienne clé revient un jour : `dechiffrer` accepte `v1` et `v2`,
  chacune avec sa clé.
- Aucune valeur, ancienne ou nouvelle, n'apparaît dans un journal, une erreur ou l'adresse.
- La production ne passe au nouveau déploiement qu'avec le oui de Marc (étape 3), et l'ancien reste
  joignable pour relire.

## 6. Les étapes, et celles qui attendent le oui de Marc

1. Ce document, puis le code et ses tests, dans une PR **sans** fusion (`hold`).
2. **Oui de Marc** : générer la nouvelle clé et la nouvelle clé de journal, les poser dans Vercel et
   dans Infisical (projet à part, aucune synchro). Remettre `AUTH_SECRET` (valeur du hub),
   `AUTHORIZED_EMAIL` et les autres variables effacées. Générer le secret de contournement de la
   protection (Vercel → Deployment Protection → Protection Bypass for Automation).
3. **Oui de Marc** : fusionner, puis promouvoir le nouveau déploiement. Les lignes `v1` deviennent
   illisibles en production jusqu'à la fin du sauvetage.
4. **Oui de Marc** : lancer le sauvetage (Régler). Il écrit en base : archive d'abord, puis `v2`.
5. Bilan : sauvées, en échec, perdues, oublis aveugles. Relancer jusqu'à ce que rien de sauvable ne
   reste.
6. **Oui de Marc** : clore. Ce qui reste en `v1` est déclaré perdu (gardé dans l'archive), et les
   écritures des apps rouvrent. Le déploiement de 12:37Z n'est **jamais** supprimé tant que l'archive
   `v1` existe : on peut toujours le relire.

Entre les étapes 1 et 3, la production reste l'ancien déploiement : ce que les apps y écrivent est
encore en `v1`, et le sauvetage le reprendra comme le reste.

## 7. Ce qu'on retient

- Une clé qui chiffre des données n'existe jamais en un seul endroit (ADR 0018, à reprendre après ce
  sauvetage, avec la nouvelle clé).
- Une synchro de secrets ne touche jamais une clé de chiffrement.
- `lib/chiffrement.ts` porte désormais une version de clé : la prochaine rotation sera un geste
  prévu, pas un sauvetage.
