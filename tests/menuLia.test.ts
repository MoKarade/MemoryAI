// tests/menuLia.test.ts — [R1] plus de barre d'onglets : un en-tête, et un menu qui ouvre un <dialog>.
//
// Marc, le 25/09 : « on s'y perd, trop d'onglets ». Le fait défendu n'est pas le nombre d'entrées
// mais la FORME : aucun lien de section dans l'en-tête, un menu modal que le navigateur sait
// piéger, fermer et rendre au bouton. Les liens du menu viennent de `SECTIONS`, la table que
// `navSections.test.ts` vérifie déjà page par page — on ne la recopie pas ici.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SECTIONS } from "../components/Nav";

const NAV = readFileSync("components/Nav.tsx", "utf8");
const MENU = readFileSync("components/MenuLia.tsx", "utf8");
const CSS = readFileSync("app/globals.css", "utf8");

describe("menuLia", () => {
  it("l'en-tête ne porte plus de barre d'onglets : le menu seul liste les sections", () => {
    // Le seul lien de l'en-tête est le nom de l'app ; les sections passent par <MenuLia>.
    expect(NAV.match(/<Link\b/g)?.length, "l'en-tête ne doit porter qu'un lien (le nom)").toBe(1);
    expect(NAV).toContain("<MenuLia");
    expect(CSS, "l'ancienne classe d'onglet est encore dans globals.css").not.toMatch(/\.nav-lien/);
  });

  it("le menu est un <dialog> modal : focus piégé, Échap et retour du focus viennent du navigateur", () => {
    expect(MENU).toMatch(/<dialog\b/);
    expect(MENU).toContain("showModal()");
    // Un menu qui s'ouvre sans nom accessible, ou sans bouton de fermeture, piège sans issue.
    expect(MENU).toContain('aria-label="Ouvrir le menu"');
    expect(MENU).toContain('aria-label="Fermer le menu"');
  });

  it("le menu se referme après une navigation, y compris vers la page où l'on est", () => {
    expect(MENU).toMatch(/usePathname\(\)/);
    expect(MENU).toMatch(/onClick=\{fermer\}/);
  });

  it("la première section est l'accueil : le manifeste en dérive `start_url`", () => {
    expect(SECTIONS[0].href).toBe("/");
    expect(SECTIONS.length, "le menu ne liste plus rien").toBeGreaterThanOrEqual(5);
  });

  it("le <dialog> fermé reste caché : `.menu` ne force aucun `display` hors de [open]", () => {
    // ⚠️ Un `display: flex` posé sur `.menu` lui-même affiche le menu EN PERMANENCE, par-dessus
    // la page, sans qu'aucun test de rendu ne le voie.
    const regle = /\n\.menu \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(regle, "règle `.menu` introuvable").not.toBe("");
    expect(regle).not.toMatch(/display\s*:/);
    expect(CSS).toMatch(/\.menu\[open\]\s*\{[^}]*display:\s*block/);
  });
});
