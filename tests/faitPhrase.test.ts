// tests/faitPhrase.test.ts — [L33a] comment un fait se LIT.
//
// Marc, le 18/09 : « va falloir full retravailler comment ça affiche les faits et ce qu'on en
// fait ». Ce fichier garde la moitié PURE du lot : le titre, la phrase, et la référence de
// source. Le module ne rend aucun JSX, donc chaque décision se perturbe sans monter React —
// et c'est la raison d'être de sa séparation, pas un effet de bord.
//
// Ce qui est défendu, dans l'ordre d'importance :
//   1. un papier ne s'affiche JAMAIS comme un fileId (le cas majoritaire : ~2 729 faits) ;
//   2. on ne fabrique JAMAIS un lien Drive à partir d'une référence qui n'en promet pas un ;
//   3. le libellé vient du VOCABULAIRE, jamais d'une table de phrases à part ;
//   4. un prédicat sans description est DIT comme tel, pas déguisé en phrase.

import { describe, it, expect } from "vitest";
import { autreExtremite, LIBELLES_LIEN, libelleDuFait, sourceDuFait, titreDuFait } from "../lib/faitPhrase";
import { TYPES_LIEN } from "../lib/db/schema";
import type { FaitLisible } from "../lib/lecture";

/** Un fait ordinaire. Chaque cas ne surcharge QUE ce qu'il mesure. */
const BASE: FaitLisible = {
  id: "11111111-1111-1111-1111-111111111111",
  predicat: "logement.bail.fin",
  domaine: "logement",
  description: "Fin du bail",
  valeur: "2028-06-30",
  valeurType: "date",
  lien: null,
  attributs: null,
  niveau: 1,
  statut: "valide",
  fiabiliteSource: "document-officiel",
  confiance: 0.9,
  valideDe: null,
  valideA: null,
  creeLe: "2026-09-18T00:00:00.000Z",
  provenance: { sourceType: "document", sourceRef: "drive|abc123", extracteur: "moteur-document-v1", dateSource: "2026-09-01" },
};
const f = (p: Partial<FaitLisible> = {}): FaitLisible => ({ ...BASE, ...p });

describe("titreDuFait", () => {
  it("un papier porte son TYPE en titre, jamais son fileId", () => {
    // ⚠️ Le cas qui a motivé le lot, et le cas MAJORITAIRE de cette mémoire : la valeur d'un
    // `ref_document` est un fileId Drive opaque, mesuré sur les données réelles de Marc
    // (`1x_FICTIFexemple000000000000000zz`), et son libellé humain vit dans `attributs.type`.
    const fileId = "1x_FICTIFexemple000000000000000zz";
    const t = titreDuFait(
      f({
        valeurType: "ref_document",
        valeur: fileId,
        attributs: { type: "Passeport", emetteur: "République Exemple", annee: "2020" },
      }),
    );
    expect(t.titre).toBe("Passeport");
    // L'assertion qui compte : le fileId ne doit apparaître NULLE PART dans ce qui s'affiche.
    expect(`${t.titre} ${t.sousTitre ?? ""}`).not.toContain(fileId);
    expect(t.sousTitre).toBe("République Exemple · 2020");
  });

  it("un papier sans type dit « Document », et n'invente pas de sous-titre", () => {
    // « Document » est un repli HONNÊTE : il dit « on ne sait pas de quel type », là où le
    // fileId prétendait être un titre. Et `null` plutôt qu'une chaîne vide : un sous-titre
    // absent ne doit pas rendre un `<p>` vide à l'écran.
    const t = titreDuFait(f({ valeurType: "ref_document", valeur: "xyz", attributs: null }));
    expect(t.titre).toBe("Document");
    expect(t.sousTitre).toBeNull();
  });

  it("un papier partiellement qualifié ne montre que ce qu'il porte", () => {
    const t = titreDuFait(f({ valeurType: "ref_document", valeur: "xyz", attributs: { type: "Bail", annee: "2026" } }));
    expect(t.sousTitre).toBe("2026");
  });

  it("un fait ordinaire garde sa valeur, et une date se déclare comme telle", () => {
    // `estDate` existe pour que le rendu enveloppe la valeur dans un `<time dateTime=…>` :
    // une date lisible par une machine est une propriété de la DONNÉE, pas du composant.
    expect(titreDuFait(f())).toEqual({ titre: "2028-06-30", sousTitre: null, estDate: true });
    expect(titreDuFait(f({ valeurType: "texte", valeur: "Marque" })).estDate).toBe(false);
  });
});

describe("libelleDuFait", () => {
  it("prend la description du VOCABULAIRE, pas une table à part", () => {
    const l = libelleDuFait(f());
    expect(l.libelle).toBe("Fin du bail");
    expect(l.estDuVocabulaire).toBe(true);
  });

  it("un prédicat sans description est DIT hors vocabulaire, pas déguisé en phrase", () => {
    // Le cas réel : un prédicat en QUARANTAINE existe par construction. Fabriquer une phrase
    // depuis son nom (`sante.allergie` → « Ton allergie ») marcherait sur les exemples et
    // mentirait sur le reste — un nom de prédicat n'est pas une phrase.
    const l = libelleDuFait(f({ description: "   ", predicat: "truc.inconnu" }));
    expect(l.libelle).toBe("truc.inconnu");
    expect(l.estDuVocabulaire).toBe(false);
  });
});

