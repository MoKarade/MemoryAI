CREATE TABLE "depenses_chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"jour" text NOT NULL,
	"modele" text NOT NULL,
	"entree" integer DEFAULT 0 NOT NULL,
	"sortie" integer DEFAULT 0 NOT NULL,
	"ecriture_cache" integer DEFAULT 0 NOT NULL,
	"lecture_cache" integer DEFAULT 0 NOT NULL,
	"cout_usd" real NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "depenses_chat_jour" ON "depenses_chat" USING btree ("jour");