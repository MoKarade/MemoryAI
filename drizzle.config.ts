import { defineConfig } from "drizzle-kit";

// `db:generate` compare le schéma TypeScript aux migrations COMMITTÉES et ne touche à
// aucune base : il tourne sans DATABASE_URL. L'application, elle, est automatique au
// démarrage (`lib/migrations.ts`) — Marc ne lance jamais `db:migrate`.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
