// tests/tableauxMaison.test.ts — les tuiles des panneaux de la maison (maquette v5, écart B) :
// chaque tuile de la maquette est là, et une tuile sans donnée réelle se dessine VIDE.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanneauEspace } from "@/components/PanneauEspace";
import { contenuEspaces, ESPACES, type IdEspace } from "@/lib/accueil/espaces";
import { debutDuMoisQuebec, finDuMois, jourMoins, tableauBudget, tableauIdees, tableauJournee, tableauMonde, LECTURES_DU_JOUR_MAX, minuitQuebec, tableauOutils, tableauSante, tableauSouvenirs } from "@/lib/accueil/tableaux";

vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});

const entrees = { aJuger: null, budget: null, outils: [], formes: [] };

function rendre(id: IdEspace, aJuger: { total: number; titre: string } | null = null) {
  const espace = ESPACES.find((e) => e.id === id) ?? null;
  const contenu = contenuEspaces({ ...entrees, aJuger })[id];
  return renderToStaticMarkup(createElement(PanneauEspace, { espace, contenu, choisir: () => undefined, fermer: () => undefined }));
}

describe("Monde, comme la maquette", () => {
  it("a les cinq tuiles de la maquette, à leur place, les deux dernières repliées", () => {
    const t = tableauMonde();
    expect(t.question).toBe("Ce que LIA regarde dans le monde");
    expect(t.tuiles.map((x) => x.titre)).toEqual(["Météo", "Actualité", "Sept jours", "Bornes proches", "Sources"]);
    expect(t.tuiles.map((x) => x.largeur)).toEqual([6, 6, 12, 6, 6]);
    expect(t.tuiles.filter((x) => x.repliee).map((x) => x.cle)).toEqual(["bornes", "sources"]);
  });

  it("sans source, chaque tuile est vide : aucun chiffre de la maquette", () => {
    const t = tableauMonde();
    expect(t.tuiles.every((x) => x.corps.every((c) => c.genre === "vide"))).toBe(true);
    const html = rendre("monde");
    expect(html).toContain("Pas de météo : aucune source branchée.");
    expect(html).not.toMatch(/\d+ ?°/);
  });
});

describe("Idées, comme la maquette", () => {
  it("a les quatre tuiles de la maquette, « Refusées » repliée", () => {
    const t = tableauIdees(null);
    expect(t.tuiles.map((x) => x.titre)).toEqual(["Boîte à idées", "Où elles en sont", "Utilité estimée", "Refusées, jamais reproposées"]);
    expect(t.tuiles.find((x) => x.cle === "refusees")?.repliee).toBe(true);
  });

  it("rien à juger : la boîte le dit vide, sans lien", () => {
    const boite = tableauIdees(null).tuiles[0];
    expect(boite?.corps).toEqual([{ genre: "vide", texte: "Elle ne propose pas encore d'idées pour tes apps." }]);
  });

  it("des faits à juger : la boîte mène à /questions, avec le vrai compte", () => {
    const boite = tableauIdees({ total: 3, titre: "3 à juger" }).tuiles[0];
    expect(boite?.corps[0]).toEqual({
      genre: "texte",
      texte: "3 à juger : ce qu'elle a déduit ou lu attend ton avis.",
      lien: { href: "/questions", libelle: "Juger maintenant" },
    });
    expect(rendre("idees", { total: 3, titre: "3 à juger" })).toContain('href="/questions"');
  });
});

