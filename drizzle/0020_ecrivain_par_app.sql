-- 0020 — ADR 0015 (INC-31) : le jeton dit QUI écrit.
--
-- Deux colonnes, EN AJOUT SEUL. Aucune ligne existante n'est réécrite ici :
--   - `pieces.ecrivain_app` : l'app que le JETON a prouvée à l'écriture. NULL pour tout papier
--     antérieur ; le code traite NULL du côté sûr (un papier sans app ne se remplace pas, sauf
--     s'il est un inventaire). Le remplissage des papiers existants est la migration 0021, à part,
--     parce qu'il dépend d'une vérification (ADR 0015 §3) ;
--   - `predicats_proposes.apps` : les apps distinctes qui ont proposé le prédicat. '[]' partout :
--     les listes de NOMS existantes ne se relient à aucune app, donc aucun prédicat ne gagne de
--     sources par cette migration, et aucun n'en perd son statut.
-- ⚠️ IDEMPOTENTE (règle du 16/09) : rejouée après un échec, elle passe sans « already exists ».

ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "ecrivain_app" text;
--> statement-breakpoint
ALTER TABLE "predicats_proposes" ADD COLUMN IF NOT EXISTS "apps" text DEFAULT '[]' NOT NULL;
