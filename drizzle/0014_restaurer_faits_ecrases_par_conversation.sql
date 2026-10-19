-- 0014 — RATTRAPAGE DATÉ, unique : rendre à Marc les faits qu'une re-déduction a écrasés.
--
-- Ce qui s'est passé, mesuré. Le 17/09 à 09:00 UTC, la première passe réelle du cron a
-- proposé six faits ; les six re-disaient des faits déjà `valide` — les deux baux, le
-- kilométrage, un fournisseur — dont deux identiques caractère pour caractère. Marc les a
-- validés à 12:27. Cinq de ces prédicats n'admettant qu'une valeur, valider a fait passer
-- `perime` cinq faits corrects, et remplacé des valeurs LUES sur un document par la
-- déduction d'un modèle. L'arithmétique le ferme : 2 827 + 6 − 5 = 2 828 validés, 5 périmés.
--
-- ⚠️ CE N'EST PAS UNE RÈGLE PERMANENTE, et c'est voulu. La récidive est déjà empêchée en
-- amont par la garde `doublon_valide` (`lib/ecrireFaits.ts`, lot 20) : une valeur identique à
-- une valeur déjà validée n'entre plus. Et une vraie DIVERGENCE (valeurs différentes) ne se
-- tranche pas par une règle — elle devient une question en QCM (ADR 0004, décision n° 21,
-- re-confirmée par Marc le 17/09). Une règle « la conversation perd toujours » retirerait à un
-- modèle le droit de corriger un document mal lu, ce que personne n'a décidé.
--
-- ⚠️ POURQUOI AUCUNE LISTE DE PRÉDICATS. La condition « il existe un fait `perime` du même
-- sujet et du même prédicat » suffit : seul un prédicat qui n'admet qu'UNE valeur produit un
-- périmé lors d'une validation (`depotAdmin.valider`). Un prédicat multiple — `contrat.
-- fournisseur`, dont le doublon existe bien — n'a rien périmé, donc rien à restaurer ici. Le
-- filtre se dérive de l'EFFET, il ne se recopie pas d'une liste à tenir à jour.
--
-- ⚠️ BORNÉE PAR LA DATE (`valide_le >= 2026-09-16`), parce qu'un rattrapage sans borne est une
-- règle qui se rejoue. Les sessions suivantes ne doivent pas la relire comme un comportement
-- du produit.
--
-- ⚠️ IDEMPOTENTE PAR CONSTRUCTION, et pas par un `IF NOT EXISTS` : au second passage, le fait
-- de `conversation-v1` est devenu `perime`, donc `ecrasants` est VIDE et rien n'est touché.
-- L'échange ne peut pas osciller. (Règle du dépôt : toute migration postérieure au 16/09 est
-- idempotente — `tests/migrationsProd.test.ts`.)
--
-- ⚠️⚠️ UNE SEULE REQUÊTE, et ce n'est pas un choix de style. Mon premier jet passait par une
-- table TEMPORAIRE entre trois instructions : le migrator `neon-http` envoie chaque morceau
-- séparé par le marqueur de découpage de Drizzle dans une requête DISTINCTE, donc la table
-- temporaire n'aurait pas survécu à la deuxième — en production seulement, les tests PGlite
-- l'auraient laissée passer.
--
-- ⚠️ Et le marqueur ne se CITE PAS, même dans un commentaire : le découpage est un
-- `split()` sur la chaîne, pas un analyseur SQL. Mon premier jet écrivait le marqueur en
-- toutes lettres dans le paragraphe ci-dessus pour l'expliquer — le fichier s'est coupé au
-- milieu de la phrase, et Postgres a reçu un morceau commençant par une apostrophe inverse
-- orpheline (« syntax error at or near "`" »). Le texte qui décrit un séparateur ne peut pas
-- contenir ce séparateur. C'est exactement la panne du 16/09 (« une migration qui échoue bloque la
-- base pour toujours »). Bénéfice au passage : l'échange est ATOMIQUE, donc la question de
-- l'ordre entre « restaurer » et « périmer » ne se pose plus — dans l'autre sens, une coupure
-- aurait laissé le prédicat sans aucun fait validé, c'est-à-dire une perte.
WITH ecrasants AS (
  SELECT f.id, f.sujet, f.predicat
  FROM faits f
  JOIN provenances p ON p.fait_id = f.id
  WHERE f.statut = 'valide'
    AND f.supprime_le IS NULL
    AND f.migre_en_piece IS NULL
    AND p.extracteur = 'conversation-v1'
    AND f.valide_le >= '2026-09-16'::timestamptz
),
ecrases AS (
  -- Le plus récemment CRÉÉ des périmés : c'est le dernier état que Marc avait validé avant la
  -- re-déduction. Un périmé plus ancien avait déjà été remplacé avant, et le restaurer
  -- remonterait plus loin que le défaut qu'on répare.
  SELECT DISTINCT ON (e.sujet, e.predicat)
         v.id AS id_a_restaurer, e.id AS id_a_perimer
  FROM ecrasants e
  JOIN faits v
    ON v.sujet = e.sujet
   AND v.predicat = e.predicat
   AND v.statut = 'perime'
   AND v.supprime_le IS NULL
   AND v.migre_en_piece IS NULL
   AND v.id <> e.id
  ORDER BY e.sujet, e.predicat, v.cree_le DESC
)
UPDATE faits f
SET statut = CASE WHEN f.id = e.id_a_restaurer THEN 'valide' ELSE 'perime' END,
    valide_le = CASE WHEN f.id = e.id_a_restaurer THEN now() ELSE f.valide_le END
FROM ecrases e
WHERE f.id = e.id_a_restaurer OR f.id = e.id_a_perimer;--> statement-breakpoint