describe("le panneau qui a ses tuiles", () => {
  it("montre la question à côté de LIA et les tuiles, plus la phrase d'avant", () => {
    const html = rendre("monde");
    expect(html).toContain('class="tab-question"');
    expect(html).toContain("<p>Ce que LIA regarde dans le monde</p>");
    expect(html.match(/<details class="tuile-m/g)).toHaveLength(5);
    expect(html).not.toContain("maison-vide");
  });

  it("un espace sans tuiles garde son corps d'avant", () => {
    const html = rendre("formes");
    expect(html).toContain("maison-vide");
    expect(html).not.toContain("tab-question");
  });
});

describe("Outils, comme la maquette", () => {
  const outils = ["memoryai_etat", "memoryai_chercher"];
  const formes = ["carte", "liste", "courbe"];

  it("a les tuiles de la maquette, à leur place", () => {
    const t = tableauOutils({ outils, formes, appels: [] });
    expect(t.question).toBe("Tout ce qu'elle sait faire");
    expect(t.tuiles.map((x) => x.titre)).toEqual([
      "En chiffres",
      "Les plus utilisés",
      "Une idée d'outil ?",
      "Lire · 2",
      "Agir dans les apps · 0",
      "Le monde · 0",
      "Elle-même · 0",
      "Afficher · 3",
    ]);
  });

  it("en chiffres : les vrais comptes, un tiret pour ce que rien ne mesure", () => {
    const t = tableauOutils({ outils, formes, appels: [{ outil: "memoryai_etat", n: 1200 }, { outil: "memoryai_chercher", n: 3 }] });
    expect(t.tuiles[0]?.corps[0]).toMatchObject({
      genre: "chiffres",
      chiffres: [
        { valeur: "2", libelle: "outils" },
        { valeur: "4", libelle: "niveaux" },
        { valeur: (1203).toLocaleString("fr-CA"), libelle: "appels ce mois" },
        { valeur: "—", libelle: "refusés à tort" },
      ],
    });
  });

  it("les plus utilisés : cinq au plus, dits pour Marc, rapportés au plus grand", () => {
    const appels = ["a", "b", "c", "d", "e", "f"].map((o, i) => ({ outil: o, n: 60 - i * 10 }));
    appels[0] = { outil: "memoryai_etat", n: 60 };
    const corps = tableauOutils({ outils, formes, appels }).tuiles[1]?.corps[0];
    expect(corps?.genre).toBe("barres");
    if (corps?.genre !== "barres") return;
    expect(corps.barres).toHaveLength(5);
    expect(corps.barres[0]).toEqual({ libelle: "L'état de sa mémoire", valeur: "60", part: 1 });
    expect(corps.barres[1]?.part).toBeCloseTo(50 / 60);
  });

  it("sans base, ni compte ni barre inventés", () => {
    const t = tableauOutils({ outils, formes, appels: null });
    expect(t.tuiles[0]?.corps[0]).toMatchObject({ chiffres: [{}, {}, { valeur: "—" }, {}] });
    expect(t.tuiles[1]?.corps[0]?.genre).toBe("vide");
    expect(tableauOutils({ outils, formes, appels: [] }).tuiles[1]?.corps).toEqual([{ genre: "vide", texte: "Aucun appel ce mois-ci." }]);
  });

  it("le panneau Outils dessine les chiffres, les barres et les familles", () => {
    const contenu = contenuEspaces({ ...entrees, outils, formes, appels: [{ outil: "memoryai_etat", n: 7 }] }).outils;
    const espace = ESPACES.find((e) => e.id === "outils") ?? null;
    const html = renderToStaticMarkup(createElement(PanneauEspace, { espace, contenu, choisir: () => undefined, fermer: () => undefined }));
    expect(html).toContain('class="tab-chiffres"');
    expect(html).toContain('aria-label="Les outils les plus appelés ce mois-ci : L&#x27;état de sa mémoire 7."');
    expect(html).toContain("<li>Chercher un fait</li>");
    expect(html).toContain("<li>courbe</li>");
  });
});

describe("le début de « ce mois-ci », à l'heure de Québec", () => {
  it("minuit du 1er à Québec, en heure d'été (UTC−4) comme en heure normale (UTC−5)", () => {
    expect(debutDuMoisQuebec(new Date("2026-10-24T05:00:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(debutDuMoisQuebec(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("le 1er à 2 h UTC, c'est encore le mois d'avant à Québec", () => {
    expect(debutDuMoisQuebec(new Date("2026-11-01T02:00:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });
});

describe("Budget, comme la maquette", () => {
  const zero = { chat: 0, apprentissage: 0 };
  const jourDe = (jour: string, chat: number, apprentissage = 0) => ({ jour, parPoste: { chat, apprentissage } });
  const base = {
    jour: "2026-10-24",
    depense: { chat: 0.25, apprentissage: 0.5 },
    plafonds: { chat: 1, apprentissage: 2 },
    parJour: [jourDe("2026-09-30", 9), jourDe("2026-10-20", 1), jourDe("2026-10-22", 0.5, 0.5), jourDe("2026-10-24", 0.25, 0.5)],
    parModele: [
      { modele: "claude-sonnet-5", usd: 3 },
      { modele: "claude-haiku-5", usd: 1 },
      { modele: "vide", usd: 0 },
    ],
  };

  it("a les six tuiles de la maquette, à leur place, les garde-fous repliés", () => {
    const t = tableauBudget(base);
    expect(t.question).toBe("Ce que LIA coûte ce mois-ci");
    expect(t.tuiles.map((x) => x.cle)).toEqual(["plafond", "rythme", "trente", "modele", "fin", "garde"]);
    expect(t.tuiles.map((x) => x.largeur)).toEqual([6, 6, 12, 6, 6, 12]);
    expect(t.tuiles.find((x) => x.cle === "garde")?.repliee).toBe(true);
  });

  it("l'anneau : la dépense du jour par poste face au plafond total", () => {
    const t = tableauBudget(base);
    expect(t.tuiles[0]?.titre).toBe("Plafond de 3,00 $ par jour");
    expect(t.tuiles[0]?.corps[0]).toMatchObject({ genre: "anneau", centre: "0,75 $", sous: "sur 3,00 $", plafond: 3, resume: "0,75 $ dépensés aujourd'hui sur un plafond de 3,00 $ par jour." });
  });

  it("le rythme : chaque poste face à son plafond, le mois sans barre inventée", () => {
    const corps = tableauBudget({ ...base, depense: { chat: 0.9, apprentissage: 0 } }).tuiles[1]?.corps[0];
    if (corps?.genre !== "jauges") throw new Error("jauges attendues");
    expect(corps.lignes.map((l) => l.libelle)).toEqual(["Aujourd'hui", "Parler", "Apprendre", "Ce mois-ci"]);
    expect(corps.lignes[1]).toEqual({ libelle: "Parler", valeur: "0,90 $ / 1,00 $", part: 0.9, alerte: true });
    expect(corps.lignes[2]?.alerte).toBe(false);
    // Septembre ne compte pas dans « ce mois-ci ».
    expect(corps.lignes[3]).toEqual({ libelle: "Ce mois-ci", valeur: "2,75 $", part: null });
  });

  it("par modèle : la part de chacun, un modèle à zéro écarté", () => {
    const corps = tableauBudget(base).tuiles[3]?.corps[0];
    if (corps?.genre !== "barres") throw new Error("barres attendues");
    expect(corps.barres).toEqual([
      { libelle: "claude-sonnet-5", valeur: "75 %", part: 1 },
      { libelle: "claude-haiku-5", valeur: "25 %", part: 1 / 3 },
    ]);
  });

  it("la fin du mois : ce qui est dépensé, puis le rythme des sept derniers jours", () => {
    // Octobre : 2,75 $ déjà ; sept derniers jours (18 au 24) : 2,75 $, soit 0,39 $ par jour sur 7 jours restants.
    expect(finDuMois(base)?.usd).toBeCloseTo(2.75 + (2.75 / 7) * 7);
    expect(finDuMois({ jour: "2026-10-24", parJour: [jourDe("2026-10-24", 1), jourDe("2026-10-23", 1)] })).toBeNull();
  });

  it("sans dépense, aucune tuile n'invente un chiffre", () => {
    const t = tableauBudget({ ...base, depense: zero, parJour: [], parModele: [] });
    expect(t.tuiles.find((x) => x.cle === "trente")?.corps[0]?.genre).toBe("vide");
    expect(t.tuiles.find((x) => x.cle === "modele")?.corps[0]?.genre).toBe("vide");
    expect(t.tuiles.find((x) => x.cle === "fin")?.corps[0]?.genre).toBe("vide");
  });

  it("sans base, les six tuiles le disent, vides", () => {
    const t = tableauBudget(null);
    expect(t.tuiles).toHaveLength(6);
    expect(t.tuiles.every((x) => x.corps.every((c) => c.genre === "vide"))).toBe(true);
  });

  it("un jour moins n jours, au calendrier", () => {
    expect(jourMoins("2026-10-24", 29)).toBe("2026-09-25");
    expect(jourMoins("2026-03-01", 1)).toBe("2026-02-28");
  });
});

describe("Souvenirs, Santé et Sa journée, comme la maquette", () => {
  const titres = (t: { tuiles: { titre: string }[] }) => t.tuiles.map((x) => x.titre);
  const toutVide = (t: ReturnType<typeof tableauSante>, sauf: string[]) =>
    t.tuiles.filter((x) => !sauf.includes(x.cle)).every((x) => x.corps.every((c) => c.genre === "vide"));

  it("Souvenirs : les sept tuiles, vides sauf la recherche qui mène à ce qui existe déjà", () => {
    const t = tableauSouvenirs();
    expect(titres(t)).toEqual(["Fil", "Filtre", "Chemin", "Journée", "Recherche", "Autour de ce jour", "Papiers liés"]);
    expect(toutVide(t, ["recherche"])).toBe(true);
    const html = rendre("souvenirs");
    expect(html).toContain('href="/conversations"');
    expect(html).toContain('href="/pieces"');
    // La question de la maquette nomme une personne FICTIVE : elle n'est pas recopiée.
    expect(html).not.toContain("Julie");
  });

  it("Santé : les neuf tuiles, vides sans Health Connect, sauf « Quand consulter » (811, 911)", () => {
    const t = tableauSante();
    expect(titres(t)).toEqual(["Signaux", "Ressemblance", "21 jours", "12 mois", "Activité", "Sommeil, 7 nuits", "Quand consulter", "Symptômes, 7 jours", "Rendez-vous"]);
    expect(toutVide(t, ["consulter"])).toBe(true);
    expect(rendre("sante")).toContain("811 (Info-Santé)");
  });

  it("Sa journée : les six tuiles ; sans lecture aujourd'hui, toutes vides", () => {
    const t = tableauJournee([]);
    expect(titres(t)).toEqual(["24 h", "Journal", "Son temps", "Relances", "Aujourd'hui", "Ce qu'elle surveille"]);
    expect(toutVide(t, [])).toBe(true);
    expect(t.tuiles.filter((x) => x.repliee).map((x) => x.cle)).toEqual(["temps", "relances", "surveille"]);
    expect(tableauJournee(null).tuiles[0]?.corps[0]).toEqual({ genre: "vide", texte: "La base ne répond pas : le journal du jour n'est pas lisible." });
  });

  it("Sa journée : ses vraies lectures du jour, heure par heure (Québec) et les plus récentes en tête", () => {
    const lectures = [
      { ts: new Date("2026-10-24T19:12:00Z"), lecteur: "lia-maison", outil: "memoryai_chercher" },
      { ts: new Date("2026-10-24T13:05:00Z"), lecteur: "claude-ai", outil: "memoryai_etat" },
      { ts: new Date("2026-10-24T13:40:00Z"), lecteur: "chat", outil: "outil_inconnu" },
    ];
    const t = tableauJournee(lectures);
    const h = t.tuiles[0]?.corps[0];
    if (h?.genre !== "histogramme") throw new Error("histogramme attendu");
    expect(h.barres).toHaveLength(24);
    // 13 h 05 et 13 h 40 UTC = 9 h à Québec (UTC−4) ; 19 h 12 UTC = 15 h.
    expect(h.barres[9]?.valeur).toBe(2);
    expect(h.barres[15]?.valeur).toBe(1);
    expect(h.resume).toBe("3 lectures aujourd'hui, heure par heure (Québec).");
    expect(t.tuiles[1]?.corps[0]).toEqual({
      genre: "liste",
      elements: [
        { libelle: "15 h 12 · Chercher un fait", detail: "LIA ici" },
        { libelle: "9 h 05 · L'état de sa mémoire", detail: "Claude" },
        { libelle: "9 h 40 · outil_inconnu", detail: "Conversation" },
      ],
    });
    expect(tableauJournee(Array.from({ length: LECTURES_DU_JOUR_MAX }, () => lectures[0]!)).tuiles[0]?.corps[0]).toMatchObject({ resume: expect.stringMatching(/^Au moins /) });
  });

  it("minuit à Québec, en instant", () => {
    expect(minuitQuebec("2026-10-24").toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(minuitQuebec("2026-11-02").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
