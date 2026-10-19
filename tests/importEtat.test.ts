// tests/importEtat.test.ts — [L38] les chiffres d'un tableau de bord sont des AFFIRMATIONS.
//
// Marc, 18/09 : « je veux des graphs voir ce qui reste ce qui a été traité depuis combien de
// temps etc combien de liens fais etc ». Une page de suivi ne se juge pas sur ce qu'elle
// affiche quand tout va bien : elle se juge sur ce qu'elle dit quand la mesure MANQUE.
//
// Les trois pièges que `lib/importEtat.ts` existe pour éviter, dans l'ordre de gravité :
//   1. DEUX RYTHMES répondent à deux questions différentes, et prendre le mauvais fabrique
//      une estimation confiante et fausse ;
//   2. un rythme NUL ne donne pas une estimation infinie, il n'en donne AUCUNE ;
//   3. un pourcentage sur un total NUL n'est pas « 0 % », c'est « rien à mesurer ».
//
// ⚠️ Module PUR : aucune base, aucun React, `aujourdhui` passé en argument. Une fonction qui
// lit l'horloge n'est pas testable, et un test qui fige une date pendant que le code lit
// l'heure est une bombe à retardement (leçon FinanceAI, payée deux fois).

import { describe, it, expect } from "vitest";
import { etatImport } from "../lib/importEtat";

const AUJ = "2026-09-18";

describe("ce qui reste, ce qui est traité", () => {
  it("compte, et rend la part", () => {
    const e = etatImport({ lus: 83, restants: 2645, joursLus: [{ jour: "2026-09-17", nombre: 83 }], aujourdhui: AUJ });
    expect(e.lus).toBe(83);
    expect(e.restants).toBe(2645);
    expect(e.total).toBe(2728);
    expect(e.partLuePourCent).toBeCloseTo(3.0425, 3);
  });

  it("⚠️ un total NUL ne rend pas « 0 % » mais RIEN À MESURER", () => {
    // `0/0` vaut `NaN`, et `NaN.toFixed(1)` s'affiche « NaN » — un mot à la place d'un chiffre,
    // sur une page où tout le reste EST un chiffre. `null` dit la vérité, et le rendu le sait.
    const e = etatImport({ lus: 0, restants: 0, joursLus: [], aujourdhui: AUJ });
    expect(e.partLuePourCent).toBeNull();
    expect(e.total).toBe(0);
  });

  it("tout lu ⇒ la part est 100, et il ne reste AUCUNE estimation à donner", () => {
    const e = etatImport({ lus: 10, restants: 0, joursLus: [{ jour: AUJ, nombre: 10 }], aujourdhui: AUJ });
    expect(e.partLuePourCent).toBe(100);
    // ⚠️ `null` et non `0` : « environ 0 jour » et « rien à faire » se ressemblent, et le rendu
    // les distingue par deux phrases différentes. Aplatir en `0` dirait « ça arrive bientôt ».
    expect(e.joursActifsRestants).toBeNull();
  });
});

describe("depuis combien de temps — le chiffre qui dit si ça TOURNE", () => {
  it("rien lu aujourd'hui ⇒ le nombre de jours depuis la dernière lecture", () => {
    // ⚠️⚠️ LA grandeur de la page : un import arrêté depuis trois semaines et un import qui
    // avance ont la MÊME barre de progression. Sans celle-ci, Marc ne peut pas les distinguer.
    const e = etatImport({
      lus: 83,
      restants: 2645,
      joursLus: [{ jour: "2026-08-28", nombre: 83 }],
      aujourdhui: AUJ,
    });
    expect(e.joursDepuisDernier).toBe(21);
    expect(e.dernierJour).toBe("2026-08-28");
    expect(e.premierJour).toBe("2026-08-28");
  });

  it("lu aujourd'hui ⇒ zéro jour, ce qui n'est PAS la même chose que « jamais »", () => {
    const e = etatImport({ lus: 5, restants: 1, joursLus: [{ jour: AUJ, nombre: 5 }], aujourdhui: AUJ });
    expect(e.joursDepuisDernier).toBe(0);
  });

  it("⚠️ JAMAIS rien lu ⇒ `null`, pas zéro", () => {
    // « arrêté depuis 0 jour » serait faux et rassurant — exactement le pire des deux. Le rendu
    // affiche alors une phrase DIFFÉRENTE (« aucun document n'a encore été lu »).
    const e = etatImport({ lus: 0, restants: 2728, joursLus: [], aujourdhui: AUJ });
    expect(e.joursDepuisDernier).toBeNull();
    expect(e.dernierJour).toBeNull();
    expect(e.premierJour).toBeNull();
  });

  it("une date illisible ne propage pas de NaN dans l'affichage", () => {
    // Une colonne altérée, un format inattendu : `Date.parse` rend `NaN`, et un `NaN` propagé
    // devient « NaN jours » à l'écran. On rend 0 plutôt que de propager.
    const e = etatImport({ lus: 1, restants: 1, joursLus: [{ jour: "pas-une-date", nombre: 1 }], aujourdhui: AUJ });
    expect(Number.isFinite(e.joursDepuisDernier)).toBe(true);
  });

  it("un jour POSTÉRIEUR à aujourd'hui ne rend pas un écart négatif", () => {
    // Décalage d'horloge, fuseau, base restaurée : « lu depuis -2 jours » n'a aucun sens.
    const e = etatImport({ lus: 1, restants: 1, joursLus: [{ jour: "2026-09-20", nombre: 1 }], aujourdhui: AUJ });
    expect(e.joursDepuisDernier).toBe(0);
  });
});

