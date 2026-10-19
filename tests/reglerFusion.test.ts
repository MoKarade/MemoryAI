// tests/reglerFusion.test.ts — [L26b] fusionner une page, sans rien emporter.
//
// Marc, le 17/09 : « beaucoup trop d'onglets », « très épuré ». L26a a regroupé la NAVIGATION ;
// ce lot commence à fusionner le CONTENU, en commençant par État (`/moi` → Régler).
//
// La leçon du dépôt dit qu'« une épuration se juge sur ce qu'elle ne doit pas emporter ». Ce
// fichier la prend au mot, dans les DEUX sens :
//
//   1. chaque fait que `/moi` affichait est encore affiché QUELQUE PART ;
//   2. aucun ne l'est DEUX fois — la fusion a révélé trois doublons que la séparation cachait.
//
// Et le troisième cas garde ce que la fusion a CASSÉ en chemin : dix Server Actions
// invalidaient `/moi` parce que les compteurs y vivaient. Les déplacer n'a pas déplacé les dix
// listes — mesuré : 10 sites sur `/moi`, zéro sur `/regler`.
//
// ⚠️ Les assertions de PRÉSENCE s'ancrent sur un APPEL (`nom(`), jamais sur le nom nu : ces
// fichiers parlent d'eux-mêmes en commentaire, et un scan qui matche la prose certifie ce que
// personne n'a écrit (leçon `SCAN-QUI-MATCHE-LA-PROSE`, payée plusieurs fois ici).

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REGLER = "app/regler/page.tsx";
const MOI = "app/moi/page.tsx";

