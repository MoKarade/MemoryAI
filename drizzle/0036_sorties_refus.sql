-- Migration 0036 (ADR 0031 § 5, tâche MemoryAI 281) : ce que la porte POST /api/sorties a REFUSÉ, compté par jour et par code.
-- Additive et rejouable. Un nombre par (jour, code fermé) : on sait qu'on refuse et pourquoi, jamais quoi ni pour qui.
CREATE TABLE IF NOT EXISTS "sorties_refus" (
  "jour" text NOT NULL,
  "code" text NOT NULL,
  "n" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "sorties_refus_pk" PRIMARY KEY ("jour", "code")
);
