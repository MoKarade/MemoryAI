-- 0022 — la VOIX de Lia, écrite par Marc dans Régler (ADR 0005 A4, [L27]).
--
-- Une seule ligne, jamais plus : la voix est un réglage de l'app, pas une liste. `id = 1` est
-- imposé par la base (`CHECK`), pas seulement par le code — l'app n'est pas le seul chemin
-- d'écriture possible.
--
-- ⚠️ Le texte est de niveau 0 et en CLAIR : c'est une préférence de style (« tutoie-moi, sois
-- brève »), pas un fait sur Marc ; il ne porte ni identité ni montant. Les 600 caractères de
-- l'ADR sont aussi imposés ici. Ce que `nettoyerTexte` refuse (balise, URL, caractère de
-- contrôle) l'est côté code, avant d'arriver ici, et re-échappé à la lecture.
--
-- ⚠️ Pas de ligne = pas de voix = Lia garde le ton par défaut de ses règles. Effacer la voix
-- SUPPRIME la ligne : une chaîne vide ne se confondrait pas avec « jamais réglée » sans le dire.
--
-- IDEMPOTENTE (règle du 16/09) : rejouable sans lever (`tests/migrationsProd.test.ts`).

CREATE TABLE IF NOT EXISTS "voix_lia" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "texte" text NOT NULL,
  "modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "voix_lia_une_seule" CHECK ("id" = 1),
  CONSTRAINT "voix_lia_borne" CHECK (char_length("texte") BETWEEN 1 AND 600)
);
