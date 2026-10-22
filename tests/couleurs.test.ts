// tests/couleurs.test.ts — aucune couleur écrite en dur hors de `app/globals.css`.
//
// ⚠️ POURQUOI CETTE GARDE EXISTE MAINTENANT. Le lot 14 ajoute un DESSIN, et un dessin est
// l'endroit où une couleur en dur se glisse le plus naturellement (« juste ce trait-là »).
// Or une couleur figée est INVISIBLE à la relecture : elle est parfaitement lisible dans le
// thème pour lequel on l'a écrite, et fausse dans l'autre. BatchChef a livré 21 sites de fond
// blanc figé sous un texte clair en thème sombre — zéro test rouge, zéro erreur, et c'est
// Marc qui l'a vu sur son téléphone.
//
// La règle : les couleurs vivent dans `globals.css`, en variables, et le reste du dépôt les
// EMPRUNTE (`var(--accent)`, `currentColor`). Un thème qui change ne demande alors aucune
// relecture du code.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Le neuf compte autant que le versionné : une garde qui ne voit une faute qu'une fois
// commitée ne protège pas, elle constate (leçon JobAI, `piiGuard`).
const fichiers = execSync("git ls-files --cached --others --exclude-standard app components lib", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|css)$/.test(f));

/** `globals.css` DÉFINIT les couleurs : c'est le seul endroit où elles ont le droit d'exister. */
const SOURCE = "app/globals.css";

/**
 * Les exceptions, NOMMÉES une par une avec leur raison — jamais un dossier exclu.
 *
 * ⚠️ Exclure large est le réflexe facile, et il laisse un angle mort permanent que plus rien
 * ne signale (leçon JobAI : un garde qui s'exclut d'un dossier entier s'en exclut pour
 * toujours). Chacune de ces deux lignes dit pourquoi la couleur ne PEUT pas vivre dans
 * `globals.css` — et si la raison disparaît, l'exception doit disparaître avec.
 */
const EXCEPTIONS: Record<string, string> = {
  // Cette page est du HTML AUTONOME, servi hors de l'app Next : `globals.css` n'y est pas
  // chargé, donc aucune variable n'existe. C'est claude.ai qui l'affiche, pendant le flux
  // OAuth, avant qu'aucun jeton n'existe.
  "app/api/mcp/authorize/route.ts": "page de consentement autonome — aucune feuille de style de l'app",
  // Ce n'est pas un STYLE, c'est une DONNÉE : la couleur d'identité que MemoryAI publie au
  // hub, dans le contrat. Elle est lue par le hub pour peindre sa carte, pas par MemoryAI.
  "lib/hubSummary.ts": "couleur d'identité publiée au hub — un champ du contrat, pas un style",
  // ⚠️ Ces deux-là sont HORS DU CSS par construction, et c'est une leçon payée par JobAI :
  // `themeColor` et `background_color` sont lus par le SYSTÈME (barre d'état Android, écran
  // de démarrage de l'app installée), pas par une feuille de style. Une variable CSS n'y
  // arrive jamais — et une valeur claire oubliée là fait un flash blanc au lancement, que
  // personne ne voit parce que personne ne relit un manifeste.
  //
  // ⚠️ Leur SYNCHRONISATION avec `globals.css` n'est donc pas tenue par cette garde-ci mais
  // par le cas « la couleur de l'app installée suit le fond de l'app » ci-dessous : sans lui,
  // l'exception deviendrait une porte de sortie plutôt qu'une exception.
  "app/manifest.ts": "couleurs lues par le SYSTÈME (écran de démarrage) — hors CSS par construction",
  "app/layout.tsx": "themeColor : la barre système de l'app installée — hors CSS par construction",
};

const COULEUR = /(#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\()/;

describe("un token de couleur employé est un token DÉCLARÉ", () => {
  // [L33a] Ajouté après avoir écrit `var(--texte)` dans `globals.css` là où le token
  // s'appelle `--text`. Rien n'a crié : `tsc` ne lit pas le CSS, ESLint non plus, le build
  // passe, la page s'affiche — juste sans la couleur. C'est un **no-op silencieux**, la
  // pire des pannes, et la même classe que le `text-ink-600` hors palette que FinanceAI a
  // payée. Un token mal orthographié ne se voit qu'à l'œil, sur la page, par quelqu'un qui
  // sait de quelle couleur elle devrait être.
  const css = readFileSync(SOURCE, "utf8");
  /** Les tokens DÉCLARÉS (`--x: valeur`), tous blocs `:root` confondus. */
  const declares = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
  /** Les tokens EMPLOYÉS (`var(--x)`). */
  const employes = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);

  it("le scan voit des tokens des deux côtés — anti-vacuité", () => {
    // Sans ces bornes, une regex cassée rendrait deux ensembles VIDES et le cas suivant
    // serait vrai par vacuité : « aucun token inconnu » est aussi vrai d'un scan mort.
    expect(declares.size, "aucun token déclaré trouvé").toBeGreaterThanOrEqual(10);
    expect(employes.length, "aucun token employé trouvé").toBeGreaterThanOrEqual(20);
    expect(declares.has("--texte")).toBe(true);
  });

  it("aucun var(--x) ne désigne un token qui n'existe pas", () => {
    const inconnus = [...new Set(employes.filter((t) => !declares.has(t)))];
    expect(inconnus, `tokens employés mais jamais déclarés : ${inconnus.join(", ")}`).toEqual([]);
  });
});

