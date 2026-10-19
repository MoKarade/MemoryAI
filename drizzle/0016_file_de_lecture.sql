-- 0016 — la FILE DE LECTURE a besoin d'UN état, et d'un seul (ADR 0007, [L35]).
--
-- Marc, 18/09 : « je veux que ce soit lia qui lise tous mes fichiers ». DriveAI demande à la
-- Mémoire « qu'est-ce que je lis ensuite ? », et la réponse est « les pièces encore
-- d'inventaire ». Un papier LU sort de cette file tout seul : depuis [L39], sa lecture
-- REMPLACE sa pièce d'inventaire. Aucune table n'est nécessaire pour ça.
--
-- ⚠️ CE QUE CETTE TABLE PORTE : le document qui ne DONNE RIEN — photo sans texte, fichier
-- disparu, extraction vide, pièce refusée. Lui ne remplace rien, donc il resterait en tête de
-- file pour toujours, et la boucle paierait son OCR (parfois son appel de modèle) à chaque
-- passe sans jamais avancer.
--
-- ⚠️ L'EXTRACTEUR EST DANS LA CLÉ PRIMAIRE. Un verdict dit « CE lecteur n'en a rien tiré »,
-- jamais « ce papier est illisible » : un extracteur neuf ré-ouvre tout, sans rien effacer.
--
-- ⚠️ Rien ici n'est un contenu : un `fileId` opaque (déjà en clair dans `piece_exemplaires`),
-- un motif d'une liste fermée tenue par le code, une date. Pas de clé étrangère vers
-- `piece_exemplaires` : un même fichier peut être l'exemplaire de plusieurs pièces (la
-- remplacée et la vivante), et c'est le FICHIER qu'on a essayé de lire, pas une pièce.

CREATE TABLE IF NOT EXISTS "lectures_tentees" (
  "file_id" text NOT NULL,
  "extracteur" text NOT NULL,
  "motif" text NOT NULL,
  "tente_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lectures_tentees_file_id_extracteur_pk" PRIMARY KEY ("file_id", "extracteur")
);
