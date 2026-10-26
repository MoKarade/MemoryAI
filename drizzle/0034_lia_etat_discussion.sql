-- 0034 — la DISCUSSION de LIA suit Marc d'une app à l'autre (ADR 0030, MemoryAI#263).
--
-- Une colonne neuve, nullable, sur `lia_etat` : additive, NON destructive, aucune ligne touchée.
-- Elle porte la fin de la discussion (JSON `{ ouvert, quand, msgs }`), CHIFFRÉE au niveau 2
-- (AAD `lia_etat|discussion|2`), à part du JSON `etat`, qui n'en porte jamais. NULL : aucune
-- discussion gardée.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

ALTER TABLE "lia_etat" ADD COLUMN IF NOT EXISTS "discussion" text;
