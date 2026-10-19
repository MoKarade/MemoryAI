// tests/theme.test.ts — verrou du socle visuel commun (MemoryAI#126, d'après app-template#39).
//
// Le socle vient d'app-template (`tests/theme.test.ts`) : mêmes jetons, même vocabulaire, mêmes
// seuils. Ce fichier en reprend les cas, avec les ajustements de MemoryAI nommés plus bas.
//
// Ce que ce fichier NE refait PAS : « aucune valeur de couleur hors de globals.css ».
// `tests/couleurs.test.ts` le tient déjà, avec les exceptions propres à MemoryAI (page de
// consentement OAuth autonome, couleur d'identité du contrat, manifeste, barre système).
// Deux gardes pour la même règle auraient deux listes d'exceptions, donc deux vérités.
//
// Pourquoi un test et pas une relecture — incident BatchChef du 14/08/2026 : une passe de
// refonte avait laissé 21 `bg-white` figés sous un texte clair hérité en thème sombre. Une
// couleur figée est parfaitement lisible dans le thème pour lequel on l'a écrite : aucune
// relecture ne la voit, aucune erreur ne se lève. Il faut une machine qui les compte.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RACINE = process.cwd();

/** PÉRIMÈTRE POSITIF : les dossiers qui produisent du balisage. */
const DOSSIERS_RENDUS = ["app", "components", "lib"];

/**
 * Le seul fichier qui ne lit PAS `globals.css` : une page HTML autonome, servie hors de l'app
 * par la route de consentement OAuth, avec sa propre feuille et ses propres variables.
 * Exception NOMMÉE, jamais un dossier : si elle disparaît, la ligne doit disparaître avec.
 */
const PAGE_AUTONOME = "app/api/mcp/authorize/route.ts";

