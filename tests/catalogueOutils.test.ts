// tests/catalogueOutils.test.ts — tâche MemoryAI 282 : tout outil offert au modèle a un niveau de risque.
//
// Deux sens, comme pour les autres listes du dépôt : rien d'offert sans niveau (sinon un outil neuf
// part chez le modèle sans que personne ait dit s'il écrit ou s'il sort), et aucune entrée fantôme
// (sinon la page de Régler affiche un outil qui n'existe plus).
//
// ⚠️ La liste des outils OFFERTS est dérivée du code (`OUTILS` du MCP, plus les cinq outils que
// `tourDeChat` ajoute selon le contexte), pas recopiée ici : une liste recopiée se périme sans rien
// rougir.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OUTILS, OUTILS_MCP_SEULS } from "../lib/mcp/outils";
import { OUTIL_ACTUALITE, OUTIL_BLOCS, OUTIL_METEO, OUTIL_NOTE, OUTIL_RETENIR } from "../lib/chat/agent";
import { CATALOGUE, exigerNiveaux, LIBELLE_NIVEAU, niveauDe, outilsDeLia } from "../lib/lia/catalogueOutils";

const OFFERTS = [...OUTILS.map((o) => o.name as string), OUTIL_BLOCS.name, OUTIL_NOTE.name, OUTIL_RETENIR.name, OUTIL_METEO.name, OUTIL_ACTUALITE.name];

describe("le catalogue des outils de LIA", () => {
  it("le scan voit les outils — anti-vacuité", () => {
    expect(OUTILS.length).toBeGreaterThanOrEqual(10);
    expect(OFFERTS.length).toBeGreaterThanOrEqual(15);
  });

  it("chaque outil offert a un niveau de risque valide", () => {
    const valides = Object.keys(LIBELLE_NIVEAU);
    for (const nom of OFFERTS) {
      const niveau = niveauDe(nom);
      expect(niveau, `« ${nom} » est offert au modèle sans niveau de risque au catalogue`).toBeDefined();
      expect(valides).toContain(niveau);
    }
    expect(() => exigerNiveaux(OFFERTS)).not.toThrow();
  });

  it("aucune entrée fantôme : le catalogue ne décrit que des outils qui existent", () => {
    expect([...CATALOGUE.map((e) => e.nom)].sort()).toEqual([...OFFERTS].sort());
  });

  it("un nom n'est écrit qu'une fois, et chaque phrase est courte et non vide", () => {
    const noms = CATALOGUE.map((e) => e.nom);
    expect(new Set(noms).size).toBe(noms.length);
    for (const e of CATALOGUE) {
      expect(e.fait.trim().length, `« ${e.nom} » n'a pas de phrase`).toBeGreaterThan(0);
      expect(e.fait.length, `la phrase de « ${e.nom} » est trop longue pour la page`).toBeLessThanOrEqual(120);
    }
  });

  it("les outils réservés à claude.ai sont exactement ceux du MCP seul", () => {
    const marques = CATALOGUE.filter((e) => e.mcpSeul).map((e) => e.nom);
    expect([...marques].sort()).toEqual([...OUTILS_MCP_SEULS].sort());
    for (const nom of marques) expect(outilsDeLia().map((e) => e.nom)).not.toContain(nom);
  });

  it("tout outil qui écrit ou qui sort est classé comme tel", () => {
    // Les cas qui comptent, épinglés un par un : un outil qui change quelque chose ne doit jamais
    // glisser en « lecture » par une retouche de passage.
    for (const nom of ["memoryai_proposer", "memoryai_demander", "memoryai_consigner", "lia_note", "lia_retenir"]) {
      expect(niveauDe(nom), nom).toBe("ecriture-interne");
    }
    for (const nom of ["monde_meteo", "monde_actualite"]) expect(niveauDe(nom), nom).toBe("sort-de-memoryai");
    for (const nom of ["memoryai_contexte", "memoryai_chercher", "memoryai_papiers_chercher", "lia_blocs"]) {
      expect(niveauDe(nom), nom).toBe("lecture");
    }
  });
});

describe("un outil sans niveau est refusé", () => {
  it("exigerNiveaux nomme l'outil fautif et ne laisse rien passer", () => {
    expect(() => exigerNiveaux(["memoryai_chercher", "outil_fictif"])).toThrow(/outil_fictif/);
    expect(niveauDe("outil_fictif")).toBeUndefined();
  });

  it("tourDeChat appelle la garde avant d'offrir quoi que ce soit au modèle", () => {
    // ⚠️ Ancré sur l'APPEL, jamais sur le nom nu (leçon `SCAN-QUI-MATCHE-LA-PROSE`) : l'en-tête de
    // l'agent parle de ses propres gardes.
    const src = readFileSync("lib/chat/agent.ts", "utf8");
    expect(src).toContain("exigerNiveaux(tools.map(");
    expect(src.indexOf("exigerNiveaux(tools.map(")).toBeLessThan(src.indexOf("client.create("));
  });
});

describe("la page Régler affiche le catalogue", () => {
  it("la liste vient du catalogue, pas d'un texte écrit à la main", () => {
    const src = readFileSync("app/regler/page.tsx", "utf8");
    expect(src).toContain("outilsDeLia()");
    expect(src).toContain("LIBELLE_NIVEAU[o.niveau]");
    expect(outilsDeLia().length).toBe(OFFERTS.length - OUTILS_MCP_SEULS.size);
  });
});
