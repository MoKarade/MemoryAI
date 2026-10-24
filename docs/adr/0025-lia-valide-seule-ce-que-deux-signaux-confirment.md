# ADR 0025 — LIA valide seule un fait que deux signaux confirment, Marc ne voit que les doutes

- **Statut** : **proposé** (24/10/2026, fil MemoryAI). Il applique le choix de Marc sur la carte du
  24/10 (option « double signal + doutes », close sur l'option recommandée après son « Fais tout »
  de 19:21Z, fil Assistant) et sa demande de 18:42Z : « je préférerais une meilleure analyse de lia
  pour pas avoir à tout valider ». Tâche : MemoryAI#184.
- **Codé (24/10/2026), en trois PR sous la limite de 400 lignes** : 1. cet ADR et la porte PURE,
  `lib/validationLia.ts` (les deux signaux, la décision, la demande au modèle) ; 2. la passe
  `lib/relectureLia.ts` (en fin de `passeApprentissage`) et la trace `validations_lia` (migration 0030) ;
  3. les doutes en tête de la pile (`composerPile`, `faitsEnTete`) et « Validé par LIA » sur la fiche du
  fait et dans l'onglet Apprentissage. Modèle de relecture : Haiku 4.5 ; lot de 400 faits, 8 par appel,
  60 s au plus par passe. La relecture ne voit qu'un EXTRAIT : la zone de la source autour de chaque
  valeur retrouvée ; une valeur absente ne coûte aucun appel.
- **Amont** : ADR 0003 (seul le MÉCANIQUE s'auto-valide), qu'il **amende sur ce point seulement** ;
  ADR 0001 (frontière, oublis, canaris), 0012 (la pile vrai / faux).

## Contexte

Environ 3 000 faits `propose` attendent Marc (relevé du fil Assistant, 24/10) [À vérifier : le compte
exact se lit dans `GET /api/etat` au moment du code]. L'ADR 0003 n'auto-valide que ce qu'aucun modèle
n'a touché ; tout le reste attend un œil que Marc refuse de donner fait par fait. Une file qui ne
descend jamais est le « vrai risque du projet » que l'ADR 0001 nommait.

Le danger est l'inverse : un modèle qui valide ce qu'un autre modèle a extrait, c'est un modèle qui
se croit sur parole. Un seul verdict de modèle ne suffit donc jamais.

## Décision

1. **Deux signaux, les deux requis.**
   - **Le code** : la valeur du fait se retrouve TELLE QUELLE dans le texte de sa source (après
     normalisation : casse, espaces, accents composés ; une date se reconnaît sous ses formes
     usuelles `AAAA-MM-JJ`, `JJ/MM/AAAA`, « 12 mars 2026 »). Fonction pure, testée.
   - **Le modèle** : LIA relit le fait face à l'extrait de sa source (balisé comme donnée) et rend
     un verdict fermé, `confirme`, `doute` ou `infirme`, avec une raison de 200 caractères au plus,
     validé par Zod.
   Les deux, et seulement les deux, font passer le fait à `valide`.
2. **La source est celle que MemoryAI détient déjà** : le papier (`pieces`, par le `sourceRef` de
   la provenance) ou la conversation de Marc. Aucun appel à Google, aucun jeton neuf. Sans source
   lisible ici, le fait reste à Marc.
3. **Jamais seul** : niveau 2 ou 3, canari (`estCanari`), prédicat hors vocabulaire, fait en
   contradiction ouverte. Ceux-là restent `propose`, quoi que disent les signaux.
4. **La trace** : chaque validation par LIA écrit une ligne `validations_lia` (migration additive) :
   le fait, le verdict, la raison, l'empreinte keyée de l'extrait lu et de la valeur, l'heure. Un
   fait validé ainsi se dit « validé par LIA » partout où son statut s'affiche, et Marc peut le
   rejeter comme tout autre.
5. **Les doutes vont à Marc, 5 par jour au plus** : un `doute` ou `infirme`, ou un seul des deux
   signaux, laisse le fait `propose` et le met en tête de la pile vrai / faux, cinq par jour de Québec.
6. **Le budget** : le poste `apprentissage`, dans le plafond IA du jour (ADR 0005) ; une passe lit
   au plus un lot borné et dit pourquoi elle s'arrête (`lib/apprentissage.ts`).
7. **Gel et oubli** : `MEMORYAI_GEL=1` arrête la passe ; un fait oublié n'est jamais relu.

## Ce qui reste ouvert

- [À vérifier] la taille du lot et le modèle de relecture, sur le coût réel d'une première passe.
- [À vérifier] la part des faits `propose` qui ont une source lisible ici ; sans elle, la file ne
  descendra pas sous 50 et il faudra le dire à Marc, chiffres à l'appui.
