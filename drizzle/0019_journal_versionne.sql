-- 0019 — ADR 0014 : le journal d'accès consigne aussi les PAPIERS lus, et porte sa version.
--
-- ⚠️ Aucune ligne existante ne change de sens : `version` vaut 1 par défaut (le corpus
-- d'avant cet ADR, gelé) et `ids_pieces` vaut '[]' (aucune ligne passée n'a consigné de
-- papier). Les écritures futures passent version = 2 explicitement côté code
-- (`lib/journal.ts#VERSION_JOURNAL_ACTUELLE`).
-- ⚠️ Écrite à la main : `drizzle-kit generate` compare au dernier instantané (0006) et
-- régénérerait toutes les tables créées depuis, comme pour 0007 à 0018.
-- ⚠️ IDEMPOTENTE (règle du 16/09) : le migrator de production enregistre ses migrations à la
-- FIN ; une migration rejouée après un échec doit passer sans « already exists ».

ALTER TABLE "acces_journal" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "acces_journal" ADD COLUMN IF NOT EXISTS "ids_pieces" text DEFAULT '[]' NOT NULL;
