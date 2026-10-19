CREATE TABLE "acces_journal" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"lecteur" text NOT NULL,
	"outil" text NOT NULL,
	"usage" text NOT NULL,
	"niveau_max_servi" integer NOT NULL,
	"ids_faits" text DEFAULT '[]' NOT NULL,
	"question_empreinte" text,
	"cout_usd" real,
	"hmac_precedent" text,
	"hmac" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faits" (
	"id" text PRIMARY KEY NOT NULL,
	"sujet" text NOT NULL,
	"predicat" text NOT NULL,
	"valeur" text,
	"valeur_type" text NOT NULL,
	"attributs" text,
	"valide_de" text,
	"valide_a" text,
	"domaine" text,
	"niveau" integer NOT NULL,
	"statut" text DEFAULT 'propose' NOT NULL,
	"confiance" real DEFAULT 1 NOT NULL,
	"fiabilite_source" text NOT NULL,
	"remplace_id" text,
	"canari" boolean DEFAULT false NOT NULL,
	"version_vocabulaire" integer NOT NULL,
	"empreinte" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"valide_le" timestamp with time zone,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "faits_niveau_0_3" CHECK ("faits"."niveau" BETWEEN 0 AND 3),
	CONSTRAINT "faits_n3_sans_texte" CHECK ("faits"."niveau" < 3 OR "faits"."valeur" IS NULL OR "faits"."valeur_type" IN ('date', 'ref_document')),
	CONSTRAINT "faits_confiance_0_1" CHECK ("faits"."confiance" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "oublis" (
	"empreinte" text PRIMARY KEY NOT NULL,
	"raison" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perimetres" (
	"app_id" text PRIMARY KEY NOT NULL,
	"domaines" text DEFAULT '[]' NOT NULL,
	"niveau_max" integer DEFAULT 0 NOT NULL,
	"role" text DEFAULT 'lecture' NOT NULL,
	"admet_invites" boolean DEFAULT true NOT NULL,
	"domicile" boolean DEFAULT false NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predicats_refuses" (
	"predicat" text NOT NULL,
	"appelant" text NOT NULL,
	"version_vocabulaire" integer NOT NULL,
	"nombre" integer DEFAULT 1 NOT NULL,
	"derniere_vue" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predicats_refuses_predicat_appelant_pk" PRIMARY KEY("predicat","appelant")
);
--> statement-breakpoint
CREATE TABLE "provenances" (
	"id" serial PRIMARY KEY NOT NULL,
	"fait_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"extracteur" text NOT NULL,
	"date_source" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sujets" (
	"slug" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"nom_chiffre" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provenances" ADD CONSTRAINT "provenances_fait_id_faits_id_fk" FOREIGN KEY ("fait_id") REFERENCES "public"."faits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acces_journal_ts" ON "acces_journal" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "faits_empreinte" ON "faits" USING btree ("empreinte");--> statement-breakpoint
CREATE INDEX "faits_sujet_predicat" ON "faits" USING btree ("sujet","predicat");--> statement-breakpoint
CREATE INDEX "faits_statut_niveau" ON "faits" USING btree ("statut","niveau");--> statement-breakpoint
CREATE INDEX "provenances_fait" ON "provenances" USING btree ("fait_id");--> statement-breakpoint
CREATE INDEX "provenances_source" ON "provenances" USING btree ("source_ref");