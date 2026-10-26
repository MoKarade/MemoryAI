CREATE TABLE IF NOT EXISTS "agenda_envois" (
  "jour" text PRIMARY KEY NOT NULL,
  "envoi" text NOT NULL,
  "app" text NOT NULL,
  "nombre" integer NOT NULL,
  "lu_le" timestamp with time zone NOT NULL,
  "recu_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agenda_evenements" (
  "id" serial PRIMARY KEY NOT NULL,
  "envoi" text NOT NULL,
  "jour" text NOT NULL,
  "position" integer NOT NULL,
  "debut" timestamp with time zone NOT NULL,
  "duree_min" integer NOT NULL,
  "journee_entiere" boolean DEFAULT false NOT NULL,
  "titre" text NOT NULL,
  CONSTRAINT "agenda_evenements_duree" CHECK ("duree_min" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agenda_evenements_unicite" ON "agenda_evenements" ("envoi", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_evenements_jour" ON "agenda_evenements" ("jour");
