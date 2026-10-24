CREATE TABLE IF NOT EXISTS "monde_cache" (
  "cle" text PRIMARY KEY NOT NULL,
  "corps" text NOT NULL,
  "lu_le" timestamp with time zone NOT NULL
);
