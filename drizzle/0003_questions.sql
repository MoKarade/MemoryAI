CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"predicat_vise" text NOT NULL,
	"motif" text NOT NULL,
	"origine" text NOT NULL,
	"statut" text DEFAULT 'ouverte' NOT NULL,
	"fait_id" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"close_le" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "questions_texte" ON "questions" USING btree ("predicat_vise","question");--> statement-breakpoint
CREATE INDEX "questions_statut" ON "questions" USING btree ("statut");