// tests/widget.test.ts — le widget embarqué dans une app du hub (ADR 0002 §5.4, lot 12).
//
// Ce que ces cas défendent, dans l'ordre :
//   1. SANS périmètre, le widget ne montre RIEN — l'inverse du contrat d'écriture, et c'est
//      voulu : une iframe est embarquée par du CODE d'app, pas posée par Marc dans Vercel ;
//   2. il RESTREINT, il n'ouvre jamais : un fait non servable ne le devient pas ;
//   3. le domicile est un cas NOMMÉ : il ne sort que sur une case cochée ;
//   4. `/widget` est la SEULE route cadrable, et elle l'est par le hub SEUL ;
//   5. aucune écriture : pas de Server Action, pas de formulaire, pas de `postMessage`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { Perimetre } from "../lib/db/schema";
import type { FaitLisible } from "../lib/lecture";
import { filtrerPourWidget, politiqueDepuisPerimetre, raisonDuVide, RIEN } from "../lib/widget";
import { ENTETES_SECURITE, ENTETES_WIDGET } from "../next.config.mjs";

const perimetre = (p: Partial<Perimetre>): Perimetre =>
  ({
    appId: "jobai",
    domaines: JSON.stringify(["emploi"]),
    niveauMax: 1,
    role: "lecture",
    admetInvites: true,
    domicile: false,
    modifieLe: new Date(),
    ...p,
  }) as Perimetre;

const fait = (predicat: string, niveau: number): FaitLisible =>
  ({ id: `f-${predicat}`, predicat, valeur: "x", niveau, statut: "valide" }) as FaitLisible;

describe("politiqueDepuisPerimetre — le défaut sûr est le VIDE", () => {
  it("sans périmètre, RIEN : une iframe est embarquée par du code, pas décidée par Marc", () => {
    expect(politiqueDepuisPerimetre(null)).toEqual(RIEN);
    expect(filtrerPourWidget([fait("emploi.employeur", 1)], politiqueDepuisPerimetre(null))).toEqual([]);
  });

  it("une colonne de domaines illisible se rabat sur RIEN, jamais sur « tout »", () => {
    expect(politiqueDepuisPerimetre(perimetre({ domaines: "{ceci n'est pas du JSON" }))).toEqual(RIEN);
    expect(politiqueDepuisPerimetre(perimetre({ domaines: '"emploi"' })), "un JSON qui n'est pas un tableau").toEqual(RIEN);
  });

  it("borne le niveau à 2 : le N3 n'a aucun contenu, et une ligne ancienne pourrait le porter", () => {
    expect(politiqueDepuisPerimetre(perimetre({ niveauMax: 3 })).niveauMax).toBe(2);
    expect(politiqueDepuisPerimetre(perimetre({ niveauMax: -1 })).niveauMax).toBe(0);
  });

  it("le domicile exige le NIVEAU aussi — la garde est ici ET dans /apps", () => {
    expect(politiqueDepuisPerimetre(perimetre({ domicile: true, niveauMax: 1 })).domicile).toBe(false);
    expect(politiqueDepuisPerimetre(perimetre({ domicile: true, niveauMax: 2 })).domicile).toBe(true);
  });
});

describe("filtrerPourWidget — il RESTREINT, il n'ouvre rien", () => {
  const faits = [
    fait("emploi.employeur", 1),
    fait("vehicule.bail.fin", 1),
    fait("sante.allergie", 2),
    fait("logement.adresse.ville", 2),
  ];

  it("ne rend que les domaines accordés", () => {
    const p = politiqueDepuisPerimetre(perimetre({ domaines: JSON.stringify(["emploi"]) }));
    expect(filtrerPourWidget(faits, p).map((f) => f.predicat)).toEqual(["emploi.employeur"]);
  });

  it("coupe au niveau maximal", () => {
    const p = politiqueDepuisPerimetre(perimetre({ domaines: JSON.stringify(["emploi", "sante"]), niveauMax: 1 }));
    expect(filtrerPourWidget(faits, p).map((f) => f.predicat)).toEqual(["emploi.employeur"]);
  });

  it("le domicile ne sort QUE sur la case cochée, même quand domaine et niveau le permettraient", () => {
    const sans = politiqueDepuisPerimetre(perimetre({ domaines: JSON.stringify(["logement"]), niveauMax: 2, domicile: false }));
    expect(filtrerPourWidget(faits, sans)).toEqual([]);
    const avec = politiqueDepuisPerimetre(perimetre({ domaines: JSON.stringify(["logement"]), niveauMax: 2, domicile: true }));
    expect(filtrerPourWidget(faits, avec).map((f) => f.predicat)).toEqual(["logement.adresse.ville"]);
  });
});

