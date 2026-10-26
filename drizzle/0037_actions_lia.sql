-- Migration 0037 (ADR 0032, tâche MemoryAI 283) : le journal de ce que LIA fait seule, et son frein.
-- Additive et rejouable. Le journal ne porte que des COMPTES et des clés fermées : aucune valeur de fait, aucun contenu.
-- La base refuse elle-même un niveau `sort-de-memoryai` : une action qui sort de MemoryAI n'est jamais lancée seule.
CREATE TABLE IF NOT EXISTS "actions_lia" (
  "id" text PRIMARY KEY NOT NULL,
  "jour" text NOT NULL,
  "instant" timestamp with time zone DEFAULT now() NOT NULL,
  "action" text NOT NULL,
  "niveau" text NOT NULL,
  "raison" text NOT NULL,
  "n" integer DEFAULT 0 NOT NULL,
  "issue" text NOT NULL,
  CONSTRAINT "actions_lia_niveau" CHECK ("niveau" IN ('lecture', 'ecriture-interne')),
  CONSTRAINT "actions_lia_issue" CHECK ("issue" IN ('faite', 'echec', 'frein', 'budget')),
  CONSTRAINT "actions_lia_raison_200" CHECK (char_length("raison") <= 200),
  CONSTRAINT "actions_lia_n_positif" CHECK ("n" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_lia_jour" ON "actions_lia" ("jour", "instant");
--> statement-breakpoint
-- Le frein : UNE ligne. Absente, LIA est en marche (choix de Marc, 26/10 20:42Z).
CREATE TABLE IF NOT EXISTS "lia_frein" (
  "id" text PRIMARY KEY DEFAULT 'frein' NOT NULL,
  "en_pause" boolean DEFAULT false NOT NULL,
  "change_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lia_frein_une_ligne" CHECK ("id" = 'frein')
);
