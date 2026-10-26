-- Migration 0035 (ADR 0031, tâche MemoryAI 281) : ce qui sort des apps, une ligne par événement.
-- Additive et rejouable. `titre` et `resume` sont CHIFFRÉS au niveau retenu (AAD `sorties|<id>|<colonne>|<niveau>`).
CREATE TABLE IF NOT EXISTS "sorties" (
  "id" text PRIMARY KEY NOT NULL,
  "app" text NOT NULL,
  "type" text NOT NULL,
  "date" timestamp with time zone NOT NULL,
  "niveau" integer NOT NULL,
  "empreinte" text NOT NULL,
  "titre" text NOT NULL,
  "resume" text,
  "recu_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sorties_niveau_1_3" CHECK ("niveau" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sorties_app_empreinte" ON "sorties" ("app", "empreinte");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sorties_app_date" ON "sorties" ("app", "date");
