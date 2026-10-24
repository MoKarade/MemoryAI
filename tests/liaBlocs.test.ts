// tests/liaBlocs.test.ts — le catalogue FERMÉ des blocs de réponse (lot 5). Données fictives.

import { describe, expect, it } from "vitest";
import { MAX_BLOCS, SIGNATURES_BLOCS, SOURCE_BILAN_HUB, TYPES_BLOCS, trierBlocs } from "../lib/lia/blocs";

const F1 = "0f0e0d0c-0b0a-4908-8706-050403020100";
const F2 = "1f1e1d1c-1b1a-4918-8716-151413121110";
const SERVIS = new Set([F1, F2]);
const s = (...ids: string[]) => ({ sources: ids.length ? ids : [F1] });

/** Un exemple VALIDE de chaque forme, fictif. Doit couvrir les 22 types. */
const EXEMPLES: Record<string, Record<string, unknown>> = {
  carte: { type: "carte", ...s(), points: [{ lat: 46.81, lon: -71.21, libelle: "Lieu fictif" }] },
  chrono: { type: "chrono", ...s(), evenements: [{ date: "2030-01-31", libelle: "Fin du bail" }, { date: "2030-02-01", libelle: "Déménagement" }], actuel: 1 },
  liste: { type: "liste", ...s(), elements: [{ libelle: "Renouveler le permis", fait: false }] },
  chat: { type: "chat", ...s(), messages: [{ de: "Personne A", texte: "On se voit mardi ?" }] },
  courbe: { type: "courbe", ...s(), unite: "kWh", series: [{ nom: "Recharge", points: [{ x: "lun", y: 12 }, { x: "mar", y: 9 }] }] },
  barres: { type: "barres", ...s(), barres: [{ libelle: "Janvier", valeur: 3 }] },
  camembert: { type: "camembert", ...s(), parts: [{ libelle: "A", valeur: 1 }, { libelle: "B", valeur: 2 }] },
  jauge: { type: "jauge", ...s(), libelle: "Batterie", unite: "%", valeur: 60, min: 0, max: 100 },
  chiffre: { type: "chiffre", ...s(), libelle: "Faits validés", valeur: 42, variation: 3 },
  tableau: { type: "tableau", ...s(), colonnes: ["Papier", "Année"], lignes: [["Avis fictif", "2029"]] },
  calendrier: { type: "calendrier", ...s(), jours: [{ date: "2030-03-01", intensite: 0.5 }] },
  reseau: { type: "reseau", ...s(), noeuds: [{ id: "a", libelle: "A" }, { id: "b", libelle: "B" }], liens: [{ a: "a", b: "b" }] },
  comparaison: {
    type: "comparaison",
    ...s(),
    colonnes: [
      { libelle: "Offre 1", lignes: [{ cle: "Prix", valeur: "10" }] },
      { libelle: "Offre 2", lignes: [{ cle: "Prix", valeur: "12" }] },
    ],
  },
  radar: { type: "radar", ...s(), axes: ["x", "y", "z"], series: [{ nom: "S", valeurs: [1, 2, 3] }] },
  entonnoir: { type: "entonnoir", ...s(), etapes: [{ libelle: "Vues", valeur: 10 }, { libelle: "Envoyées", valeur: 2 }] },
  flux: { type: "flux", ...s(), liens: [{ de: "Revenu", vers: "Loyer", valeur: 5 }] },
  heatmap: { type: "heatmap", ...s(), lignes: ["L"], colonnes: ["a", "b"], valeurs: [[1, 2]] },
  kanban: { type: "kanban", ...s(), colonnes: [{ libelle: "À faire", cartes: ["x"] }, { libelle: "Fait", cartes: [] }] },
  arbre: { type: "arbre", ...s(), racine: { libelle: "Racine", enfants: [{ libelle: "Feuille" }] } },
  document: { type: "document", ...s(), libelle: "Avis fictif", lien: "https://drive.example.com/fictif" },
  cadran: { type: "cadran", ...s(), segments: [{ debut: "09:00", fin: "17:00", libelle: "Travail" }], maintenant: "10:30" },
  confirmation: { type: "confirmation", action: { id: "batchchef.creer_batch", libelle: "Créer le batch" }, resume: "Créer le batch de la semaine.", niveau: 2 },
};

describe("le catalogue", () => {
  it("compte exactement les 22 formes de la maquette, et chacune a son exemple valide", () => {
    expect(TYPES_BLOCS).toHaveLength(22);
    expect(Object.keys(EXEMPLES).sort()).toEqual([...TYPES_BLOCS].sort());
    // Deux appels : 22 formes dépassent le plafond de 20 blocs par réponse.
    const tous = Object.values(EXEMPLES);
    const r1 = trierBlocs(tous.slice(0, 11), SERVIS);
    const r2 = trierBlocs(tous.slice(11), SERVIS);
    expect([...r1.rejetes, ...r2.rejetes]).toEqual([]);
    expect([...r1.blocs, ...r2.blocs].map((b) => b.type)).toEqual(Object.keys(EXEMPLES));
  });

  it("un champ inconnu est retiré, jamais rendu", () => {
    const r = trierBlocs([{ ...EXEMPLES.chiffre, html: "<script>" }], SERVIS);
    expect(r.blocs[0]).not.toHaveProperty("html");
  });
});

