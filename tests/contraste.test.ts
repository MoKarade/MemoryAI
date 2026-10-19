// tests/contraste.test.ts — [L38] les couleurs des graphes se CHOISISSENT par mesure.
//
// ⚠️⚠️ CE FICHIER EXISTE PARCE QUE RIEN NE REGARDAIT CES RATIOS. `tests/couleurs.test.ts`
// vérifie qu'aucune couleur n'est écrite en dur et que tout token employé est déclaré — il ne
// calcule AUCUN ratio. Et `npm run check-contrast` n'existe pas dans ce dépôt : c'est l'outil
// de FinanceAI. Les deux paires introduites par L38 (`--accent` et `--succes-texte` sur `--surface-douce`, ex-`--ok` et `--surface-2`)
// ont donc été mesurées une fois, par un audit ponctuel, et plus rien ne les aurait relues au
// prochain changement de `globals.css`. Une mesure qui ne se rejoue pas est un souvenir.
//
// ── DEUX DÉCISIONS DE CONCEPTION, ET ELLES COMPTENT ──────────────────────────────────────
//
// ⚠️ 1. ON ASSERTE LE SEUIL, PAS LA VALEUR MESURÉE. Épingler « 4,02:1 » ferait rougir ce test
// au premier ajustement légitime d'un token, et il se ferait re-baser mécaniquement — donc il
// cesserait de protéger quoi que ce soit. Le seuil, lui, EST l'exigence (WCAG 1.4.11 : 3:1
// pour du non-texte, 1.4.3 : 4,5:1 pour du texte).
//
// ⚠️ 2. LE CALCUL EST ANCRÉ SUR DES RÉFÉRENCES CONNUES, pas sur les chiffres d'un
// audit. Blanc sur noir vaut exactement 21:1, et `#767676` sur blanc est l'exemple canonique
// de WCAG à 4,54:1. Si ma luminance était fausse, ces deux-là le diraient — alors
// qu'asserter les ratios rapportés par un audit ne ferait que vérifier que je les ai recopiés.
// (Leçon du dépôt : un rapport d'agent n'est pas une source.)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync("app/globals.css", "utf8");

/** sRGB 0-255 → luminance relative WCAG. */
function luminance([r, v, b]: readonly [number, number, number]): number {
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
}

function ratio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (clair + 0.05) / (sombre + 0.05);
}

/** `#rrggbb` → sRGB 0-255. */
function hexVersSrgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

/**
 * La valeur d'un jeton, telle qu'elle est DÉCLARÉE dans `globals.css` (hexadécimal, depuis le
 * socle commun : MemoryAI#126).
 *
 * ⚠️ `occurrence` choisit quel bloc `:root` : le fichier en a deux, et le second redéclare les
 * jetons sous `prefers-color-scheme: dark`. Lire la PREMIÈRE et croire avoir mesuré les deux
 * thèmes est exactement l'erreur que ce test doit rendre impossible — un jeton qui passe en
 * clair peut échouer en sombre, et c'est invisible à la relecture.
 */
function token(nom: string, occurrence: number): readonly [number, number, number] {
  const trouves = [...CSS.matchAll(new RegExp(`--${nom}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g"))];
  expect(trouves.length, `--${nom} n'est pas déclaré en #rrggbb dans globals.css`).toBeGreaterThan(occurrence);
  return hexVersSrgb(trouves[occurrence]![1]!);
}

describe("le convertisseur est juste — ancré sur des références CONNUES", () => {
  it("blanc sur noir vaut exactement 21:1", () => {
    expect(ratio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });

  it("l'exemple canonique de WCAG : #767676 sur blanc ≈ 4,54:1", () => {
    // La valeur de référence publiée par le W3C pour le gris limite sur fond blanc. Si ma
    // luminance était fausse, elle ne tomberait pas dessus.
    expect(ratio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 1);
  });

  it("la lecture d'un jeton hexadécimal retombe sur les bons canaux", () => {
    // ⚠️ Sans ce cas, des canaux permutés (r/v/b) passeraient les deux ancres ci-dessus, qui
    // n'exercent pas la lecture des jetons.
    expect(hexVersSrgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexVersSrgb("#000000")).toEqual([0, 0, 0]);
    expect(hexVersSrgb("#1e90ff")).toEqual([0x1e, 0x90, 0xff]);
  });
});

describe("les paires que les graphes de [L38] emploient vraiment", () => {
  // ⚠️ Chaque jeton est déclaré deux fois (clair, puis sombre) : on mesure chaque paire dans
  // les DEUX thèmes, en prenant l'occurrence qui correspond.
  const THEMES = [
    { nom: "clair", i: 0 },
    { nom: "sombre", i: 1 },
  ];

  it("⚠️ la barre de l'histogramme sur son fond de colonne — non-texte, 3:1", () => {
    for (const t of THEMES) {
      const r = ratio(token("accent", t.i), token("surface-douce", t.i));
      expect(r, `--accent sur --surface-douce en thème ${t.nom} : ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("⚠️ le remplissage de la jauge sur son fond — non-texte, 3:1", () => {
    for (const t of THEMES) {
      const r = ratio(token("succes-texte", t.i), token("surface-douce", t.i));
      expect(r, `--succes-texte sur --surface-douce en thème ${t.nom} : ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("⚠️ les étiquettes d'axe — du TEXTE, donc 4,5:1", () => {
    for (const t of THEMES) {
      // Sur le fond de colonne ET sur le fond de tuile : une étiquette d'axe passe sous une
      // barre haute, donc les deux arrière-plans existent vraiment.
      for (const fond of ["surface-douce", "surface"] as const) {
        const r = ratio(token("texte-doux", t.i), token(fond, t.i));
        expect(r, `--texte-doux sur --${fond} en thème ${t.nom} : ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("le scan lit bien DEUX thèmes, et ils diffèrent — anti-vacuité", () => {
    // Sans ce cas, une regex qui ne trouverait qu'une occurrence ferait passer les trois cas
    // ci-dessus en mesurant deux fois le thème clair : « conforme en sombre » serait vrai par
    // vacuité, ce qui est exactement le défaut qu'on veut rendre impossible.
    expect(token("surface-douce", 0)).not.toEqual(token("surface-douce", 1));
    expect(token("texte-doux", 0)).not.toEqual(token("texte-doux", 1));
  });
});
