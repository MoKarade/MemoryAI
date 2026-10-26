// tests/navSections.test.ts — [L26] la barre de navigation ne peut pas mener nulle part.
//
// Marc, le 17/09 : « il y a beaucoup trop d'onglets ». Le lot fait passer la barre de HUIT
// entrées à TROIS (Parler · Chercher · Régler). Ce que ce fichier défend n'est pas le NOMBRE
// — un ratchet sur un compte se périme au premier lot qui ajoute une section légitime — mais
// les deux faits qui rendent la réduction honnête :
//
//   1. chaque entrée mène à une page qui EXISTE (« un onglet qui ne mène nulle part est pire
//      qu'un onglet en moins » : il coûte un clic pour apprendre qu'il n'y a rien) ;
//   2. aucune page ne DISPARAÎT de la barre en silence — toute clé qu'une page passe à `Nav`
//      est routée vers une section réelle, et les seules qui ne le sont pas sont NOMMÉES ici.
//
// ⚠️ Ce que le compilateur fait déjà, et qu'on ne réécrit donc pas : `SECTION_DE` est un
// `Record<CleNav, …>`, donc `tsc` exige une entrée par clé et refuse une valeur qui ne soit
// pas une section ou `null`. Ce qu'il ne peut PAS voir, c'est qu'un `href` pointe vers un
// dossier qui n'a pas de `page.tsx`, ni qu'une clé mappée à `null` l'a été par oubli.
//
// ⚠️ Et le fait n'est pas ancré sur la FORME du fichier : on lit les `href` et les `null`
// réellement écrits, jamais une liste recopiée à la main — une liste recopiée devient fausse
// au premier renommage, sans rien de rouge (leçon FinanceAI `UNE-GARDE-ANCRE-LE-FAIT`).

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SOURCE_NAV = readFileSync("components/Nav.tsx", "utf8");

const fichiersApp = execSync("git ls-files --cached --others --exclude-standard app", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/**
 * Les clés délibérément HORS barre, avec leur raison. Une entrée ici est une décision ; son
 * absence est un oubli. ⚠️ Contrôle ANTI-FANTÔME plus bas : une exemption qui ne correspond
 * plus à rien doit rougir, sinon la liste survit à son objet.
 */
const ANCIENNE_PAGE =
  "page d'avant la maison de LIA : retirée du menu par Marc le 26/10 (tâche MemoryAI 320), elle reste ouverte par son adresse";

const HORS_BARRE: Record<string, string> = {
  fait: "une FICHE s'ouvre depuis n'importe où : elle n'est pas une section, donc elle n'allume rien",
  chercher: ANCIENNE_PAGE,
  pieces: ANCIENNE_PAGE,
  avancement: ANCIENNE_PAGE,
  depenses: ANCIENNE_PAGE,
  conversations: ANCIENNE_PAGE,
};

/** Les `href` réellement écrits dans `SECTIONS`. */
function hrefsDeclares(): string[] {
  const bloc = SOURCE_NAV.match(/const SECTIONS = \[([\s\S]*?)\] as const;/);
  expect(bloc, "bloc SECTIONS introuvable — la garde ne mesure plus rien").not.toBeNull();
  const corps = (bloc as RegExpMatchArray)[1] ?? "";
  return [...corps.matchAll(/href: "([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** Les clés que `SECTION_DE` route vers `null`, donc hors barre. */
function clesHorsBarre(): string[] {
  const bloc = SOURCE_NAV.match(/const SECTION_DE[\s\S]*?\{([\s\S]*?)\n\};/);
  expect(bloc, "table SECTION_DE introuvable — la garde ne mesure plus rien").not.toBeNull();
  const corps = (bloc as RegExpMatchArray)[1] ?? "";
  return [...corps.matchAll(/^\s*"?([a-z-]+)"?:\s*null,/gm)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** Les clés que les pages passent VRAIMENT à `Nav`. */
function clesUtilisees(): string[] {
  const vues = new Set<string>();
  for (const f of fichiersApp.filter((x) => /\.tsx$/.test(x))) {
    for (const m of readFileSync(f, "utf8").matchAll(/<Nav\s+active=\{?"([a-z-]+)"/g)) if (m[1]) vues.add(m[1]);
  }
  return [...vues].sort();
}

describe("navSections", () => {
  it("chaque entrée de la barre mène à une page qui existe", () => {
    const hrefs = hrefsDeclares();
    // Anti-vacuité : sans cette borne, un `SECTIONS` vidé par erreur rendrait le test VERT.
    expect(hrefs.length, "aucun href extrait : le motif ne reconnaît plus la table").toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      const attendu = href === "/" ? "app/page.tsx" : `app${href}/page.tsx`;
      expect(existsSync(attendu), `la barre pointe vers ${href}, mais ${attendu} n'existe pas`).toBe(true);
    }
  });

  it("aucune page ne disparaît de la barre en silence", () => {
    const utilisees = clesUtilisees();
    // Anti-vacuité : le motif doit VOIR les montages réels, sinon « rien à signaler » est vrai
    // d'un extracteur cassé (leçon FinanceAI sur les recenseurs ancrés sur la forme).
    expect(utilisees.length, "aucun montage de <Nav> trouvé : le motif est cassé").toBeGreaterThanOrEqual(8);

    const nulles = clesHorsBarre();
    for (const cle of nulles) {
      expect(
        Object.keys(HORS_BARRE),
        `la clé « ${cle} » est routée vers aucune section : nomme la raison dans HORS_BARRE, ou route-la`,
      ).toContain(cle);
    }
    // ANTI-FANTÔME : une exemption qui ne correspond plus à une clé `null` ment sur l'état du
    // code. Elle se retire, elle ne se garde pas « au cas où ».
    for (const cle of Object.keys(HORS_BARRE)) {
      expect(nulles, `exemption fantôme : « ${cle} » n'est plus hors barre`).toContain(cle);
    }
    // Et toute clé montée par une page qui n'est ni routée ni exemptée est un oubli : `tsc`
    // exige qu'elle soit DANS la table, pas qu'elle mène quelque part.
    for (const cle of utilisees) {
      if (cle in HORS_BARRE) continue;
      expect(nulles, `la page qui monte active="${cle}" n'allume aucune section`).not.toContain(cle);
    }
  });

  it("/chat est la conversation complète, et non plus un renvoi", () => {
    const s = readFileSync("app/chat/page.tsx", "utf8");
    // MemoryAI#74 : l'accueil devient la maison de LIA, la conversation revient à `/chat`.
    // ⚠️ Le fait défendu : la conversation est MONTÉE ici, et rien ne renvoie ailleurs — un
    // `redirect("/")` laissé là ferait tourner Marc en rond entre l'accueil et Parler.
    expect(s, "/chat ne monte pas ChatClient").toMatch(/<ChatClient\b/);
    expect(s).not.toMatch(/\bredirect\(/);
    expect(s).toMatch(/\brequireSession\(\)/);
  });

  it("l'accueil est la maison de LIA, pas un tableau de compteurs", () => {
    const s = readFileSync("app/page.tsx", "utf8");
    expect(s, "l'accueil ne monte pas la maison de LIA").toMatch(/<AccueilClient\b/);
    // Il REDIRIGEAIT vers /moi. Le fait défendu est qu'il ne le fait plus — sinon la barre
    // annonce « Lia » et sert des compteurs.
    expect(s, "l'accueil redirige encore au lieu de montrer LIA").not.toMatch(/\bredirect\(/);
  });
});
