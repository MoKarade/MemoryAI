-- 0027 — les DEMANDES « Que peut-on changer ici ? » du hub (ADR 0021, MemoryAI#169).
--
-- Une table neuve, rien de touché ailleurs : additive, NON destructive. Aucune ligne n'est posée
-- ici : la première demande du hub la remplit. Le `nom` de l'élément visé est CHIFFRÉ (niveau 1,
-- AAD `demande|<id>|1`) ; le reste est un enum borné par le code (`lib/demandes.ts`).
-- `empreinte` (HMAC keyé de type, app, genre, nom et jour) rend l'écriture idempotente.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "demandes" (
  "id" text PRIMARY KEY NOT NULL,
  "empreinte" text NOT NULL,
  "type" text NOT NULL,
  "app" text NOT NULL,
  "genre" text NOT NULL,
  "nom" text NOT NULL,
  "demande_le" timestamp with time zone NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "demandes_empreinte" ON "demandes" ("empreinte");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demandes_demande_le" ON "demandes" ("demande_le");
