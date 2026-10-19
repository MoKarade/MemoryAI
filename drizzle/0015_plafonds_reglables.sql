-- 0015 — les plafonds de dépense deviennent RÉGLABLES DEPUIS L'APP (décision de Marc,
-- 18/09 : « jveux pouvoir choisir dans lapp je veux aussi un onglet dédié aux depenses a
-- limport etc »).
--
-- ⚠️⚠️ CE QUI RESTE VERROUILLÉ, ET POURQUOI CE N'EST PAS UNE CONTRADICTION. L'ADR 0001 §5.5
-- dit « plafond dur, NON DÉSACTIVABLE » (Q15). Ce qui est interdit là-bas est de l'ÉTEINDRE,
-- pas d'en choisir la valeur — et le test qui verrouillait la somme disait lui-même que
-- relever un poste oblige « à rouvrir le total avec Marc, ce qui est une décision de dépense
-- et pas un effet de bord ». Marc vient de prendre cette décision. Restent donc entiers :
--   1. un plafond EXISTE toujours — l'absence de ligne vaut le DÉFAUT (1 $ chat, 2 $
--      apprentissage : la décision du 16/09, préservée telle quelle), jamais « illimité » ;
--   2. il est toujours CONSULTÉ — `budgetOuvert` le prend en ARGUMENT, donc `tsc` énumère
--      chaque site d'appel et aucun ne peut l'oublier ;
--   3. il ne peut PAS dépasser un maximum écrit dans le CODE, et la base le refuse aussi
--      (`CHECK` ci-dessous) : une valeur entrée par erreur, ou par une session compromise,
--      ne peut pas ouvrir une facture sans fond.
--
-- ⚠️ Une ligne par POSTE, typée par l'énumération, plutôt qu'une table clé/valeur : un
-- fourre-tout `reglages(cle, valeur)` accepterait `plafond_aprentissage` mal orthographié et
-- retomberait sur le défaut en silence — le pire des deux mondes, puisque Marc croirait avoir
-- réglé quelque chose. Ici, un poste inconnu est refusé par la base.
--
-- ⚠️ Le plancher est ZÉRO, et c'est délibéré : `0 $` veut dire « ne dépense rien
-- aujourd'hui », donc le plafond est au MAXIMUM de son effet. C'est une pause, pas un
-- interrupteur — et c'est exactement ce dont Marc a besoin pour freiner un import en cours
-- sans toucher au code.

CREATE TABLE IF NOT EXISTS "plafonds" (
  "poste" text PRIMARY KEY NOT NULL,
  "usd_par_jour" real NOT NULL,
  "modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plafonds_poste_connu" CHECK ("poste" IN ('chat', 'apprentissage')),
  CONSTRAINT "plafonds_borne" CHECK ("usd_par_jour" >= 0 AND "usd_par_jour" <= 50)
);
