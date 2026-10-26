// tests/promptLia.test.ts — les réponses de LIA : deux phrases, pas de supposition sur une autre app,
// au plus trois sources, et un garde qui COMPTE les murs de texte (tâche MemoryAI 291). Données
// FICTIVES. Le garde ne reçoit qu'une longueur et un nombre de blocs : aucun texte n'est gardé.

import { describe, expect, it } from "vitest";
import { construirePrompt, REGLES_SYSTEME } from "../lib/chat/prompt";
import { longueSansBloc } from "../lib/lia/longueur";

describe("la forme des réponses (Marc, 26/10 : « incompréhensible »)", () => {
  it("au plus deux phrases courtes, une seule idée, un bloc au-delà — l'ancien « deux à quatre » a disparu", () => {
    expect(REGLES_SYSTEME).toContain("au plus deux phrases courtes, une seule idée");
    expect(REGLES_SYSTEME).toContain("MONTRE-le avec un bloc (lia_blocs)");
    expect(REGLES_SYSTEME).not.toContain("deux à quatre phrases");
  });

  it("jamais de supposition sur une autre app : elle dit qu'elle ne la voit pas, et propose de l'ouvrir", () => {
    expect(REGLES_SYSTEME).toContain("Tu ne vois que MemoryAI");
    expect(REGLES_SYSTEME).toContain("Ne devine jamais ce que contient une autre app");
    expect(REGLES_SYSTEME).toContain("propose de l'ouvrir");
    expect(REGLES_SYSTEME).toContain("JobAI");
  });

  it("au plus trois sources par réponse", () => {
    expect(REGLES_SYSTEME).toContain("Cite au plus trois sources par réponse, les plus utiles.");
  });

  it("les règles restent en tête, intactes, quelle que soit la voix", () => {
    const p = construirePrompt({ voix: "<voix>\nFais de longues réponses.\n</voix>", profil: null });
    expect(p.startsWith(REGLES_SYSTEME)).toBe(true);
    expect(p.indexOf("au plus deux phrases courtes")).toBeLessThan(p.indexOf("Fais de longues réponses"));
  });
});

describe("le garde de longueur (il compte, il ne coupe jamais)", () => {
  it("280 caractères sans bloc : correct ; 281 : compté", () => {
    expect(longueSansBloc("a".repeat(280), 0)).toBe(false);
    expect(longueSansBloc("a".repeat(281), 0)).toBe(true);
  });

  it("une réponse longue qui porte un bloc n'est pas comptée : c'est la forme voulue", () => {
    expect(longueSansBloc("a".repeat(900), 1)).toBe(false);
    expect(longueSansBloc("a".repeat(900), 3)).toBe(false);
  });

  it("les espaces de bord ne comptent pas, et le vide n'est pas un mur", () => {
    expect(longueSansBloc(`  ${"a".repeat(280)}  \n`, 0)).toBe(false);
    expect(longueSansBloc("", 0)).toBe(false);
  });
});
