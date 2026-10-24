// tests/bancPasse.test.ts — la passe du banc (MemoryAI#69) : figer une fois, mesurer une fois par jour. Papiers FICTIFS.
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { CAPACITES, PAR_CAPACITE, type Mesure, type PapierBanc } from "@/lib/banc/banc";
import { BANC_COURANT, passeBanc, type DepotBanc, type LigneBanc } from "@/lib/banc/passe";
import { deriverCle } from "@/lib/chiffrement";

const cle = deriverCle(randomBytes(32).toString("base64"));

/** Un parc fictif assez riche pour chaque capacité : 12 émetteurs, 3 papiers chacun. */
function parc(): PapierBanc[] {
  const papiers: PapierBanc[] = [];
  for (let e = 0; e < 12; e++) {
    for (let i = 0; i < 3; i++) {
      papiers.push({ id: `p${e}-${i}`, type: `releve${e}`, emetteur: `Banque Fictive ${e}`, annee: 2020 + i, dateDocument: `${2020 + i}-0${i + 1}-15` });
    }
  }
  return papiers;
}

function depotMemoire(): DepotBanc & { mesures: { chercheur: string; resultat: Mesure; mesureLe: Date }[]; lignes: LigneBanc[] } {
  const lignes: LigneBanc[] = [];
  const mesures: { chercheur: string; resultat: Mesure; mesureLe: Date }[] = [];
  let horloge = new Date("2026-10-22T12:00:00Z");
  return {
    lignes,
    mesures,
    async questions() {
      return [...lignes].sort((a, b) => a.rang - b.rang);
    },
    async figer(_b, l) {
      for (const x of l) if (!lignes.some((y) => y.rang === x.rang)) lignes.push(x);
    },
    async enregistrerMesure(_b, chercheur, resultat) {
      mesures.push({ chercheur, resultat, mesureLe: horloge });
      horloge = new Date(horloge.getTime() + 1000);
    },
    async derniereMesure() {
      return mesures.at(-1) ?? null;
    },
    async comptesParCapacite() {
      return {};
    },
  };
}

describe("la passe du banc", () => {
  const sources = (rendre: (motsCles: string) => string[] = () => []) => ({ lireParc: async () => parc(), chercher: async (m: string) => rendre(m) });

  it("fige le banc chiffré une fois, puis ne le retire plus", async () => {
    const depot = depotMemoire();
    const maintenant = () => new Date("2026-10-22T12:00:00Z");
    expect((await passeBanc({ depot, sources: sources(), cle, maintenant })).fin).toBe("fige-et-mesure");
    expect(depot.lignes).toHaveLength(PAR_CAPACITE * CAPACITES.length);
    // Chiffré : aucun émetteur fictif ne se lit dans ce qui est stocké.
    expect(depot.lignes.some((l) => l.contenu.includes("Banque Fictive"))).toBe(false);
    const avant = depot.lignes.map((l) => l.contenu);
    await passeBanc({ depot, sources: { ...sources(), lireParc: async () => [] }, cle, maintenant: () => new Date("2026-10-24T12:00:00Z") });
    expect(depot.lignes.map((l) => l.contenu)).toEqual(avant);
  });

  it("mesure au plus une fois par jour, et la mesure ne garde que des nombres", async () => {
    const depot = depotMemoire();
    const papiers = parc();
    // Une recherche parfaite : rend les papiers dont le type et l'émetteur sont dans les mots.
    const parfaite = (m: string) => papiers.filter((p) => m.startsWith(`${p.type} ${p.emetteur}`) && (!/\d{4}$/.test(m) || m.endsWith(String(p.annee)))).map((p) => p.id);
    await passeBanc({ depot, sources: sources(parfaite), cle, maintenant: () => new Date("2026-10-22T12:00:00Z") });
    expect((await passeBanc({ depot, sources: sources(parfaite), cle, maintenant: () => new Date("2026-10-22T15:00:00Z") })).fin).toBe("deja-mesure");
    expect(depot.mesures).toHaveLength(1);
    const m = depot.mesures[0]!;
    expect(m.resultat.abstentionCorrecte).toBe(1);
    expect(m.resultat.parCapacite.extraction.rappel).toBe(1);
    expect(JSON.stringify(m.resultat)).not.toMatch(/Banque|p\d+-\d/);
  });

  it("un parc trop pauvre ne fige rien et dit pourquoi", async () => {
    const depot = depotMemoire();
    const r = await passeBanc({ depot, sources: { ...sources(), lireParc: async () => parc().slice(0, 2) }, cle, maintenant: () => new Date() });
    expect(r.fin).toBe("banc-invalide");
    expect(r.erreurs.length).toBeGreaterThan(0);
    expect(depot.lignes).toHaveLength(0);
  });

  it("le banc courant a un nom stable", () => {
    expect(BANC_COURANT).toBe("papiers-v2");
  });
});
