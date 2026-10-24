-- 0026 — les ÉVÉNEMENTS datés et les PERSONNES (ADR 0020, MemoryAI#70, lot 1).
--
-- Quatre tables neuves, rien de touché ailleurs : additive, NON destructive. Aucune ligne n'est
-- posée ici : le premier import d'un export Messenger les remplit.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "personnes" (
  "id" text PRIMARY KEY NOT NULL,
  "nom" text NOT NULL,
  "est_marc" boolean DEFAULT false NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personne_alias" (
  "cle" text PRIMARY KEY NOT NULL,
  "personne_id" text NOT NULL REFERENCES "personnes"("id") ON DELETE CASCADE,
  "genre" text NOT NULL,
  "valeur" text NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personne_alias_personne" ON "personne_alias" ("personne_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evenements" (
  "id" text PRIMARY KEY NOT NULL,
  "genre" text NOT NULL,
  "source" text NOT NULL,
  "source_ref" text NOT NULL,
  "position" integer NOT NULL,
  "survenu_le" timestamp with time zone NOT NULL,
  "auteur_id" text NOT NULL REFERENCES "personnes"("id"),
  "fil" text,
  "texte" text,
  "pieces_jointes" integer DEFAULT 0 NOT NULL,
  "secrets_retires" integer DEFAULT 0 NOT NULL,
  "niveau" integer DEFAULT 2 NOT NULL,
  "ecrivain_app" text NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL,
  "supprime_le" timestamp with time zone,
  CONSTRAINT "evenements_niveau" CHECK ("niveau" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evenements_position" ON "evenements" ("source_ref", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evenements_survenu" ON "evenements" ("survenu_le");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evenements_auteur" ON "evenements" ("auteur_id", "survenu_le");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evenement_personnes" (
  "evenement_id" text NOT NULL REFERENCES "evenements"("id") ON DELETE CASCADE,
  "personne_id" text NOT NULL REFERENCES "personnes"("id") ON DELETE CASCADE,
  "role" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evenement_personnes_cle" ON "evenement_personnes" ("evenement_id", "personne_id", "role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evenement_personnes_personne" ON "evenement_personnes" ("personne_id");
