# 14 — Navigation entre apps : la liste du parc

À quoi sert `lib/appsDuParc.ts` : donner à chaque app l'adresse des autres sans repasser par le hub. Il expose `APPS_DU_PARC` (7 destinations figées : hub, FinanceAI, DriveAI, BatchChef, CarAI, JobAI, MemoryAI) et `autresApps(courant)`, qui rend toutes les destinations SAUF l'app courante, dans l'ordre de la liste. Rien n'est affiché par ce fichier : le composant d'onglet « Apps » et les six apps s'en servent.

## Règles

- **La vérité est `Hubperso/lib/sources.ts`** (`APPS`, champ `accueil`). `lib/appsDuParc.ts` s'en copie tel quel dans chaque app ; il ne lit jamais Hubperso à l'exécution (aucun `fetch`, aucun secret, aucune dépendance).
- **Ajouter, renommer ou retirer une app du parc = mettre à jour ce fichier dans chaque dépôt**, dans la même vague que `Hubperso/lib/sources.ts`. Le test `tests/appsDuParc.test.ts` fige la liste exacte : il rougit tant que la copie et la liste attendue ne sont pas changées ensemble.
- **Le hub est à `https://www.hubperso.com`** : `https://hubperso.com` répond 308 vers `www` (relevé du 29/10/2026). On met l'adresse finale, pas celle qui redirige.
- **Un id inconnu lève une erreur** (`autresApps("faute")`) : une liste vide en silence cacherait une faute de frappe dans l'id d'un fork.
- Chaque adresse est une origine https sans chemin, requête, fragment ni identifiant, sur `hubperso.com` ou un sous-domaine (verrou du test).

## À un fork

Copier `lib/appsDuParc.ts` et `tests/appsDuParc.test.ts` tels quels. L'id de l'app courante se change en une ligne dans `app/layout.tsx` ; il doit être l'un des `AppId`.

# L'onglet « Apps » (app-template#213)

`components/NavApps.tsx` : une pastille « Apps » repliée en haut à droite ; dépliée, un bouton par AUTRE app du parc (liste de `autresApps`), hub compris. Un clic ouvre l'app dans le même onglet. Composant serveur : un `<details>`/`<summary>` natif, zéro JavaScript, aucun état « en ligne » inventé, aucun `fetch`. Style : classes `.nav-apps*` de `app/globals.css`, jetons existants seulement, cibles ≥ 44 px, texte 16 px.

## Qui le voit

MemoryAI est déjà propriétaire seul (jamais d'invité). `app/layout.tsx` monte `<NavApps courant="memoryai" />` sous la MÊME condition `lia` que `<LiaMaison />` (`liaAutorisee()`, échec fermé) : pas de second calcul de session, jamais sur `/login`. Sans session, le texte de l'onglet n'est pas dans la page. `tests/navApps.test.tsx` lit le layout pour le prouver.

## Où il se place

Coin haut droit, `position: fixed`, `z-index: 20` (sous LIA). Il ne déplace aucun élément existant (barre `navSections`, panneaux, LIA maison).
