CREATE TABLE IF NOT EXISTS "validations_lia" (
  "id" serial PRIMARY KEY NOT NULL,
  "fait_id" text NOT NULL REFERENCES "faits"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "verdict" text,
  "signal_code" boolean NOT NULL,
  "raison" text,
  "empreinte_source" text,
  "empreinte_valeur" text NOT NULL,
  "extracteur" text NOT NULL,
  "jour" text NOT NULL,
  "en_pile" boolean DEFAULT false NOT NULL,
  "relu_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "validations_lia_decision" CHECK ("decision" IN ('valide', 'doute', 'sans-source'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validations_lia_fait" ON "validations_lia" ("fait_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validations_lia_jour" ON "validations_lia" ("jour", "en_pile");