describe("les couleurs vivent dans globals.css, et nulle part ailleurs", () => {
  it("aucun fichier de `app/`, `components/` ou `lib/` n'écrit une couleur", () => {
    const fautifs: string[] = [];
    for (const f of fichiers) {
      if (f === SOURCE || EXCEPTIONS[f]) continue;
      const source = readFileSync(f, "utf8");
      // On lit les lignes une par une pour NOMMER le site : « il y a une couleur quelque
      // part » n'aide personne à la retirer.
      source.split("\n").forEach((ligne, i) => {
        if (COULEUR.test(ligne)) fautifs.push(`${f}:${i + 1} ${ligne.trim().slice(0, 80)}`);
      });
    }
    expect(fautifs).toEqual([]);
  });

  it("la couleur de l'app INSTALLÉE suit le fond de l'app (les deux exceptions se tiennent)", () => {
    // ⚠️ Sans ce cas, `app/manifest.ts` et `app/layout.tsx` seraient deux valeurs libres que
    // rien ne rattache au thème : elles dériveraient au premier changement de fond, et ça ne
    // se verrait qu'en installant l'app. La garde dérive donc la valeur attendue de la
    // SOURCE, elle ne la recopie pas.
    const css = readFileSync(SOURCE, "utf8");
    const fond = /--bg-systeme:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]?.toLowerCase();
    expect(fond, "`--bg-systeme` doit exister dans globals.css").toBeTruthy();

    for (const nom of ["app/manifest.ts", "app/layout.tsx"] as const) {
      const couleurs = [...readFileSync(nom, "utf8").matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
      expect(couleurs.length, nom).toBeGreaterThan(0);
      for (const c of couleurs) {
        expect(c, `${nom} : « ${c} » ne suit pas le fond de l'app`).toBe(fond);
      }
    }
    // Sombre seul (Marc, 22/10/2026) : le manifeste et la barre système portent la MÊME
    // valeur, celle du fond. Une barre système à deux valeurs reviendrait à un thème clair
    // que l'app n'a plus.
    const m = readFileSync("app/manifest.ts", "utf8");
    expect(m).toContain(`background_color: "${fond}"`);
    expect(m).toContain(`theme_color: "${fond}"`);
    const l = readFileSync("app/layout.tsx", "utf8");
    expect(l).toContain(`themeColor: "${fond}"`);
    expect(l).not.toContain("prefers-color-scheme");
  });

  it("chaque exception EXISTE encore, et porte toujours une couleur", () => {
    // ⚠️ Une liste d'exceptions ne sait pas DÉCROÎTRE toute seule : une entrée dont le
    // fichier a disparu, ou qui n'a plus de couleur, resterait à affirmer un besoin éteint —
    // et la prochaine session la lirait comme une permission encore valable.
    for (const [f, raison] of Object.entries(EXCEPTIONS)) {
      expect(fichiers, `${f} (${raison}) n'existe plus`).toContain(f);
      expect(COULEUR.test(readFileSync(f, "utf8")), `${f} n'a plus de couleur : retire l'exception`).toBe(true);
    }
  });

  it("et ce scan VOIT une couleur quand il y en a une", () => {
    // Anti-vacuité : sans ce cas, un motif cassé rendrait « aucun fautif » pour toujours.
    // Les exemples sont assemblés à l'exécution — écrits en clair, ils feraient rougir la
    // garde sur son propre fichier (le piège classique : le scan lit son commentaire).
    const rouges = ["#" + "aabbcc", "okl" + "ch(50% 0 0)", "rg" + "ba(0,0,0,.5)", "hs" + "l(0 0% 0%)"];
    for (const r of rouges) expect(COULEUR.test(r), r).toBe(true);
    for (const vert of ["var(--accent)", "currentColor", "transparent", "none"]) {
      expect(COULEUR.test(vert), vert).toBe(false);
    }
  });

  it("le dessin du graphe emprunte ses couleurs, il n'en écrit aucune", () => {
    // Le cas qui a motivé la garde : un SVG est plein d'attributs `fill` et `stroke`.
    const svg = readFileSync("components/GrapheSvg.tsx", "utf8");
    expect(svg).toContain("var(--");
    expect(COULEUR.test(svg)).toBe(false);
  });
});