function fichiersDe(dossier: string): string[] {
  const absolu = join(RACINE, dossier);
  try {
    statSync(absolu);
  } catch {
    return [];
  }
  return readdirSync(absolu, { recursive: true, encoding: "utf8" })
    .map((f) => join(dossier, f).split("\\").join("/"))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

const FICHIERS = DOSSIERS_RENDUS.flatMap(fichiersDe).sort();

function lire(chemin: string): string {
  return readFileSync(join(RACINE, chemin), "utf8");
}

function parLigne(fichier: string, motif: RegExp): string[] {
  const fautes: string[] = [];
  lire(fichier)
    .split("\n")
    .forEach((ligne, i) => {
      for (const trouvee of ligne.match(motif) ?? []) {
        fautes.push(`${relative(".", fichier)}:${i + 1} — ${trouvee}`);
      }
    });
  return fautes;
}

const CSS = lire("app/globals.css");

/** Corps du premier bloc `:root { … }` (thème clair) et de celui du bloc sombre. */
function blocs(): { clair: string; sombre: string } {
  const corps = (source: string, debut: number): string => {
    const ouvre = source.indexOf("{", debut);
    let profondeur = 0;
    for (let i = ouvre; i < source.length; i++) {
      if (source[i] === "{") profondeur++;
      if (source[i] === "}" && --profondeur === 0) return source.slice(ouvre + 1, i);
    }
    throw new Error("accolade non fermée dans globals.css");
  };
  const clair = corps(CSS, CSS.indexOf(":root"));
  const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(media, "globals.css doit porter un bloc @media (prefers-color-scheme: dark)").toBeGreaterThan(-1);
  const interieur = corps(CSS, media);
  const sombre = corps(interieur, interieur.indexOf(":root"));
  return { clair, sombre };
}

const { clair, sombre } = blocs();

/** `--nom: #rrggbb;` — les couleurs sont en hexadécimal, ce qui les rend mesurables. */
function couleurs(source: string): [string, string][] {
  return [...source.matchAll(/^\s*(--[a-z-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gim)].map(
    (m) => [m[1] ?? "", (m[2] ?? "").toLowerCase()] as [string, string],
  );
}

describe("socle visuel — aucune couleur hors des jetons", () => {
  it("voit bien les fichiers de rendu (sinon le garde est vert à vide)", () => {
    expect(FICHIERS.length).toBeGreaterThan(20);
    expect(FICHIERS).toContain("app/page.tsx");
    expect(FICHIERS).toContain("app/login/page.tsx");
    expect(FICHIERS).toContain(PAGE_AUTONOME);
  });

  it("aucune classe de palette Tailwind (elle ne connaît pas prefers-color-scheme)", () => {
    const palettes =
      "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
    const proprietes =
      "bg|text|border|placeholder|ring|from|to|via|divide|decoration|outline|accent|caret|fill|stroke|shadow";
    const motif = new RegExp(`\\b(?:${proprietes})-(?:${palettes})(?:-\\d{2,3})?(?:/\\d{1,3})?\\b`, "g");
    const fautes = FICHIERS.flatMap((f) => parLigne(f, motif));
    expect(fautes, `Couleurs figées (utilise un jeton de globals.css) :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("chaque `var(--jeton)` cité est défini dans globals.css", () => {
    // Un nom mal orthographié ne lève rien : la propriété devient invalide et la couleur est
    // simplement héritée. Silencieux, et joli dans le thème où on l'a écrit.
    const definis = new Set([...CSS.matchAll(/^\s*(--[a-z-]+)\s*:/gm)].map((m) => m[1]));
    const citations: [string, string][] = [
      ...FICHIERS.filter((f) => f !== PAGE_AUTONOME).flatMap((f) =>
        [...lire(f).matchAll(/var\(\s*(--[a-z-]+)/g)].map((m) => [f, m[1] ?? ""] as [string, string]),
      ),
      ...[...CSS.matchAll(/var\(\s*(--[a-z-]+)/g)].map((m) => ["app/globals.css", m[1] ?? ""] as [string, string]),
    ];
    expect(citations.length, "aucune citation trouvée : le garde serait vide").toBeGreaterThan(20);
    const fautes = citations.filter(([, nom]) => !definis.has(nom)).map(([f, nom]) => `${f} — ${nom}`);
    expect(fautes, `Jetons inexistants :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("chaque classe statique utilisée dans le balisage est définie dans globals.css", () => {
    // Avant ce socle, `actions-ligne`, `secondaire` et `btn-lien` étaient employées et définies
    // NULLE PART (BACKLOG) : la page s'affichait sans style et rien ne le disait.
    const definies = new Set([...CSS.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]));
    const fautes: string[] = [];
    let vues = 0;
    for (const fichier of FICHIERS.filter((f) => f.endsWith(".tsx"))) {
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          for (const m of ligne.matchAll(/className="([^"]+)"/g)) {
            for (const classe of (m[1] ?? "").split(/\s+/).filter(Boolean)) {
              vues++;
              if (!definies.has(classe)) fautes.push(`${fichier}:${i + 1} — ${classe}`);
            }
          }
        });
    }
    expect(vues, "aucune classe lue : le garde serait vide").toBeGreaterThan(100);
    expect(fautes, `Classes sans règle (ajoute-la au vocabulaire ou retire-la) :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("chaque champ de saisie (texte, nombre, liste, zone) porte `.champ`", () => {
    // Avant ce socle, `input[type="text"]` était stylé par un sélecteur d'élément : le champ de
    // recherche des papiers (sans `type`) et le champ de plafond (`type="number"`) restaient
    // des champs bruts du navigateur, sous les 44 px et sous les 16 px. Le sélecteur d'élément
    // est parti ; la classe est désormais le seul chemin, donc l'oubli se voit ici.
    const sansStyle = ["hidden", "checkbox", "radio", "submit", "button", "file"];
    const fautes: string[] = [];
    let vus = 0;
    for (const fichier of FICHIERS.filter((f) => f.endsWith(".tsx") && f !== PAGE_AUTONOME)) {
      const source = lire(fichier);
      for (const m of source.matchAll(/<(input|textarea|select)\b/g)) {
        const debut = m.index ?? 0;
        const suivant = source.indexOf("<", debut + 1);
        const balise = source.slice(debut, suivant === -1 ? undefined : suivant);
        const type = /\btype="([a-z]+)"/.exec(balise)?.[1];
        if (type && sansStyle.includes(type)) continue;
        vus++;
        if (!/className="[^"]*\bchamp\b/.test(balise)) {
          const ligne = source.slice(0, debut).split("\n").length;
          fautes.push(`${fichier}:${ligne} — <${m[1]}> sans la classe champ`);
        }
      }
    }
    expect(vus, "aucun champ trouvé : le garde serait vide").toBeGreaterThanOrEqual(8);
    expect(fautes, fautes.join("\n")).toEqual([]);
  });
});

describe("socle visuel — clair ET sombre", () => {
  it("suit le système : color-scheme `light dark`", () => {
    expect(clair).toMatch(/color-scheme:\s*light\s+dark\s*;/);
  });

  it("chaque couleur est définie une seule fois par thème", () => {
    for (const [nom, bloc] of [["clair", clair], ["sombre", sombre]] as const) {
      const noms = couleurs(bloc).map(([n]) => n);
      expect(noms.length, `thème ${nom} : trop peu de jetons lus, le garde serait vide`).toBeGreaterThan(15);
      const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
      expect(doublons, `thème ${nom} : jetons définis deux fois`).toEqual([]);
    }
  });

  it("chaque couleur du thème clair est redéfinie en sombre, et inversement", () => {
    // C'est le défaut du 14/08 : une couleur oubliée en sombre garde sa valeur claire.
    // Exception NOMMÉE : les deux fonds « système » (manifeste, barre d'état) sont une paire
    // clair/sombre écrite d'un seul bloc ; ce ne sont pas des couleurs de l'interface.
    const SYSTEME = ["--bg-systeme-clair", "--bg-systeme-sombre"];
    const c = couleurs(clair).map(([n]) => n).filter((n) => !SYSTEME.includes(n));
    const s = couleurs(sombre).map(([n]) => n);
    expect(c.filter((n) => !s.includes(n)), "absentes du thème sombre").toEqual([]);
    expect(s.filter((n) => !c.includes(n)), "absentes du thème clair").toEqual([]);
  });

  it("les fonds « système » de l'app installée sont ceux de `--fond`, dans chaque thème", () => {
    // `tests/couleurs.test.ts` vérifie que le manifeste et la barre d'état reprennent ces deux
    // valeurs ; ce cas vérifie que ces deux valeurs reprennent le fond de l'app. Sans lui, un
    // changement de `--fond` laisserait un flash de l'ancienne couleur au lancement.
    const c = Object.fromEntries(couleurs(clair)) as Record<string, string>;
    const s = Object.fromEntries(couleurs(sombre)) as Record<string, string>;
    expect(c["--bg-systeme-clair"]).toBe(c["--fond"]);
    expect(c["--bg-systeme-sombre"]).toBe(s["--fond"]);
  });

  it("porte le vocabulaire commun (un renommage casserait les forks en silence)", () => {
    const noms = couleurs(clair).map(([n]) => n);
    for (const requis of [
      "--fond", "--surface", "--surface-douce", "--bordure", "--bordure-champ",
      "--texte", "--texte-doux", "--accent", "--accent-fonce", "--sur-accent",
      "--repere", "--repere-doux",
      "--succes-fond", "--succes-texte", "--alerte-fond", "--alerte-texte",
      "--erreur-fond", "--erreur-texte",
    ]) {
      expect(noms, `jeton manquant : ${requis}`).toContain(requis);
    }
    const classes = new Set([...CSS.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]));
    for (const requise of [
      "carte", "bouton", "bouton-principal", "bouton-second", "bouton-danger", "champ",
      "doux", "succes", "alerte", "erreur", "pastille", "bandeau", "surtitre",
    ]) {
      expect(classes, `classe manquante : .${requise}`).toContain(requise);
    }
  });

  it("les couples texte/fond passent le WCAG dans les DEUX thèmes (texte 4,5:1 ; contour 3:1)", () => {
    const lin = (c: number): number => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string): number => {
      const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // [premier plan, arrière-plan, minimum]. 4,5 = texte ; 3 = composant d'interface (1.4.11).
    const couples: [string, string, number][] = [
      ["--texte", "--fond", 4.5],
      ["--texte", "--surface", 4.5],
      ["--texte", "--surface-douce", 4.5],
      ["--texte-doux", "--fond", 4.5],
      ["--texte-doux", "--surface", 4.5],
      ["--texte-doux", "--surface-douce", 4.5],
      ["--sur-accent", "--accent", 4.5],
      ["--sur-accent", "--accent-fonce", 4.5],
      ["--repere", "--fond", 4.5],
      ["--repere", "--surface", 4.5],
      ["--repere", "--repere-doux", 4.5],
      ["--succes-texte", "--succes-fond", 4.5],
      ["--alerte-texte", "--alerte-fond", 4.5],
      ["--erreur-texte", "--erreur-fond", 4.5],
      ["--erreur-texte", "--surface", 4.5],
      ["--bordure-champ", "--surface", 3],
      ["--bordure-champ", "--fond", 3],
      ["--accent", "--fond", 3],
    ];
    const tropBas: string[] = [];
    for (const [nom, bloc] of [["clair", clair], ["sombre", sombre]] as const) {
      const v = Object.fromEntries(couleurs(bloc)) as Record<string, string>;
      for (const [a, b, min] of couples) {
        const fa = v[a];
        const fb = v[b];
        if (!fa || !fb) {
          tropBas.push(`${nom} : ${a} / ${b} : jeton introuvable`);
          continue;
        }
        const r = ratio(fa, fb);
        if (r < min) tropBas.push(`${nom} : ${a} ${fa} / ${b} ${fb} : ${r.toFixed(2)}:1 < ${min}:1`);
      }
    }
    expect(tropBas, `Contrastes insuffisants :\n${tropBas.join("\n")}`).toEqual([]);
  });
});

describe("socle visuel — l'ordre des règles compte", () => {
  it("`.pastille` est déclarée AVANT `.succes`, `.alerte` et `.erreur`", () => {
    // À spécificité égale, la dernière règle gagne : une pastille déclarée après les états
    // garde son fond gris quand on lui ajoute `.alerte`. Vu sur les captures de MemoryAI#126 :
    // « à confirmer » restait gris. Le socle d'app-template a l'ordre inverse.
    const rang = (classe: string): number => CSS.search(new RegExp(`^\\.${classe}\\s*\\{`, "m"));
    expect(rang("pastille"), ".pastille introuvable").toBeGreaterThan(-1);
    for (const etat of ["succes", "alerte", "erreur"]) {
      expect(rang(etat), `.${etat} introuvable`).toBeGreaterThan(-1);
      expect(rang("pastille"), `.pastille doit précéder .${etat}`).toBeLessThan(rang(etat));
    }
  });
});

describe("socle visuel — cibles tactiles et champs", () => {
  /** Corps de la règle `.classe { … }` (la première, hors pseudo-classes). */
  function regle(classe: string): string {
    const m = CSS.match(new RegExp(`^\\.${classe}\\s*\\{([^}]*)\\}`, "m"));
    expect(m, `règle .${classe} introuvable`).not.toBeNull();
    return m?.[1] ?? "";
  }

  it("`.bouton` et `.champ` font au moins 44 px de haut", () => {
    for (const classe of ["bouton", "champ"]) {
      const m = regle(classe).match(/min-height:\s*([\d.]+)rem/);
      expect(m, `.${classe} : min-height en rem attendu`).not.toBeNull();
      expect(Number(m?.[1]) * 16, `.${classe} : hauteur minimale en px`).toBeGreaterThanOrEqual(44);
    }
  });

  it("`.champ` est à 16 px au moins (en dessous, iOS zoome tout seul)", () => {
    const m = regle("champ").match(/font-size:\s*([\d.]+)rem/);
    expect(m, ".champ : font-size en rem attendu").not.toBeNull();
    expect(Number(m?.[1]) * 16).toBeGreaterThanOrEqual(16);
  });
});
