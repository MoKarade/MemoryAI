-- 0017 — l'AVANCEMENT qu'une app publie à la Mémoire (ADR 0009).
--
-- Une ligne PAR APP, écrasée à chaque envoi : la série des jours voyage DANS l'envoi (60 jours
-- au plus), donc rien ne s'accumule ici et aucune purge n'est à écrire.
--
-- ⚠️ DES COMPTES, JAMAIS DES FAITS, et rien de chiffré : ce sont des compteurs de niveau 0.
-- ⚠️ IDEMPOTENTE (règle du 16/09) : le migrator de production enregistre ses migrations à la
-- FIN ; une migration rejouée après un échec doit passer sans « already exists ».

CREATE TABLE IF NOT EXISTS "avancement_sources" (
  "app_id" text PRIMARY KEY NOT NULL,
  "mesure_le" timestamp with time zone NOT NULL,
  "recu_le" timestamp with time zone DEFAULT now() NOT NULL,
  "corps" text NOT NULL,
  CONSTRAINT "avancement_sources_app_id_forme" CHECK ("app_id" ~ '^[a-z0-9]{1,32}$')
);
