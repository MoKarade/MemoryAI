-- 0021 — ADR 0015 §3 : attribuer une app aux papiers écrits AVANT la migration 0020.
--
-- ⚠️⚠️ NE PAS FUSIONNER sans la réponse du chef sur la condition de l'ADR 0015 §3 (« aucun
-- papier n'a été écrit par un autre jeton que celui de DriveAI »). Tant que cette migration
-- n'est pas passée, le code reste du côté sûr : un papier sans app ne se remplace pas, sauf
-- s'il est un inventaire (reconnu à son nom `moteur-inventaire-v1`).
--
-- La règle, et rien d'autre :
--   - `extracteur = 'moteur-inventaire-v1'` ⇒ `migration-inventaire` (l'écrivain EN PROCESSUS) ;
--   - tout autre papier sans app ⇒ `driveai`.
-- Pourquoi l'erreur possible est bornée : attribuer à tort un papier à DriveAI ne donne qu'un
-- droit, celui pour DriveAI (seule app de `APPS_PIECES`) de le RELIRE à un rang supérieur de sa
-- lignée. Aucune autre app n'en gagne ; aucun papier n'est réécrit par cette migration.
-- ⚠️ IDEMPOTENTE (règle du 16/09) : elle ne touche que les lignes encore NULL.

UPDATE "pieces" SET "ecrivain_app" = 'migration-inventaire'
  WHERE "ecrivain_app" IS NULL AND "extracteur" = 'moteur-inventaire-v1';
--> statement-breakpoint
UPDATE "pieces" SET "ecrivain_app" = 'driveai'
  WHERE "ecrivain_app" IS NULL;
