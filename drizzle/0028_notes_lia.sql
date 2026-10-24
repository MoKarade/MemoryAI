-- 0028 — les NOTES que LIA laisse au coordinateur (ADR 0022, MemoryAI#188).
--
-- Une table neuve, rien de touché ailleurs : additive, NON destructive. Aucune ligne n'est posée
-- ici : la première note de LIA la remplit. Le `texte` est CHIFFRÉ (niveau 1, AAD
-- `note_lia|<id>|1`) ; `genre` et `app` sont bornés par le code (`lib/lia/notes.ts`).
-- `jour` (jour de Québec) porte le plafond de 5 notes par jour ; `lu_le` reste nul tant que le
-- coordinateur ne l'a pas lue.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "notes_lia" (
  "id" text PRIMARY KEY NOT NULL,
  "genre" text NOT NULL,
  "app" text NOT NULL,
  "texte" text NOT NULL,
  "jour" text NOT NULL,
  "cree_le" timestamp with time zone DEFAULT now() NOT NULL,
  "lu_le" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_lia_jour" ON "notes_lia" ("jour");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_lia_lu_le" ON "notes_lia" ("lu_le");
