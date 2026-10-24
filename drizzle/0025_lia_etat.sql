-- 0025 — l'état PARTAGÉ de LIA (contrat `commun/assistant/CONTRAT-etat-lia.md`).
--
-- Une table neuve, rien de touché ailleurs : additive. Une seule ligne (le propriétaire) ; aucun
-- contenu de Marc, seulement des nombres, des verbes de LIA et un nom d'humeur, donc rien de
-- chiffré. Aucune ligne n'est posée ici : la première écriture d'une LIA la crée.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "lia_etat" (
  "id" integer PRIMARY KEY NOT NULL,
  "version" integer NOT NULL,
  "maj" bigint NOT NULL,
  "etat" jsonb NOT NULL,
  "modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lia_etat_une_ligne" CHECK ("id" = 1)
);
