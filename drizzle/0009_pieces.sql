-- ADR 0004 §6.2 — une PIÈCE est ce qu'un PAPIER contient, et ce n'est pas un fait : elle
-- n'affirme rien sur Marc, elle rapporte. C'est ce qui lui permet de porter des champs LIBRES
-- sans rouvrir la porte d'injection que le vocabulaire fermé referme du côté des faits.
--
-- ⚠️ DEUX RÉGIMES DE CHIFFREMENT (décision de Marc, 16/09). `resume` et `recherche` sont en
-- clair pour une pièce de niveau < 3 venant d'un dossier RECONNU, chiffrés sinon. La
-- contrainte `pieces_chiffre_sans_recherche` le fait tenir par la BASE et pas seulement par
-- `lib/pieces/regime.ts` : un chemin d'écriture qui oublierait le régime écrirait du niveau 3
-- en clair sans que rien ne lève.
--
-- ⚠️ `champs_structures` et `champs_libres` sont chiffrés DANS LES DEUX RÉGIMES : c'est là que
-- vivent les numéros de référence, les montants et les numéros d'identité.
--
-- Cette migration ne DÉPLACE aucune donnée. La migration des 2 729 faits `document.existe`
-- vers des pièces exige de DÉCHIFFRER (l'AAD est `id|niveau`), ce que du SQL ne peut pas
-- faire : elle se fait par du code, avec son retour arrière, et dans un lot à part.
CREATE TABLE "pieces" (
	"id" text PRIMARY KEY NOT NULL,
	"sujet" text DEFAULT 'marc' NOT NULL,
	"type" text,
	"type_cle" text,
	"emetteur" text,
	"emetteur_cle" text,
	"annee" integer,
	"domaine" text,
	"langue" text,
	"date_document" text,
	"date_echeance" text,
	"niveau" integer NOT NULL,
	"resume_en_clair" boolean NOT NULL,
	"resume" text,
	"recherche" text,
	"champs_structures" text,
	"champs_libres" text,
	"remplace_id" text,
	"statut" text DEFAULT 'active' NOT NULL,
	"confiance" real DEFAULT 1 NOT NULL,
	"extracteur" text NOT NULL,
	"empreinte" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "pieces_niveau_0_3" CHECK ("pieces"."niveau" BETWEEN 0 AND 3),
	CONSTRAINT "pieces_confiance_0_1" CHECK ("pieces"."confiance" BETWEEN 0 AND 1),
	CONSTRAINT "pieces_chiffre_sans_recherche" CHECK ("pieces"."resume_en_clair" OR "pieces"."recherche" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "piece_exemplaires" (
	"id" serial PRIMARY KEY NOT NULL,
	"piece_id" text NOT NULL,
	"file_id" text NOT NULL,
	"chemin" text,
	"principal" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "piece_exemplaires" ADD CONSTRAINT "piece_exemplaires_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pieces_empreinte" ON "pieces" USING btree ("empreinte");--> statement-breakpoint
CREATE INDEX "pieces_facettes" ON "pieces" USING btree ("domaine","annee");--> statement-breakpoint
CREATE INDEX "pieces_emetteur_cle" ON "pieces" USING btree ("emetteur_cle");--> statement-breakpoint
CREATE INDEX "pieces_type_cle" ON "pieces" USING btree ("type_cle");--> statement-breakpoint
CREATE UNIQUE INDEX "piece_exemplaires_unicite" ON "piece_exemplaires" USING btree ("piece_id","file_id");--> statement-breakpoint
CREATE INDEX "piece_exemplaires_file" ON "piece_exemplaires" USING btree ("file_id");--> statement-breakpoint
-- La recherche plein texte FRANÇAISE (ADR 0004 §7). Index d'EXPRESSION plutôt que colonne
-- générée : une colonne que le schéma Drizzle ne déclare pas se ferait proposer à la
-- suppression au prochain `drizzle-kit generate`. Un index, lui, est invisible à cette
-- comparaison — il survit.
--
-- `recherche` est NULL pour les pièces au régime chiffré : elles sont hors de cet index par
-- construction, et c'est voulu. Elles se retrouvent par leurs facettes.
CREATE INDEX "pieces_recherche_fr" ON "pieces" USING gin (to_tsvector('french', coalesce("recherche", '')));
