// tests/setupActions.ts — chargé avant chaque fichier de test (`setupFiles`, vitest.config.ts).
//
// Les Server Actions des idées sont importées par `components/TableauEspace.tsx`, donc par tout test
// qui rend un panneau. Le vrai module tire `@/lib/session`, donc next-auth, que Vitest ne résout pas
// hors de Next (« Cannot find module next/server »). Elles se testent à part : le geste sur la base
// dans `tests/ideesGestes.test.ts`, la garde de session dans `tests/gardePages.test.ts`.

import { vi } from "vitest";

vi.mock("@/app/idees/actions", () => ({
  retenirIdeeAction: async () => undefined,
  ecarterIdeeAction: async () => undefined,
}));
