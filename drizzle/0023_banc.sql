-- 0023 — le BANC de questions de la refonte LIA (MemoryAI#69).
--
-- Deux tables neuves, rien de touché ailleurs : additive. Les questions sont CHIFFRÉES (elles
-- nomment des papiers de Marc) ; les mesures ne sont que des nombres.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "banc_questions" (
  "id" text PRIMARY KEY NOT NULL,
  "banc" text NOT NULL,
  "rang" integer NOT NULL,
  "capacite" text NOT NULL,
  "contenu" text NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "banc_questions_rang" ON "banc_questions" USING btree ("banc", "rang");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "banc_mesures" (
  "id" serial PRIMARY KEY NOT NULL,
  "banc" text NOT NULL,
  "chercheur" text NOT NULL,
  "resultat" text NOT NULL,
  "mesure_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banc_mesures_banc" ON "banc_mesures" USING btree ("banc", "mesure_le");
