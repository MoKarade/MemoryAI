// tests/eslintConfig.test.ts — le lint suit la config NATIVE de Next 16 (tâche #113).
// Un retour à FlatCompat / eslint-config-next 15 rendrait muettes les règles de Next 16 et du
// React Compiler sans qu'aucune porte ne rougisse : c'est ce que ce test verrouille.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lire = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("config ESLint", () => {
  // Le code seul : le commentaire d'en-tête cite FlatCompat pour expliquer pourquoi il a disparu.
  const config = lire("eslint.config.mjs").replace(/^\s*\/\/.*$/gm, "");
  const pkg = JSON.parse(lire("package.json")) as { devDependencies: Record<string, string> };

  it("importe les configurations plates de eslint-config-next 16, sans FlatCompat", () => {
    expect(config).toContain('from "eslint-config-next/core-web-vitals"');
    expect(config).toContain('from "eslint-config-next/typescript"');
    expect(config).not.toMatch(/FlatCompat|@eslint\/eslintrc/);
  });

  it("garde le bloc ignores (sinon l'ESLint CLI scanne node_modules et .next)", () => {
    expect(config).toMatch(/ignores:\s*\[[\s\S]*node_modules\/\*\*[\s\S]*\.next\/\*\*/);
  });

  it("eslint-config-next est en 16 et @eslint/eslintrc n'est plus une dépendance", () => {
    expect(pkg.devDependencies["eslint-config-next"]).toMatch(/^\^?16\./);
    expect(pkg.devDependencies["@eslint/eslintrc"]).toBeUndefined();
  });

  it("aucune règle n'est désactivée pour faire passer le lint", () => {
    expect(lire("eslint.config.mjs")).not.toMatch(/"off"|'off'|eslint-disable/);
  });
});
