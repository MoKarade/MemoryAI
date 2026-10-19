-- 0012 — les faits `document.existe` deviennent des PIÈCES (ADR 0004 §6.2, décision n° 7).
--
-- ⚠️ CETTE MIGRATION N'EN DÉPLACE AUCUN. Elle ne fait qu'ouvrir les deux colonnes qui rendent
-- le déplacement POSSIBLE et RÉVERSIBLE. Le déplacement lui-même est du CODE, et il ne peut
-- pas être du SQL : la valeur d'un fait est chiffrée avec l'AAD `id|niveau`, donc la déplacer
-- suppose de la déchiffrer puis de la re-sceller sous l'identifiant de la pièce. Postgres n'a
-- pas la clé, et c'est précisément le but.
--
-- ⚠️ La suppression est LOGIQUE, pas physique. `migre_en_piece` marque le fait comme migré :
-- il cesse d'être servi, il n'est pas effacé. Le retour en arrière est alors un `UPDATE … SET
-- migre_en_piece = NULL` plus la suppression des pièces qui portent `origine_fait_id` — et
-- une migration sur des milliers de lignes de production se livre avec son retour en arrière.
ALTER TABLE faits ADD COLUMN IF NOT EXISTS migre_en_piece timestamptz;--> statement-breakpoint

-- Le LIEN, dans ce sens-là : c'est lui qui rend l'annulation exacte (on ne supprime que ce
-- que la migration a créé) et la reprise idempotente (un fait déjà migré a déjà sa pièce).
ALTER TABLE pieces ADD COLUMN IF NOT EXISTS origine_fait_id text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS faits_a_migrer
  ON faits (predicat) WHERE migre_en_piece IS NULL AND supprime_le IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS pieces_origine_fait
  ON pieces (origine_fait_id) WHERE origine_fait_id IS NOT NULL;