describe("sourceDuFait", () => {
  it("une référence PRÉFIXÉE `drive|` donne un lien, et l'identifiant nu", () => {
    const s = sourceDuFait("drive|abc123");
    expect(s).not.toBeNull();
    expect(s?.genre).toBe("drive");
    expect(s?.ref).toBe("abc123");
    expect(s?.lien).toBe("https://drive.google.com/file/d/abc123/view");
  });

  it("une référence NUE ne fabrique AUCUN lien", () => {
    // ⚠️ L'assertion la plus importante du fichier. Les valeurs réelles de `source_ref` sont
    // de deux formes — préfixée (`drive|…`) et nue (les fixtures de la migration de
    // l'inventaire portent un fileId sans préfixe). Composer une URL Drive à partir d'une
    // référence nue rendrait un lien CRÉDIBLE qui tombe en 404, et un lien faux est pire
    // qu'un identifiant honnête : personne ne re-vérifie un lien qui a l'air juste.
    const s = sourceDuFait("1AbC-sans-prefixe");
    expect(s?.genre).toBe("inconnu");
    expect(s?.lien).toBeNull();
    expect(s?.ref).toBe("1AbC-sans-prefixe");
  });

  it("une conversation est reconnue, et n'a pas de lien non plus", () => {
    const s = sourceDuFait("conv|7f3a");
    expect(s?.genre).toBe("conversation");
    expect(s?.ref).toBe("7f3a");
    expect(s?.lien).toBeNull();
  });

  it("un préfixe inconnu, un préfixe vide ou une référence vide ne mentent pas", () => {
    // `|abc` : pas de préfixe AVANT la barre — ce n'est pas une référence préfixée, donc on
    // ne devine pas lequel c'était. `drive|` : un préfixe qui ne désigne rien.
    expect(sourceDuFait("|abc")?.genre).toBe("inconnu");
    expect(sourceDuFait("drive|")?.lien).toBeNull();
    expect(sourceDuFait("mail|x")?.lien).toBeNull();
    expect(sourceDuFait("")).toBeNull();
    expect(sourceDuFait(null)).toBeNull();
    expect(sourceDuFait(undefined)).toBeNull();
  });

  it("un fileId à caractères spéciaux est ÉCHAPPÉ dans l'URL", () => {
    // Une référence vient d'un champ libre au contrat (`z.string().max(256)`) : elle n'est pas
    // garantie sûre dans une URL. Sans échappement, un `?` ou un `#` tronquerait le lien.
    expect(sourceDuFait("drive|a b#c")?.lien).toBe("https://drive.google.com/file/d/a%20b%23c/view");
  });
});

describe("autreExtremite", () => {
  const L = (faitA: string, faitB: string, cibleB = "fait") => ({ faitA, faitB, cibleB });

  it("depuis A, l'autre bout est B", () => {
    expect(autreExtremite(L("moi", "lui"), "moi")).toEqual({ autre: "lui", estUnFait: true });
  });

  it("depuis B, l'autre bout est A — et c'est TOUJOURS un fait", () => {
    // `liens.fait_a` porte une clé étrangère vers `faits` : ce bout ne peut pas être autre
    // chose. C'est le schéma qui le garantit, pas une convention.
    expect(autreExtremite(L("lui", "moi"), "moi")).toEqual({ autre: "lui", estUnFait: true });
    expect(autreExtremite(L("lui", "moi", "question"), "moi").estUnFait).toBe(true);
  });

  it("⚠️ depuis A, une cible « question » n'est PAS un fait", () => {
    // L'assertion qui évite un 404 : `fait_b` n'a aucune clé étrangère, donc quand
    // `cible_b = 'question'` cet identifiant ne désigne aucun fait. Mutation qui doit faire
    // rougir : rendre `estUnFait` toujours vrai.
    expect(autreExtremite(L("moi", "q1", "question"), "moi")).toEqual({ autre: "q1", estUnFait: false });
  });
});

describe("LIBELLES_LIEN", () => {
  it("chaque type de lien a son libellé humain, et aucun n'en a un de trop", () => {
    // ⚠️ Le `Record` exhaustif fait déjà crier `tsc` sur un type MANQUANT. Ce que le
    // compilateur ne voit pas : une entrée qui SURVIT à la suppression de son type. Les deux
    // sens, donc — sinon la table garde des libellés pour des règles qui n'existent plus.
    expect(Object.keys(LIBELLES_LIEN).sort()).toEqual([...TYPES_LIEN].sort());
    expect(LIBELLES_LIEN["lie-par-lia"]).toContain("deviné");
    // Et aucun libellé ne doit être le nom machine : c'est tout l'objet du lot.
    for (const [type, libelle] of Object.entries(LIBELLES_LIEN)) {
      expect(libelle, `${type} affiche son nom machine`).not.toBe(type);
      expect(libelle).not.toMatch(/[-_]/);
    }
  });
});
