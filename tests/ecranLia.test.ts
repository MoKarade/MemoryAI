// tests/ecranLia.test.ts — l'écran de Lia (R2 de la refonte, MemoryAI#10).
//
// Ce qui est verrouillé n'est pas le dessin, c'est ce qu'un dessin peut casser sans qu'aucune autre
// garde ne rougisse : une suggestion qui enverrait seule un appel payant, un panneau « replié »
// qui reste ouvert parce qu'un `display` de classe bat l'attribut `hidden`, une pastille
// permanente qui dit « 0 à juger ».

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const client = readFileSync("app/chat/ChatAtelier.tsx", "utf8");
// La pastille vit dans la maison de LIA (l'accueil, MemoryAI#74) : la page lit, le client dessine.
const page = readFileSync("app/AccueilClient.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("/chat est LIA en atelier, sans autre interface de chat", () => {
  it("la page monte LIA en atelier avec historique et réglages, et la bulle n'est pas doublée", () => {
    expect(client).toContain("atelier={{");
    expect(client).toContain("historique: {");
    expect(client).toContain("options,");
    expect(readFileSync("components/LiaMaison.tsx", "utf8")).toContain('chemin === "/chat"');
  });

  it("rien n'est envoyé sans que Marc ait posé la question : la saisie initiale est seulement affichée", () => {
    expect(client).toContain("AFFICHÉE, jamais envoyée");
    expect(client).not.toMatch(/saisieInitiale[^;\n]*poser\(/);
  });
});

describe("l'accueil ne dit plus jamais « N à juger » (Marc ne juge plus rien, tâche MemoryAI 231)", () => {
  it("ni pastille, ni lien vers la pile, ni sa règle CSS", () => {
    expect(page).not.toContain("pastille-juger");
    expect(page).not.toContain("aJuger");
    expect(page).not.toContain('href="/questions"');
    expect(css).not.toContain(".pastille-juger");
  });

  it("l'ancien bandeau replié au-dessus de la conversation a disparu", () => {
    expect(page).not.toContain("repli-accueil");
    expect(css).not.toContain(".repli-accueil");
  });
});

describe("le mouvement", () => {
  it("l'arrivée de la réponse est un fondu, et prefers-reduced-motion l'éteint", () => {
    expect(css).toMatch(/\.chat-fil > \.bulle\.assistant:last-of-type \.bulle-texte\s*\{\s*animation:\s*arrivee-lia/);
    // Le bloc `prefers-reduced-motion` qui nomme la même règle doit mettre `animation: none`.
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.chat-fil > \.bulle\.assistant:last-of-type \.bulle-texte\s*\{\s*animation:\s*none/;
    expect(css, "aucun repli pour prefers-reduced-motion").toMatch(media);
  });
});
