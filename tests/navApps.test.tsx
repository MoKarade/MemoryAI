// tests/navApps.test.tsx — l'onglet « Apps » : rendu serveur du composant et montage dans le layout.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NavApps from "../components/NavApps";
import { APPS_DU_PARC } from "../lib/appsDuParc";

const html = renderToStaticMarkup(<NavApps courant="memoryai" />);
const liens = [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ attrs: m[1] ?? "", nom: m[2] ?? "" }));
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

describe("NavApps : rendu serveur", () => {
  it("6 liens, aux adresses de lib/appsDuParc.ts, dans l'ordre et sans MemoryAI", () => {
    const attendues = APPS_DU_PARC.filter((a) => a.id !== "memoryai");
    expect(attendues).toHaveLength(6);
    expect(liens.map((l) => l.attrs.match(/href="([^"]*)"/)?.[1])).toEqual(attendues.map((a) => a.adresse));
    expect(liens.map((l) => l.nom)).toEqual(attendues.map((a) => a.nom));
    expect(html).not.toContain("MemoryAI");
  });

  it("aucun lien vers l'app courante, quelle qu'elle soit", () => {
    for (const courante of APPS_DU_PARC) {
      const rendu = renderToStaticMarkup(<NavApps courant={courante.id} />);
      expect(rendu).not.toContain(`href="${courante.adresse}"`);
      expect(rendu.match(/<a\b/g)).toHaveLength(6);
    }
  });

  it("liens sans target ni donnée dynamique : même onglet, adresse figée", () => {
    for (const { attrs } of liens) {
      expect(attrs).not.toContain("target");
      const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? "";
      expect(href).toMatch(/^https:\/\/[a-z.]+$/);
    }
  });

  it("replié par défaut, résumé « Apps », zéro JavaScript", () => {
    expect(html).toMatch(/^<details class="nav-apps">/);
    expect(html).not.toContain(" open");
    expect(html).toMatch(/<summary[^>]*>\s*Apps\s*<\/summary>/);
    expect(html).not.toContain("<script");
  });

  it("un id inconnu lève (jamais un onglet vide)", () => {
    // @ts-expect-error id volontairement hors AppId
    expect(() => renderToStaticMarkup(<NavApps courant="inconnue" />)).toThrow();
  });

  it("cibles d'au moins 44 px (2.75rem) pour l'onglet et chaque lien", () => {
    for (const classe of ["nav-apps-onglet", "nav-apps-lien"]) {
      const bloc = new RegExp(`\\.${classe}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(bloc, classe).toMatch(/min-height:\s*2\.75rem/);
      expect(bloc, classe).toMatch(/font-size:\s*1rem/);
    }
  });
});

describe("montage dans app/layout.tsx", () => {
  const layout = readFileSync(join(__dirname, "..", "app", "layout.tsx"), "utf8");

  it("monte NavApps courant=memoryai sous la même condition `lia` que LiaMaison", () => {
    expect(layout).toContain("const lia = await liaAutorisee();");
    expect(layout).toMatch(/\{lia \? <LiaMaison \/> : null\}/);
    expect(layout).toMatch(/\{lia \? <NavApps courant="memoryai" \/> : null\}/);
  });

  it("ne calcule pas de seconde session", () => {
    expect(layout.match(/liaAutorisee\(\)/g)).toHaveLength(1);
    expect(layout).not.toContain("requireSession");
  });
});
