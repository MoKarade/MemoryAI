-- 0033 — les IDÉES de LIA pour les apps (ADR 0027, MemoryAI#233).
--
-- Une table neuve, rien de touché ailleurs : additive, NON destructive. Aucune ligne n'est posée
-- ici : la passe quotidienne la remplit à partir des demandes du hub (table `demandes`). La
-- `cible` (le nom de l'élément visé) est CHIFFRÉE (niveau 1, AAD `idee|<id>`) ; `raisons` ne porte
-- que des nombres et une date. `empreinte` (HMAC keyé de règle, app, genre et nom) rend la
-- création idempotente et fait qu'une idée écartée ne revient pas.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "idees" (
  "id" text PRIMARY KEY NOT NULL,
  "regle" text NOT NULL,
  "app" text NOT NULL,
  "genre" text NOT NULL,
  "cible" text NOT NULL,
  "empreinte" text NOT NULL,
  "etat" text DEFAULT 'proposee' NOT NULL,
  "utilite" integer NOT NULL,
  "raisons" jsonb NOT NULL,
  "issue" text,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL,
  "maj_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idees_utilite_0_100" CHECK ("utilite" BETWEEN 0 AND 100),
  CONSTRAINT "idees_etat" CHECK ("etat" IN ('proposee', 'retenue', 'faite', 'ecartee')),
  CONSTRAINT "idees_regle" CHECK ("regle" IN ('demande-repetee'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idees_empreinte" ON "idees" ("empreinte");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idees_etat_utilite" ON "idees" ("etat", "utilite");
