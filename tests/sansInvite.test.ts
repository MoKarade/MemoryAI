// tests/sansInvite.test.ts — MemoryAI est une app SANS invité, jamais (ADR 0001 §3).
//
// Le gabarit livre deux étages d'accès : le propriétaire, puis `lib/accesHub.ts` qui
// interroge la liste des invités du hub. Ici le second étage est SUPPRIMÉ, pas seulement
// inutilisé — et ce test refuse sa réintroduction sous n'importe quelle forme : le fichier,
// un import, un fournisseur Google, ou un `signIn` qui rouvrirait une connexion locale.
//
// Pourquoi un test et pas une phrase de doc : une personne admise dans une autre app par
// le cookie partagé ne doit jamais tomber ici. Le jour où quelqu'un « remet accesHub pour
// aligner sur les autres apps », c'est ce fichier qui rougit, pas la production.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const racine = process.cwd();
const auth = readFileSync(`${racine}/auth.ts`, "utf8");

/** Les fichiers suivis par git PLUS les nouveaux non ignorés — ce qu'un `git add -A` emporterait. */
function fichiersSource(): string[] {
  const sortie = execSync("git ls-files --cached --others --exclude-standard", {
    cwd: racine,
    encoding: "utf8",
  });
  return sortie
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
    .filter((f) => !f.startsWith("node_modules/") && !f.startsWith(".next/"));
}

describe("MemoryAI n'a pas d'invités", () => {
  it("lib/accesHub.ts n'existe pas", () => {
    expect(existsSync(`${racine}/lib/accesHub.ts`)).toBe(false);
  });

  // Le motif vise un IMPORT ou un APPEL, jamais le mot : un commentaire qui explique
  // pourquoi accesHub a été retiré a le droit d'exister (leçon FinanceAI « scan qui matche
  // la prose » — le premier jet de ce test rougissait sur l'en-tête d'auth.ts).
  it("aucun fichier n'importe accesHub ni n'appelle aAccesHub", () => {
    const fautifs = fichiersSource().filter((f) => {
      if (f === "tests/sansInvite.test.ts") return false;
      const s = readFileSync(`${racine}/${f}`, "utf8");
      return /from\s+["'][^"']*accesHub["']/.test(s) || /\baAccesHub\s*\(/.test(s);
    });
    expect(fautifs).toEqual([]);
  });

  // Anti-vacuité du motif : il reconnaît bien la forme qu'il interdit.
  it("le motif reconnaîtrait un import réintroduit", () => {
    const motifImport = /from\s+["'][^"']*accesHub["']/;
    expect(motifImport.test('import { aAccesHub } from "@/lib/accesHub";')).toBe(true);
    expect(motifImport.test("// on a retiré lib/accesHub.ts")).toBe(false);
  });

  it("auth.ts n'a aucun fournisseur : la session vient du hub", () => {
    expect(auth).toMatch(/providers:\s*\[\s*\]/);
    expect(auth).not.toMatch(/next-auth\/providers/);
  });

  it("auth.ts n'a pas de callback signIn — aucune connexion ne se fait ici", () => {
    expect(auth).not.toMatch(/\bsignIn\s*\(/);
  });

  it("le callback jwt ne connaît que le propriétaire", () => {
    expect(auth).toMatch(/isAuthorizedEmail\(token\.email/);
  });

  // Anti-vacuité : le test lit bien des fichiers de ce dépôt, et pas une liste vide.
  it("le balayage couvre au moins auth.ts, middleware.ts et un test", () => {
    const fichiers = fichiersSource();
    expect(fichiers).toContain("auth.ts");
    expect(fichiers).toContain("middleware.ts");
    expect(fichiers.some((f) => f.startsWith("tests/"))).toBe(true);
  });
});
