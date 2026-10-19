// tests/pilotePostgres.test.ts — CE QUE LA PRODUCTION SAIT FAIRE, ET QUE LES TESTS NE DISENT PAS.
//
// ⚠️⚠️ POURQUOI CE FICHIER EXISTE, avec sa date. Le 21/09/2026, le remplacement d'une pièce
// (ADR 0006 §3, livré le matin même) a été vert sur 821 tests et a rendu **HTTP 500** au
// premier appel réel. DriveAI a suspendu son canal après UN document, et la campagne de
// lecture des 1 086 papiers est restée à l'arrêt — sans que rien nulle part ne dise pourquoi.
//
// La cause, mesurée DANS le pilote et non déduite :
//
//     node_modules/drizzle-orm/neon-http/session.js:152
//     throw new Error("No transactions support in neon-http driver");
//
// La production tourne sur `drizzle-orm/neon-http` (`lib/db/index.ts`). Les tests tournent sur
// **PGlite**, qui supporte les transactions interactives. Un `db.transaction(...)` est donc
// vert ici et impossible là-bas — exactement la classe des migrations multi-commandes du
// 16/09 : un test qui valide un contrat que la production n'a pas.
//
// ⚠️ AUCUN TEST D'EXÉCUTION NE PEUT ATTRAPER ÇA : il faudrait faire tourner la suite sur Neon.
// La garde est donc un SCAN DE SOURCE, et elle est honnête sur ce qu'elle est — elle défend le
// FAIT (« la production ne sait pas ouvrir de transaction »), pas une préférence de style.
//
// ⚠️ `db.batch([...])` EXISTE sur neon-http et donnerait la même atomicité — mais PGlite ne
// l'a pas, donc aucun test ne pourrait l'exercer. Si un jour la suite tourne sur Neon, cette
// garde se lève AVEC son remplaçant, jamais avant.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function fichiersTs(racine: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(racine)) {
    const chemin = resolve(racine, e);
    if (statSync(chemin).isDirectory()) out.push(...fichiersTs(chemin));
    else if (/\.tsx?$/.test(e)) out.push(chemin);
  }
  return out;
}

/** Le code, commentaires retirés : une garde qui lit sa propre explication ne prouve rien. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, " ");
}

describe("le pilote de production ne sait pas ouvrir de transaction", () => {
  const fichiers = [...fichiersTs(resolve(process.cwd(), "lib")), ...fichiersTs(resolve(process.cwd(), "app"))];

  it("le pilote est bien celui qu'on croit — sinon cette garde défend le vide", () => {
    // Anti-vacuité n° 1 : si la production changeait de pilote, l'interdit ci-dessous
    // deviendrait une préférence de style, et il faudrait le retirer plutôt que le subir.
    expect(readFileSync(resolve(process.cwd(), "lib/db/index.ts"), "utf8")).toContain("drizzle-orm/neon-http");
  });

  it("et il le dit lui-même, en toutes lettres", () => {
    // Anti-vacuité n° 2, et c'est la mesure qui fonde tout le reste : on LIT le refus dans le
    // pilote installé. Le jour où drizzle l'implémentera, ce cas tombera — et ce sera le
    // signal qu'on peut rouvrir les transactions, pas un test à re-baser.
    const session = readFileSync(
      resolve(process.cwd(), "node_modules/drizzle-orm/neon-http/session.js"),
      "utf8",
    );
    expect(session).toContain("No transactions support in neon-http driver");
  });

  it("aucun module ne fait donc `.transaction(` sur la base", () => {
    const coupables = fichiers.filter((f) => /\.transaction\(/.test(sansCommentaires(readFileSync(f, "utf8"))));
    expect(
      coupables.map((f) => f.replace(process.cwd(), "")),
      "la production lèverait « No transactions support in neon-http driver » : séquencer, dans un ordre dont chaque état intermédiaire est réparable",
    ).toEqual([]);
  });

  it("le remplacement SÉQUENCE, et dans le bon ordre", () => {
    // ⚠️ L'ORDRE est ce qui rend la séquence acceptable : l'ancienne cède l'empreinte AVANT
    // que la neuve la prenne. L'inverse est le seul ordre qui ne se rattrape pas — l'index
    // unique refuserait la neuve, et l'ancienne resterait la pièce vivante, donc jamais relue.
    const src = sansCommentaires(readFileSync(resolve(process.cwd(), "lib/pieces/depot.ts"), "utf8"));
    const corps = src.slice(src.indexOf("async remplacer("));
    const posUpdate = corps.indexOf(".update(schema.pieces)");
    const posInsert = corps.indexOf(".insert(schema.pieces)");
    expect(posUpdate, "l'ancienne ne cède plus son empreinte").toBeGreaterThan(-1);
    expect(posInsert, "la neuve n'est plus insérée").toBeGreaterThan(-1);
    expect(posUpdate).toBeLessThan(posInsert);
  });
});
