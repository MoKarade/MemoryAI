-- 0018 — les AVIS de Marc sur la pile « vrai / faux » (ADR 0012).
--
-- ⚠️ EN AJOUT SEUL : un avis ne se met jamais à jour. Le verdict en vigueur est le plus
-- récent ; changer d'avis ajoute une ligne, et l'ancien reste lisible (« je ne veux rien
-- perdre »). Un avis ne modifie AUCUNE pièce ni aucun fait : il est lu à côté.
-- ⚠️ La remarque est CHIFFRÉE (elle peut citer un numéro), sous l'AAD `avis|<ref_id>`.
-- ⚠️ IDEMPOTENTE (règle du 16/09) : le migrator de production enregistre ses migrations à la
-- FIN ; une migration rejouée après un échec doit passer sans « already exists ».

CREATE TABLE IF NOT EXISTS "avis_pile" (
  "id" serial PRIMARY KEY NOT NULL,
  "genre" text NOT NULL,
  "ref_id" text NOT NULL,
  "verdict" text NOT NULL,
  "remarque" text,
  "avis_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "avis_pile_genre" CHECK ("genre" IN ('piece', 'fait', 'question')),
  CONSTRAINT "avis_pile_verdict" CHECK ("verdict" IN ('vrai', 'faux', 'passe')),
  CONSTRAINT "avis_pile_remarque_seulement_faux" CHECK ("remarque" IS NULL OR "verdict" = 'faux')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avis_pile_ref" ON "avis_pile" ("genre", "ref_id", "avis_le");
