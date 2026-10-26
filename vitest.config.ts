import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // vitest 5 (Vite 8) transforme avec oxc. `tsconfig.json` porte `"jsx": "react-jsx"` depuis
  // Next 16 (Turbopack le réécrit au build, MANDATORY — voir BACKLOG.md) ; l'ancien réglage
  // `preserve` que visait ce commentaire n'existe plus. La ligne suivante reste EXPLICITE
  // plutôt que dépendante de tsconfig : sans elle, un .tsx dont le JSX resterait brut ne
  // s'analyserait plus, et la couverture l'ÉCARTERAIT EN SILENCE (mesuré : 5 .tsx comptés
  // sur 35 dans CarAI).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // Reproduit le path alias "@/*" du tsconfig (Next le résout en prod, pas Vitest).
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Les Server Actions des idées, importées par un composant, tireraient next-auth : voir le fichier.
    setupFiles: ["tests/setupActions.ts"],
    // 30 s au lieu de 10 s pour les beforeAll/afterAll : sur le PC de Marc chargé (agents en
    // parallèle), une dizaine de suites dépassaient 10 s et la porte de commit bloquait par
    // intermittence (30/09). Aucun seuil touché ; la cause de la lenteur est au BACKLOG.
    // 16/10/2026 : 30 s ne suffisaient plus non plus — le démarrage de PGlite (beforeEach de six
    // fichiers) a dépassé 30 s trois fois de suite sur le robot (Gate de #152, puis Qualité de #152 et de
    // `main`). Un fichier qui tombe en délai fait aussi chuter la couverture : le cliquet rougissait
    // pour une cause qui n'est pas le code. 90 s ; les assertions et les seuils ne bougent pas.
    // Aucun test ne fixe son propre délai en dessous : un `}, 60_000)` en fin de beforeEach
    // l'emportait sur ces 90 s et retombait en délai sous l'instrumentation de la couverture.
    hookTimeout: 90_000,
    // Même délai pour les tests eux-mêmes : certains montent une base PGlite complète (toutes les
    // migrations) DANS le test. Sur le robot de tests chargé, questions.test.ts dépassait les 5 s
    // par défaut puis passait à la relance (15/10/2026). Aucun seuil ni assertion touché.
    testTimeout: 90_000,
    // Couverture (porte qualité de l'Atelier, S6) : calculée seulement avec --coverage (npm run portes).
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
