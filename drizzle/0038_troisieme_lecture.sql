-- Migration 0038 (ADR 0026, amendement du 28/10/2026, tâche MemoryAI 374) : une troisième lecture départage les doutes.
-- Additive et rejouable : aucune colonne existante ne change, rien n'est supprimé. Aucune valeur n'est gardée :
-- une empreinte keyée, une étiquette, et laquelle des deux premières lectures la troisième égale.
ALTER TABLE "relectures_pieces"
  ADD COLUMN IF NOT EXISTS "empreinte_tierce" text,
  ADD COLUMN IF NOT EXISTS "extracteur_tierce" text,
  ADD COLUMN IF NOT EXISTS "egale" text CONSTRAINT "relectures_pieces_egale" CHECK ("egale" IN ('premiere', 'seconde')),
  ADD COLUMN IF NOT EXISTS "tierce_le" timestamp with time zone;
