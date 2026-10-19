-- 0011 — la quarantaine du vocabulaire (ADR 0004 §2.3, décision de Marc du 16/09).
--
-- Un prédicat hors vocabulaire n'est plus REFUSÉ : il est accepté, stocké, et mis en
-- quarantaine — jamais servi à un modèle tant qu'il n'en sort pas. L'état vit sur le
-- prédicat et non sur le fait : une sortie de quarantaine doit être UN geste, pas une
-- migration de toutes ses lignes.
CREATE TABLE IF NOT EXISTS predicats_proposes (
  predicat      text PRIMARY KEY,
  statut        text NOT NULL DEFAULT 'en_quarantaine',
  extracteurs   text NOT NULL DEFAULT '[]',
  nombre        integer NOT NULL DEFAULT 1,
  premiere_vue  timestamptz NOT NULL DEFAULT now(),
  derniere_vue  timestamptz NOT NULL DEFAULT now(),
  sortie_le     timestamptz,
  sortie_par    text,
  -- Échec FERMÉ : un statut inventé ne doit pas se lire comme « accepté » par défaut côté
  -- lecture. La base refuse ce que le code n'a pas prévu, comme pour `faits.statut`.
  CONSTRAINT predicats_proposes_statut CHECK (statut IN ('en_quarantaine', 'accepte', 'refuse')),
  -- Un prédicat SORTI porte forcément la trace de sa sortie, et réciproquement : sans ça,
  -- « accepté » et « accepté par qui, quand » divergeraient en silence.
  CONSTRAINT predicats_proposes_sortie CHECK (
    (statut = 'accepte') = (sortie_le IS NOT NULL AND sortie_par IS NOT NULL)
  )
);--> statement-breakpoint

-- La file de Marc se lit par là : ce qui attend, le plus employé d'abord.
CREATE INDEX IF NOT EXISTS predicats_proposes_quarantaine
  ON predicats_proposes (nombre DESC) WHERE statut = 'en_quarantaine';