describe("⚠️⚠️ le rythme est celui des jours ACTIFS", () => {
  it("un import arrêté n'annonce PAS une progression qui n'existe pas", () => {
    // LE piège du lot. 83 documents lus en UNE journée, il y a trois semaines.
    //   - rythme « total ÷ jours écoulés » = 83/21 ≈ 4/jour → « il reste 660 jours », ce qui
    //     laisse croire que ça avance ;
    //   - rythme des jours ACTIFS = 83/1 = 83/jour → « environ 32 jours où l'import tourne »,
    //     et la ligne « rien lu depuis 21 jours » dit à part que ça ne tourne pas.
    // Les deux chiffres sont vrais ; un seul répond à la question posée.
    const e = etatImport({
      lus: 83,
      restants: 2645,
      joursLus: [{ jour: "2026-08-28", nombre: 83 }],
      aujourdhui: AUJ,
    });
    expect(e.joursActifs).toBe(1);
    expect(e.rythmeParJourActif).toBe(83);
    expect(e.joursActifsRestants).toBe(Math.ceil(2645 / 83));
    // Et la preuve que ce n'est PAS l'autre rythme : 83/21 ≈ 3,95 donnerait 670.
    expect(e.joursActifsRestants).not.toBe(Math.ceil(2645 / (83 / 21)));
  });

  it("les jours à ZÉRO ne comptent pas comme actifs", () => {
    // Sinon le rythme se diviserait par des jours où il n'y avait rien à faire — et un jour
    // vide n'est pas un jour de travail lent, c'est un jour sans travail.
    const e = etatImport({
      lus: 10,
      restants: 10,
      joursLus: [
        { jour: "2026-09-16", nombre: 10 },
        { jour: "2026-09-17", nombre: 0 },
      ],
      aujourdhui: AUJ,
    });
    expect(e.joursActifs).toBe(1);
    expect(e.rythmeParJourActif).toBe(10);
    // Et le « dernier jour » est le dernier jour ACTIF, pas le dernier jour de la série : un
    // jour vide en tête de liste ferait croire que quelque chose a été lu ce jour-là.
    expect(e.dernierJour).toBe("2026-09-16");
  });

  it("le rythme se mesure sur ce que la SÉRIE porte, pas sur `lus`", () => {
    // ⚠️ Les deux diffèrent dès qu'un papier a été lu avant le début de la fenêtre montrée (30
    // jours) ou avant une reprise de base. Diviser `lus` par les jours de la série gonflerait
    // le rythme en silence — ici 500/2 = 250 au lieu de 20.
    const e = etatImport({
      lus: 500,
      restants: 100,
      joursLus: [
        { jour: "2026-09-17", nombre: 20 },
        { jour: "2026-09-18", nombre: 20 },
      ],
      aujourdhui: AUJ,
    });
    expect(e.rythmeParJourActif).toBe(20);
  });

  it("la série se trie : l'ordre d'arrivée ne décide pas du premier ni du dernier jour", () => {
    const e = etatImport({
      lus: 3,
      restants: 0,
      joursLus: [
        { jour: "2026-09-18", nombre: 1 },
        { jour: "2026-09-01", nombre: 2 },
      ],
      aujourdhui: AUJ,
    });
    expect(e.premierJour).toBe("2026-09-01");
    expect(e.dernierJour).toBe("2026-09-18");
  });
});

describe("⚠️ un rythme NUL ne donne pas une estimation INFINIE", () => {
  it("aucun jour actif ⇒ aucune estimation", () => {
    // `restants / 0` vaut `Infinity`, et `Infinity.toFixed(0)` s'affiche « Infinity ». Le rendu
    // dit alors « pas de rythme mesuré, donc aucune estimation honnête ».
    const e = etatImport({ lus: 0, restants: 2728, joursLus: [], aujourdhui: AUJ });
    expect(e.rythmeParJourActif).toBeNull();
    expect(e.joursActifsRestants).toBeNull();
  });

  it("aucune grandeur rendue n'est NaN ni Infinity, quelles que soient les entrées", () => {
    // Anti-vacuité de tout le fichier : une balise unique qui refuse la classe entière, plutôt
    // que d'espérer avoir énuméré tous les cas limites.
    const entrees = [
      { lus: 0, restants: 0, joursLus: [], aujourdhui: AUJ },
      { lus: 0, restants: 5, joursLus: [], aujourdhui: AUJ },
      { lus: 5, restants: 0, joursLus: [{ jour: AUJ, nombre: 5 }], aujourdhui: AUJ },
      { lus: 1, restants: 1, joursLus: [{ jour: "x", nombre: 1 }], aujourdhui: AUJ },
      { lus: 1, restants: 1, joursLus: [{ jour: AUJ, nombre: 0 }], aujourdhui: AUJ },
    ];
    for (const entree of entrees) {
      for (const [cle, valeur] of Object.entries(etatImport(entree))) {
        if (typeof valeur !== "number") continue;
        expect(Number.isFinite(valeur), `${cle} vaut ${valeur} pour ${JSON.stringify(entree)}`).toBe(true);
      }
    }
  });
});
