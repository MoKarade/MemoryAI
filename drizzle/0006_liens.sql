CREATE TABLE "liens" (
	"id" text PRIMARY KEY NOT NULL,
	"fait_a" text NOT NULL,
	"fait_b" text NOT NULL,
	"cible_b" text DEFAULT 'fait' NOT NULL,
	"type" text NOT NULL,
	"poids" real DEFAULT 1 NOT NULL,
	"origine" text DEFAULT 'regle' NOT NULL,
	"regle" text NOT NULL,
	"pourquoi" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liens_poids_0_1" CHECK ("liens"."poids" BETWEEN 0 AND 1),
	CONSTRAINT "liens_question_seulement_cause" CHECK ("liens"."cible_b" = 'fait' OR "liens"."type" = 'cause-declaree'),
	CONSTRAINT "liens_pas_de_boucle" CHECK ("liens"."fait_a" <> "liens"."fait_b")
);
--> statement-breakpoint
ALTER TABLE "liens" ADD CONSTRAINT "liens_fait_a_faits_id_fk" FOREIGN KEY ("fait_a") REFERENCES "public"."faits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "liens_paire" ON "liens" USING btree ("fait_a","fait_b","type");--> statement-breakpoint
CREATE INDEX "liens_fait_a" ON "liens" USING btree ("fait_a");--> statement-breakpoint
CREATE INDEX "liens_origine" ON "liens" USING btree ("origine");