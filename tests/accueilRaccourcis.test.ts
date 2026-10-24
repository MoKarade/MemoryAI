// tests/accueilRaccourcis.test.ts — la touche `/` de l'accueil (maquette v5, écart A6) : elle
// ouvre la conversation, jamais quand Marc écrit.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estRaccourciParler } from "@/lib/accueil/raccourcis";

const touche = (key: string, reste: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  ...reste,
});
/** Une cible fictive : `closest` répond pour le sélecteur de saisie selon `dansSaisie`. */
const cible = (dansSaisie: boolean) => ({ closest: (s: string) => (dansSaisie && s.includes("textarea") ? {} : null) });

describe("la touche / ouvre la conversation", () => {
  it("depuis la maison, sans modificateur", () => {
    expect(estRaccourciParler(touche("/"), cible(false))).toBe(true);
    expect(estRaccourciParler(touche("/"), null)).toBe(true);
  });

  it("jamais dans un champ, une zone de texte ou un bloc éditable", () => {
    expect(estRaccourciParler(touche("/"), cible(true))).toBe(false);
  });

  it("jamais avec Ctrl, Cmd ou Alt, ni si un autre écouteur l'a prise", () => {
    expect(estRaccourciParler(touche("/", { ctrlKey: true }), null)).toBe(false);
    expect(estRaccourciParler(touche("/", { metaKey: true }), null)).toBe(false);
    expect(estRaccourciParler(touche("/", { altKey: true }), null)).toBe(false);
    expect(estRaccourciParler(touche("/", { defaultPrevented: true }), null)).toBe(false);
  });

  it("aucune autre touche", () => {
    for (const k of ["a", "?", "Enter", "Escape", " "]) expect(estRaccourciParler(touche(k), null)).toBe(false);
  });

  it("toucher LIA ouvre aussi la conversation (lia-ui v0.33.0, surToucher)", () => {
    const accueil = readFileSync("app/AccueilClient.tsx", "utf8");
    expect(accueil).toMatch(/surToucher=\{surToucher\}/);
    expect(accueil).toMatch(/const surToucher = useCallback\(\(\) => \{\s*routeur\.push\("\/chat"\);\s*return true;/);
  });

  it("l'accueil écoute la touche et ouvre /chat", () => {
    const accueil = readFileSync("app/AccueilClient.tsx", "utf8");
    expect(accueil).toMatch(/estRaccourciParler\(e, cible\)/);
    expect(accueil).toMatch(/routeur\.push\("\/chat"\)/);
  });
});