const fichiers = execSync("git ls-files --cached --others --exclude-standard app", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/**
 * Ce que `/moi` affichait, et qui le porte MAINTENANT.
 *
 * ⚠️ Écrit comme une table de FAITS, pas de fichiers : « les dépenses du jour » est ce que Marc
 * cherche ; `depenseDuJourParPoste(` est seulement l'expression qui le produit. Une table de
 * fichiers se périmerait au prochain déplacement sans rien dire.
 */
const FAITS_DE_MOI: { fait: string; appel: string; surface: string }[] = [
  // ⚠⚠ ANCRE QUALIFIÉE, et c'est un CORRECTIF prouvé par mutation (revue du 18/09) :
  // `/regler` appelle DEUX `.comptes()` à trois lignes d'écart — celui des faits et celui
  // des papiers. Sur `"comptes()"` nu, retirer la lecture des FAITS laissait ce test VERT,
  // satisfait par celle des papiers : le fait vedette de la page (« N fait(s) validé(s) »,
  // affiché deux fois) n'avait AUCUNE garde.
  { fait: "le nombre de faits validés", appel: "depotLectureDrizzle(acces.db).comptes()", surface: REGLER },
  { fait: "la répartition par domaine", appel: "comptesParDomaine(", surface: REGLER },
  { fait: "les dépenses du jour, par poste", appel: "depenseDuJourParPoste(", surface: REGLER },
  { fait: "la dépense totale depuis le début", appel: "depenseTotaleUsd(", surface: REGLER },
  { fait: "la taille du vocabulaire", appel: "vocabulaire()", surface: REGLER },
  // ⚠️ La purge est le SEUL fait qui n'a pas déménagé, et c'est une décision : le ticket
  // demande « purge plus difficile ». La mettre dans un dépli du hub la rendrait plus facile.
  // ⚠⚠ Ancré sur `action={…}` et non sur le nom nu : `app/moi/page.tsx` cite `purgerAction`
  // dans un COMMENTAIRE, donc le nom seul était satisfait par la PROSE — retirer l'import et
  // l'attribut laissait ce test vert, prouvé par mutation. C'est exactement le piège que
  // l'en-tête de ce fichier dit vouloir éviter, commis trois lignes plus bas.
  { fait: "la purge totale", appel: "action={purgerAction}", surface: MOI },
];

/**
 * Les trois faits que `/moi` affichait ET que Régler portait déjà ailleurs. Ils ne doivent pas
 * être recopiés dans État : chaque fait a UNE place.
 */
const DOUBLONS_A_NE_PAS_RECOPIER = [
  { fait: "le compte « à valider »", motif: /parStatut\.propose/g, maxDansRegler: 1 },
  { fait: "l'état du niveau 2", motif: /n2Autorise\(/g, maxDansRegler: 1 },
  { fait: "l'état du connecteur MCP", motif: /lireEnvMcp\(/g, maxDansRegler: 1 },
];

describe("la fusion n'a rien emporté", () => {
  it("le scan voit les deux pages — anti-vacuité", () => {
    // Sans cette borne, un chemin devenu faux rendrait tous les cas suivants vrais par vacuité.
    expect(fichiers).toContain(REGLER);
    expect(fichiers).toContain(MOI);
    expect(FAITS_DE_MOI.length).toBeGreaterThanOrEqual(6);
  });

  it("chaque fait que /moi affichait est encore produit quelque part", () => {
    for (const { fait, appel, surface } of FAITS_DE_MOI) {
      const src = readFileSync(surface, "utf8");
      expect(src.includes(appel), `« ${fait} » a disparu : ${appel} n'est plus dans ${surface}`).toBe(true);
    }
  });

  it("⚠⚠ chaque ancre est UNIQUE dans sa surface — sinon elle garde le mauvais site", () => {
    // ⚠⚠ CE CAS EST LE VRAI CORRECTIF. La revue du 18/09 a trouvé DEUX ancres trop larges
    // sur six, chacune prouvée par mutation : `"comptes()"` était satisfait par la lecture
    // des PAPIERS quand celle des FAITS disparaissait, et `"purgerAction"` par un
    // COMMENTAIRE quand le formulaire perdait son action. Les corriger toutes les deux ne
    // ferme pas la CLASSE : la prochaine ancre écrite au jugé aura le même défaut.
    //
    // Ce qui la ferme est l'UNICITÉ : une ancre qui désigne deux sites ne peut pas dire
    // lequel a disparu. Mesuré après correction — les six sont à exactement une occurrence.
    for (const { fait, appel, surface } of FAITS_DE_MOI) {
      const src = readFileSync(surface, "utf8");
      const n = src.split(appel).length - 1;
      expect(
        n,
        `l'ancre de « ${fait} » (${appel}) apparaît ${n} fois dans ${surface} : elle ne peut pas dire lequel a disparu`,
      ).toBe(1);
    }
  });

  it("/moi ne porte PLUS les compteurs — sinon la fusion a dupliqué au lieu de déplacer", () => {
    // ⚠️ Le sens qu'on oublie. « Rien n'est perdu » est satisfait par une COPIE, et une copie
    // divergera. Ce cas dit que le déplacement a bien eu lieu.
    const src = readFileSync(MOI, "utf8");
    for (const { fait, appel, surface } of FAITS_DE_MOI) {
      if (surface === MOI) continue;
      expect(src.includes(appel), `« ${fait} » est resté dans ${MOI} : c'est une copie, pas un déplacement`).toBe(false);
    }
  });

  it("aucun fait n'est affiché deux fois dans Régler", () => {
    const src = readFileSync(REGLER, "utf8");
    for (const { fait, motif, maxDansRegler } of DOUBLONS_A_NE_PAS_RECOPIER) {
      const n = (src.match(motif) ?? []).length;
      expect(n, `« ${fait} » apparaît ${n} fois dans ${REGLER} : la fusion l'a recopié`).toBeLessThanOrEqual(
        maxDansRegler,
      );
    }
  });
});

describe("l'invalidation a suivi le contenu", () => {
  const actions = fichiers.filter((f) => /\/actions\.ts$/.test(f));

  it("le scan trouve bien des Server Actions — anti-vacuité", () => {
    expect(actions.length, "aucun actions.ts : le motif est cassé").toBeGreaterThanOrEqual(5);
  });

  it("⚠️ plus aucune Server Action n'invalide /moi pour ses compteurs", () => {
    // ⚠️ RIEN N'AURAIT ROUGI SANS CE CAS. Ces pages sont `force-dynamic`, donc le serveur les
    // re-rend à chaque requête ; le défaut ne se voyait qu'en navigation CÔTÉ CLIENT, où Next
    // sert le payload RSC gardé en cache. Marc valide un fait, revient sur Régler par la
    // barre, et lit un compteur d'avant son geste.
    //
    // ⚠️ La portée est `**/actions.ts` et pas tout `app/` DÉLIBÉRÉMENT : `rafraichirCompteurs.ts`
    // cite cet appel dans son propre commentaire pour raconter d'où il vient, et un scan plus
    // large rougirait sur de la PROSE. La règle porte sur les Server Actions, donc le scan
    // aussi.
    //
    // ⚠️ Cette assertion sait MOURIR : si un lot futur redonne des compteurs à `/moi`, elle
    // devient fausse et doit être RETIRÉE, pas contournée par une exemption.
    for (const f of actions) {
      expect(
        readFileSync(f, "utf8").includes('revalidatePath("/moi")'),
        `${f} invalide encore /moi : les compteurs sont dans /regler depuis L26b`,
      ).toBe(false);
    }
  });

  it("et une Server Action qui change un compte passe par la source unique", () => {
    // Le compte est une BORNE INFÉRIEURE, pas une valeur figée : un lot qui ajoute une action
    // mutante doit pouvoir l'appeler sans re-baser ce test. Ce qui est interdit est de
    // DESCENDRE — c'est-à-dire de recommencer à écrire les chemins à la main.
    const appelants = actions.filter((f) => readFileSync(f, "utf8").includes("rafraichirCompteurs()"));
    expect(appelants.length, "personne n'appelle la source unique : elle est morte").toBeGreaterThanOrEqual(7);
    // Et la source unique doit VRAIMENT invalider, sinon elle est décorative.
    expect(readFileSync("app/rafraichirCompteurs.ts", "utf8")).toMatch(/revalidatePath\(/);
  });

  it("⚠⚠ la liste des surfaces d'agrégat est DÉRIVÉE du code, pas écrite au jugé", async () => {
    // ⚠⚠ CE CAS EXISTE PARCE QUE LE PRÉCÉDENT NE SUFFISAIT PAS. Il n'assertait que `"/regler"` :
    // j'ai ajouté `"/"` à la liste, et la perturbation qui le RETIRAIT est restée MUETTE. Une
    // garde qui épingle UNE entrée d'une liste ne dit rien des autres — et c'est une liste
    // écrite à la main qui venait justement de pourrir (10 sites sur `/moi`, zéro sur
    // `/regler`). L'épingler une entrée à la fois reproduirait le défaut un cran plus bas.
    //
    // Le FAIT défendu : **toute page qui affiche un compteur agrégé est dans la liste**. Il se
    // dérive — une page affiche un agrégat si elle appelle un de ses lecteurs. Mesuré le
    // 18/09 : SIX pages, contre deux dans la liste. Les quatre manquantes ne sont invalidées
    // que par leurs propres actions, alors qu'un compte de faits bouge aussi quand on retire
    // un papier, et un compte de liens quand on oublie un fait.
    // [L3] `restantParGenre(` : la pile « vrai / faux » affiche ce qui reste à juger, un agrégat
    // qui bouge quand un fait est validé ailleurs ou qu'un papier est retiré. La page a cessé
    // d'appeler `comptes()` en devenant une pile — sans ce motif, elle sortirait de la liste
    // dérivée et la garde réclamerait de retirer `/questions`, c'est-à-dire l'inverse du fait.
    const LECTEURS_D_AGREGAT = /\.comptes\(\)|\.mesure\(\)|comptesParDomaine\(|depenseTotaleUsd\(|depenseDuJourParPoste\(|restantParGenre\(/;
    const pages = fichiers.filter((f) => /\/page\.tsx$/.test(f));
    const mesurees = pages
      .filter((f) => LECTEURS_D_AGREGAT.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(/^app/, "").replace(/\/page\.tsx$/, "") || "/");

    // Anti-vacuité : sans cette borne, un motif cassé rendrait l'ensemble VIDE et l'égalité
    // ci-dessous serait vraie contre une liste vide — « aucune surface oubliée » est aussi
    // vrai d'un scan mort.
    expect(mesurees.length, "aucune page à agrégat trouvée : le motif est cassé").toBeGreaterThanOrEqual(5);
    expect(mesurees, "le scan ne voit même pas Régler").toContain("/regler");

    const { SURFACES_COMPTEURS } = await import("../app/rafraichirCompteurs");
    // Les DEUX sens. Rien d'oublié : une page à compteur hors liste garde un chiffre périmé en
    // navigation client. Rien de fantôme : une entrée qui ne désigne plus une page à compteur
    // ment sur l'état du code et coûte une invalidation pour rien.
    expect([...SURFACES_COMPTEURS].sort()).toEqual([...mesurees].sort());
  });
});
