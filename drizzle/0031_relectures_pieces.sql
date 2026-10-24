CREATE TABLE IF NOT EXISTS "relectures_pieces" (
  "id" serial PRIMARY KEY NOT NULL,
  "piece_id" text NOT NULL REFERENCES "pieces"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "divergents" text,
  "empreinte_premiere" text NOT NULL,
  "empreinte_seconde" text NOT NULL,
  "extracteur_premiere" text NOT NULL,
  "extracteur_seconde" text NOT NULL,
  "jour" text NOT NULL,
  "en_pile" boolean DEFAULT false NOT NULL,
  "relu_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "relectures_pieces_decision" CHECK ("decision" IN ('vrai', 'doute'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "relectures_pieces_unicite" ON "relectures_pieces" ("piece_id", "extracteur_seconde");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relectures_pieces_jour" ON "relectures_pieces" ("jour", "en_pile");