describe("trierBlocs", () => {
  it("rejette un type inconnu, et un bloc faux ne tue pas les autres", () => {
    const r = trierBlocs([{ type: "iframe", ...s() }, EXEMPLES.liste, { ...EXEMPLES.jauge, valeur: 200 }], SERVIS);
    expect(r.blocs.map((b) => b.type)).toEqual(["liste"]);
    expect(r.rejetes.map((x) => x.indice)).toEqual([0, 2]);
    expect(r.rejetes[0]!.raison).toBe("type inconnu");
  });

  it("⚠ une source non servie pendant le tour rejette le bloc entier", () => {
    const inventee = "2f2e2d2c-2b2a-4928-8726-252423222120";
    const r = trierBlocs([{ ...EXEMPLES.chiffre, sources: [F1, inventee] }], SERVIS);
    expect(r.blocs).toEqual([]);
    expect(r.rejetes[0]!.raison).toContain("source non servie");
  });

  it("une source citée par son adresse `/fait/<id>` vaut son id, et la règle du servi tient", () => {
    const inventee = "2f2e2d2c-2b2a-4928-8726-252423222120";
    const r = trierBlocs([{ ...EXEMPLES.chiffre, sources: [`/fait/${F1}`] }, { ...EXEMPLES.chiffre, sources: [`/fait/${inventee}`] }], SERVIS);
    expect(r.blocs).toHaveLength(1);
    expect(r.blocs[0]!.type === "chiffre" && r.blocs[0]!.sources).toEqual([F1]);
    expect(r.rejetes.map((x) => x.indice)).toEqual([1]);
  });

  it("le bilan du hub est une source seulement quand il a été servi ; aucune autre adresse /hub/", () => {
    const bilan = (s: string) => ({ ...EXEMPLES.chiffre, sources: [s] });
    const avec = trierBlocs([bilan(SOURCE_BILAN_HUB), bilan(`/${SOURCE_BILAN_HUB}`), bilan("hub/couts")], new Set([...SERVIS, SOURCE_BILAN_HUB]));
    expect(avec.blocs.map((b) => b.type === "chiffre" && b.sources)).toEqual([[SOURCE_BILAN_HUB], [SOURCE_BILAN_HUB]]);
    expect(avec.rejetes.map((x) => x.indice)).toEqual([2]);
    // Sans bilan joint à la question, la même source est inventée.
    const sans = trierBlocs([bilan(SOURCE_BILAN_HUB)], SERVIS);
    expect(sans.blocs).toEqual([]);
    expect(sans.rejetes[0]!.raison).toContain("non servie");
  });

  it("un bloc de données sans source est rejeté ; la confirmation n'en a pas besoin", () => {
    const sansSource = { ...EXEMPLES.barres, sources: [] };
    const r = trierBlocs([sansSource, EXEMPLES.confirmation], SERVIS);
    expect(r.blocs.map((b) => b.type)).toEqual(["confirmation"]);
  });

  it("⚠ la raison d'un rejet nomme les champs, jamais leurs valeurs", () => {
    const r = trierBlocs([{ ...EXEMPLES.tableau, lignes: [["valeur-secrete-fictive", "2029", "en trop"]] }], SERVIS);
    expect(r.rejetes[0]!.raison).not.toContain("valeur-secrete-fictive");
  });

  it("les cohérences internes tiennent : frise, réseau, tableau, radar, grille, arbre, lien https", () => {
    const faux = [
      { ...EXEMPLES.chrono, actuel: 5 },
      { ...EXEMPLES.reseau, liens: [{ a: "a", b: "zz" }] },
      { ...EXEMPLES.radar, series: [{ nom: "S", valeurs: [1] }] },
      { ...EXEMPLES.heatmap, valeurs: [[1]] },
      { ...EXEMPLES.document, lien: "javascript:alert(1)" },
      { ...EXEMPLES.cadran, maintenant: "25:00" },
      { ...EXEMPLES.arbre, racine: { libelle: "1", enfants: [{ libelle: "2", enfants: [{ libelle: "3", enfants: [{ libelle: "4", enfants: [{ libelle: "5" }] }] }] }] } },
    ];
    const r = trierBlocs(faux, SERVIS);
    expect(r.blocs).toEqual([]);
    expect(r.rejetes).toHaveLength(faux.length);
  });

  it(`au-delà de ${MAX_BLOCS}, le reste est rejeté et compté`, () => {
    const r = trierBlocs(Array.from({ length: MAX_BLOCS + 2 }, () => EXEMPLES.liste), SERVIS);
    expect(r.blocs).toHaveLength(MAX_BLOCS);
    expect(r.rejetes).toHaveLength(2);
  });

  it("pas une liste : rien, et le dit ; absent : rien, sans bruit", () => {
    expect(trierBlocs({ type: "liste" }, SERVIS).rejetes).toHaveLength(1);
    expect(trierBlocs(undefined, SERVIS)).toEqual({ blocs: [], rejetes: [] });
  });
});

describe("SIGNATURES_BLOCS (ce que l'outil dit au modèle)", () => {
  const lignes = SIGNATURES_BLOCS.split("\n");

  it("une ligne par forme, dans l'ordre du catalogue", () => {
    expect(lignes.map((l) => l.split(" ")[0])).toEqual(TYPES_BLOCS);
  });

  it("⚠ chaque champ d'un exemple valide figure dans la ligne de sa forme (Hubperso#360)", () => {
    for (const t of TYPES_BLOCS) {
      const ligne = lignes.find((l) => l.startsWith(`${t} `))!;
      for (const k of Object.keys(EXEMPLES[t]!).filter((k) => !["type", "titre", "sources"].includes(k))) {
        expect(ligne, `${t}.${k}`).toMatch(new RegExp(`[{,]${k}\\??:`));
      }
    }
  });

  it("reste courte : elle part à chaque tour", () => {
    expect(SIGNATURES_BLOCS.length).toBeLessThan(2500);
  });
});