describe("raisonDuVide — un écran vide dit POURQUOI", () => {
  it("distingue « aucun domaine accordé » de « rien dans ce périmètre »", () => {
    expect(raisonDuVide(RIEN, 0)).toMatch(/aucun domaine/i);
    const p = politiqueDepuisPerimetre(perimetre({}));
    expect(raisonDuVide(p, 0)).toMatch(/périmètre/i);
    expect(raisonDuVide(p, 3), "quand il y a quelque chose à montrer, rien à dire").toBeNull();
  });
});

describe("les en-têtes : /widget est la SEULE route cadrable", () => {
  const csp = (entetes: { key: string; value: string }[]) =>
    entetes.find((e) => e.key === "Content-Security-Policy")!.value;

  it("partout ailleurs, le cadre est interdit", () => {
    expect(csp(ENTETES_SECURITE)).toContain("frame-ancestors 'none'");
    expect(ENTETES_SECURITE.some((e) => e.key === "X-Frame-Options" && e.value === "DENY")).toBe(true);
  });

  it("sur /widget, seuls le hub et ses sous-domaines cadrent", () => {
    const v = csp(ENTETES_WIDGET);
    expect(v).toContain("frame-ancestors 'self' https://hubperso.com https://*.hubperso.com");
    expect(v).not.toContain("frame-ancestors 'none'");
    // ⚠️ Rien d'autre ne bouge : la CSP du widget est la même, moins cette directive.
    expect(v.replace(/frame-ancestors[^;]+/, "X")).toBe(csp(ENTETES_SECURITE).replace(/frame-ancestors[^;]+/, "X"));
  });

  it("X-Frame-Options est RETIRÉ de /widget — `ALLOW-FROM` est mort, `DENY` bloquerait tout", () => {
    expect(ENTETES_WIDGET.some((e) => e.key === "X-Frame-Options")).toBe(false);
    // Les autres protections restent : retirer le cadrage ne retire pas le reste.
    for (const clef of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(ENTETES_WIDGET.some((e) => e.key === clef), clef).toBe(true);
    }
  });

  it("la règle /widget vient AVANT la règle générale — sinon elle n'est jamais appliquée", () => {
    const src = readFileSync("next.config.mjs", "utf8");
    const iWidget = src.indexOf('source: "/widget"');
    const iTout = src.indexOf('source: "/:path*"');
    expect(iWidget, "anti-vacuité : la règle du widget existe").toBeGreaterThan(-1);
    expect(iWidget).toBeLessThan(iTout);
  });
});

describe("le widget n'écrit RIEN", () => {
  const src = readFileSync("app/widget/page.tsx", "utf8");

  it("aucune Server Action, aucun formulaire, aucun appel à postMessage", () => {
    // ⚠️ CE CAS A D'ABORD ROUGI SUR SON PROPRE SUJET : l'en-tête de la page EXPLIQUE qu'elle
    // ne fait pas de `postMessage`, et un scan du mot matche l'explication autant que la
    // chose expliquée. On ancre donc sur la forme d'un USAGE — l'appel avec sa parenthèse,
    // l'import depuis un module d'actions — jamais sur la mention.
    expect(src, "anti-vacuité : on lit bien la page").toMatch(/filtrerPourWidget/);
    expect(/<form/.test(src), "un formulaire dans une iframe hôte est une porte sans clé").toBe(false);
    expect(/\.postMessage\s*\(/.test(src)).toBe(false);
    expect(/"use server"/.test(src)).toBe(false);
    expect(/from\s+["'][^"']*actions["']/.test(src), "aucune Server Action importée").toBe(false);
  });

  it("ne touche pas à la base quand le périmètre est vide — inutile de déchiffrer pour jeter", () => {
    // Ce court-circuit-ci n'est PAS redondant, contrairement à celui de `filtrerPourWidget` :
    // il évite de LIRE et de DÉCHIFFRER des faits qu'on rejetterait ensuite. Un widget non
    // réglé ne doit toucher à la base qu'au strict minimum.
    expect(src).toMatch(/politique\.domaines\.length === 0\s*\n?\s*\?\s*\[\]/);
  });

  it("aucun dossier d'actions à côté de la page", () => {
    const fichiers = execSync("git ls-files --cached --others --exclude-standard app/widget", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(fichiers).toEqual(["app/widget/page.tsx"]);
  });
});
