-- 0024 — le sauvetage par re-chiffrement (ADR 0019, incident du 23/10/2026).
--
-- Trois tables neuves, rien de touché ailleurs : additive.
--   • `chiffre_v1_archive` : ce qu'une ligne sauvée portait AVANT (scellés `v1`, empreintes), en
--     JSON. Écrite dans la MÊME instruction que la ligne sauvée ; jamais modifiée ensuite. Si la
--     clé perdue revient, tout s'y relit.
--   • `sauvetage_echecs` : les lignes qui n'ont pas pu être sauvées, et pourquoi (des RAISONS
--     fermées, jamais une valeur). Retentées à chaque relance.
--   • `sauvetage_etat` : une seule ligne. Elle n'est posée que si la base porte DÉJÀ des faits ou
--     des papiers — une base neuve n'a rien à sauver, et ses écritures restent ouvertes. Tant
--     que `clos_le` est vide, les écritures des apps répondent 503 (ADR 0019 §2).
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "chiffre_v1_archive" (
  "table_nom" text NOT NULL,
  "ligne_id" text NOT NULL,
  "ancien" text NOT NULL,
  "sauve_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chiffre_v1_archive_pk" PRIMARY KEY ("table_nom", "ligne_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sauvetage_echecs" (
  "table_nom" text NOT NULL,
  "ligne_id" text NOT NULL,
  "raisons" text NOT NULL,
  "essais" integer DEFAULT 1 NOT NULL,
  "maj_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sauvetage_echecs_pk" PRIMARY KEY ("table_nom", "ligne_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sauvetage_etat" (
  "id" integer PRIMARY KEY NOT NULL,
  "ouvert_le" timestamp with time zone DEFAULT now() NOT NULL,
  "clos_le" timestamp with time zone,
  CONSTRAINT "sauvetage_etat_une_ligne" CHECK ("id" = 1)
);
--> statement-breakpoint
INSERT INTO "sauvetage_etat" ("id")
SELECT 1 WHERE EXISTS (SELECT 1 FROM "faits") OR EXISTS (SELECT 1 FROM "pieces")
ON CONFLICT ("id") DO NOTHING;
