-- À QUI un papier appartient (ADR-0061 de DriveAI, arbitrage de Marc du 16/09).
--
-- Marc a choisi que DriveAI extraie un champ « titulaire » plutôt que de pousser les
-- documents de ses proches sans distinction. L'option écartée était plus simple, et elle lui
-- retirait la possibilité de revenir en arrière pour eux SEULS : il aurait fallu re-lire
-- 19 900 documents pour savoir lesquels sont les leurs.
--
-- ⚠️ `titulaire` est CHIFFRÉ : il nomme une personne, exactement comme `sujets.nom_chiffre`.
-- `titulaire_cle` est le HMAC keyé qui permet de filtrer sans déchiffrer la table.
--
-- ⚠️ `titulaire_confiance` est EN CLAIR (un degré de certitude ne nomme personne) et il est
-- OBLIGATOIRE dès qu'un titulaire est posé : une lecture de modèle qu'on ne peut pas pondérer
-- serait crue sur parole. La contrainte le tient par la base, pas seulement par le contrat —
-- le contrat n'est pas le seul chemin d'écriture possible.
--
-- ⚠️ `NULL` veut dire INCONNU, jamais « Marc ». Un défaut de configuration n'est pas une
-- décision, et ici le défaut le plus prudent est celui qui n'attribue rien à personne.
--
-- ⚠️ CHAQUE COMMANDE EST IDEMPOTENTE, et ce n'est pas du zèle : le migrator `neon-http`
-- n'enregistre AUCUNE migration tant que toutes n'ont pas passé (il accumule les `insert`
-- et ne les exécute qu'à la fin). Une migration PLUS TARD dans la file qui échoue laisse
-- donc celle-ci appliquée et NON enregistrée — elle se rejoue à l'appel suivant, échoue sur
-- « column already exists », et la base reste bloquée pour toujours. Vécu le 16/09 : toute
-- l'app rendait « erreur de base de données », y compris les requêtes sur les faits.
ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "titulaire" text;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "titulaire_cle" text;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "titulaire_confiance" real;--> statement-breakpoint
-- Postgres n'a pas d'`ADD CONSTRAINT IF NOT EXISTS` : on retire puis on repose. Le `DROP`
-- ne perd rien — une contrainte CHECK ne porte aucune donnée, et la reposer la re-valide
-- sur les lignes existantes.
ALTER TABLE "pieces" DROP CONSTRAINT IF EXISTS "pieces_titulaire_avec_confiance";--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_titulaire_avec_confiance" CHECK ("pieces"."titulaire" IS NULL OR "pieces"."titulaire_confiance" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "pieces" DROP CONSTRAINT IF EXISTS "pieces_titulaire_confiance_0_1";--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_titulaire_confiance_0_1" CHECK ("pieces"."titulaire_confiance" IS NULL OR "pieces"."titulaire_confiance" BETWEEN 0 AND 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pieces_titulaire_cle" ON "pieces" USING btree ("titulaire_cle");
