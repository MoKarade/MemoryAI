CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"titre" text,
	"debut_le" timestamp with time zone DEFAULT now() NOT NULL,
	"fin_le" timestamp with time zone DEFAULT now() NOT NULL,
	"nb_messages" integer DEFAULT 0 NOT NULL,
	"octets" integer DEFAULT 0 NOT NULL,
	"secrets_retires" integer DEFAULT 0 NOT NULL,
	"supprime_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"index" integer NOT NULL,
	"role" text NOT NULL,
	"contenu" text NOT NULL,
	"secrets_retires" integer DEFAULT 0 NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_source" ON "conversations" USING btree ("source");--> statement-breakpoint
CREATE INDEX "conversations_fin" ON "conversations" USING btree ("fin_le");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_position" ON "messages" USING btree ("conversation_id","index");