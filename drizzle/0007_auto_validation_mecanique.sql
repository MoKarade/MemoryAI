-- Rattrapage de l'ADR 0003 : les faits MÉCANIQUES déjà en base passent en « valide ».
--
-- Un fait mécanique n'a jamais vu de modèle : l'écrivain est identifié par son jeton, le
-- prédicat est fermé, la valeur est un pointeur. Le relire une par une n'apprend rien à Marc
-- et noie ce qu'un modèle a DÉDUIT, qui est la seule chose qui mérite son œil.
--
-- Les couples (extracteur, prédicat) autorisés vivent dans `lib/autoValidation.ts`
-- (`COUPLES_MECANIQUES`) ; `tests/autoValidation.test.ts` exige que CHACUN soit couvert par
-- une migration de `drizzle/`. Un couple ajouté plus tard reçoit donc sa PROPRE migration :
-- on ne réécrit jamais un fichier déjà appliqué (son empreinte le ferait rejouer).
--
-- Trois gardes, et elles ne se négocient pas :
--   * `statut = 'propose'`  — un fait que Marc a REJETÉ ne se fait pas re-valider dans son dos ;
--   * `canari = false`      — un canari ne s'auto-valide jamais, quelle que soit sa provenance ;
--   * `supprime_le IS NULL` — un fait oublié ne revient pas.
-- `valide_le` est posé : la colonne dit « quand ce fait est devenu valide », pas « quand Marc
-- l'a touché » — sans elle, le `dataAsOf` du hub retomberait à NULL (tri `DESC` = NULLS FIRST).

UPDATE "faits"
SET "statut" = 'valide', "valide_le" = now()
FROM "provenances"
WHERE "provenances"."fait_id" = "faits"."id"
  AND "faits"."statut" = 'propose'
  AND "faits"."canari" = false
  AND "faits"."supprime_le" IS NULL
  AND ("provenances"."extracteur" = 'moteur-inventaire-v1' AND "faits"."predicat" = 'document.existe');
