// tests/ecranLia.test.ts — l'écran de Lia (R2 de la refonte, MemoryAI#10).
//
// Ce qui est verrouillé n'est pas le dessin, c'est ce qu'un dessin peut casser sans qu'aucune autre
// garde ne rougisse : une suggestion qui enverrait seule un appel payant, un panneau « replié »
// qui reste ouvert parce qu'un `display` de classe bat l'attribut `hidden`, une pastille
// permanente qui dit « 0 à juger ».

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const client = readFileSync("app/chat/ChatClient.tsx", "utf8");
// La pastille vit dans la maison de LIA (l'accueil, MemoryAI#74) : la page lit, le client dessine.
const page = readFileSync("app/AccueilClient.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

/** Le corps d'une fonction déclarée `function nom(…) { … }` du client, jusqu'à l'accolade fermante. */
function corps(nom: string): string {
  const debut = client.indexOf(`function ${nom}(`);
  expect(debut, `${nom} introuvable`).toBeGreaterThan(-1);
  const ouvrante = client.indexOf("{", client.indexOf(")", debut));
  let profondeur = 0;
  for (let i = ouvrante; i < client.length; i++) {
    if (client[i] === "{") profondeur++;
    if (client[i] === "}" && --profondeur === 0) return client.slice(ouvrante, i + 1);
  }
  throw new Error(`${nom} : accolade fermante introuvable`);
}

describe("les suggestions préremplissent, elles n'envoient pas", () => {
  it("choisirSuggestion écrit dans le champ sans jamais appeler l'envoi ni le réseau", () => {
    const f = corps("choisirSuggestion");
    expect(f).toContain("setSaisie(");
    expect(f).not.toMatch(/envoyer|fetch\(/);
  });

  it("il y en a deux ou trois, et elles ne se montrent que champ vide, rien en cours", () => {
    const liste = /const SUGGESTIONS = \[([^\]]*)\]/.exec(client)?.[1] ?? "";
    const n = liste.split('",').filter((x) => x.trim()).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    expect(client).toMatch(/configure && !occupe && !saisie\.trim\(\)/);
  });
});

describe("le panneau d'options replié l'est vraiment", () => {
  it("fermé par défaut, relié à sa bascule, et `hidden` n'est pas battu par le display de la classe", () => {
    expect(client).toMatch(/useState\(false\);\s*\n/); // l'état d'ouverture
    expect(client).toContain("aria-expanded={optionsOuvertes}");
    expect(client).toContain('aria-controls="chat-options"');
    expect(client).toContain("hidden={!optionsOuvertes}");
    // ⚠️ Sans cette règle, `.chat-options-corps { display: grid }` bat `hidden` et le panneau est
    // toujours ouvert : c'est invisible dans le JSX, et visible seulement à l'écran.
    expect(css).toMatch(/\.chat-options-corps\[hidden\]\s*\{\s*display:\s*none/);
  });

  it("ouvrir une conversation ou en commencer une referme le panneau", () => {
    expect(corps("nouvelleConversation")).toContain("setOptionsOuvertes(false)");
    expect(corps("ouvrir")).toContain("setOptionsOuvertes(false)");
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

describe("la saisie et le mouvement", () => {
  it("le champ garde 16 px et `.champ` (iOS ne zoome pas), et le bouton d'envoi a un nom", () => {
    expect(client).toMatch(/<textarea[^>]*className="champ"/);
    expect(client).toContain('aria-label="Envoyer"');
    expect(css).toMatch(/\.chat-saisie textarea\s*\{[^}]*font-size:\s*1rem/);
  });

  it("l'arrivée de la réponse est un fondu, et prefers-reduced-motion l'éteint", () => {
    expect(css).toMatch(/\.chat-fil > \.bulle\.assistant:last-of-type \.bulle-texte\s*\{\s*animation:\s*arrivee-lia/);
    // Le bloc `prefers-reduced-motion` qui nomme la même règle doit mettre `animation: none`.
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.chat-fil > \.bulle\.assistant:last-of-type \.bulle-texte\s*\{\s*animation:\s*none/;
    expect(css, "aucun repli pour prefers-reduced-motion").toMatch(media);
  });
});
