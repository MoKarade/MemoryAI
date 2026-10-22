// tests/db.test.ts — le schéma, éprouvé sur une VRAIE Postgres (PGlite, en mémoire).
//
// Ce test applique le SQL de migration RÉELLEMENT COMMITTÉ, puis vérifie que les contraintes
// tiennent. Un mock validerait mes suppositions sur Postgres, pas Postgres. Et il lit
// `drizzle/` plutôt que de recréer les tables, pour échouer si la migration committée
// diverge du schéma TypeScript.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

let pg: PGlite;

function fichiersSql(): string[] {
  return readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function lireMigrations(): string[] {
  const dossier = resolve(process.cwd(), "drizzle");
  const fichiers = fichiersSql();
  expect(fichiers.length).toBeGreaterThan(0);
  return fichiers
    .flatMap((f) => readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("le journal des migrations", () => {
  // `lireMigrations` lit le DOSSIER ; en production, c'est le JOURNAL qui commande. Les
  // deux peuvent diverger dans le pire sens : suite verte, migration jamais jouée en ligne.
  it("décrit EXACTEMENT les fichiers SQL committés, dans l'ordre", () => {
    const fichiers = fichiersSql().map((f) => f.replace(/\.sql$/, ""));
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string; idx: number }[] };
    expect(journal.entries.map((e) => e.tag).sort()).toEqual([...fichiers].sort());
    const idx = journal.entries.map((e) => e.idx);
    expect(idx).toEqual(idx.map((_, i) => i));
  });
});

beforeAll(async () => {
  pg = new PGlite();
  for (const sql of lireMigrations()) await pg.exec(sql);
});

afterAll(async () => {
  await pg?.close();
});

const FAIT = {
  id: "f1",
  sujet: "marc",
  predicat: "emploi.employeur",
  valeur: "scellé",
  valeur_type: "texte",
  niveau: 1,
  fiabilite_source: "document-officiel",
  version_vocabulaire: 1,
  empreinte: "e1",
};

async function inserer(champs: Partial<typeof FAIT> & { id: string; empreinte: string }) {
  const f = { ...FAIT, ...champs };
  await pg.query(
    `INSERT INTO faits (id, sujet, predicat, valeur, valeur_type, niveau, fiabilite_source, version_vocabulaire, empreinte)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [f.id, f.sujet, f.predicat, f.valeur, f.valeur_type, f.niveau, f.fiabilite_source, f.version_vocabulaire, f.empreinte],
  );
}

// ⚠️ CE TEST A RAISON DE ROUGIR QUAND ON AJOUTE UNE TABLE, et il s'ÉTEND — il ne se re-base
// pas. Ce qu'il défend n'est pas un nombre mais le fait qu'aucune table n'apparaisse sans
// que quelqu'un l'ait voulue : une migration générée à l'aveugle, un `drizzle-kit` qui
// invente une table de jointure, un reliquat d'essai. Sept de l'ADR 0001, puis les dépenses
// du chat, les questions, les conversations et leurs messages (ADR 0002), les liens du
// graphe (ADR 0002 §5.3), puis les pièces et leurs exemplaires (ADR 0004 §6.2), puis le banc
// de la refonte LIA (MemoryAI#69).
describe("les vingt-deux tables", () => {
  it("existent, et pas une de plus", async () => {
    const r = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      "acces_journal",
      // [ADR 0009] L'avancement qu'une app publie : des COMPTES, une ligne par app (migration 0017).
      "avancement_sources",
      // [ADR 0012] Les avis de Marc sur la pile « vrai / faux », en ajout seul (migration 0018).
      "avis_pile",
      // [MemoryAI#69] Le banc de la refonte LIA : ses mesures (des nombres) et ses questions
      // (chiffrées) (migration 0023).
      "banc_mesures",
      "banc_questions",
      "conversations",
      "depenses_chat",
      "faits",
      // [L35] Les lectures tentées sans résultat (migration 0016, ADR 0007).
      "lectures_tentees",
      "liens",
      "messages",
      "oublis",
      "perimetres",
      "piece_exemplaires",
      "pieces",
      // [L34] Les plafonds de dépense, réglables depuis l'app (migration 0015).
      // ⚠️ L'ordre est celui du `ORDER BY 1` de la requête : « pieces » avant « plafonds ».
      "plafonds",
      "predicats_proposes",
      "predicats_refuses",
      "provenances",
      "questions",
      "sujets",
      // [L27] La voix de Lia, écrite par Marc dans Régler : UNE ligne, `id = 1` (migration 0022).
      "voix_lia",
    ]);
  });
});

/** Une pièce minimale. Le régime est passé explicitement : c'est lui que ces cas éprouvent. */
async function insererPiece(p: {
  id: string;
  niveau: number;
  resume_en_clair: boolean;
  recherche?: string | null;
  empreinte?: string;
}) {
  await pg.query(
    `INSERT INTO pieces (id, niveau, resume_en_clair, recherche, extracteur, empreinte)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [p.id, p.niveau, p.resume_en_clair, p.recherche ?? null, "test", p.empreinte ?? p.id],
  );
}

// ⚠️ Ces cas éprouvent le verrou que la BASE tient, pas celui du code. `lib/pieces/regime.ts`
// décide du régime ; si un chemin d'écriture l'oublie, c'est ici que ça doit s'arrêter.
describe("les contraintes de `pieces`", () => {
  it("accepte une pièce au régime CLAIR avec son texte de recherche", async () => {
    await expect(
      insererPiece({ id: "p-clair", niveau: 1, resume_en_clair: true, recherche: "bail logement 2026" }),
    ).resolves.toBeUndefined();
  });

  it("accepte une pièce au régime CHIFFRÉ sans texte de recherche", async () => {
    await expect(insererPiece({ id: "p-chiffre", niveau: 3, resume_en_clair: false })).resolves.toBeUndefined();
  });

  it("REFUSE un texte de recherche en clair sur une pièce au régime chiffré", async () => {
    // Le cas qui compte : c'est exactement ce qu'un oubli de `regimePiece` produirait, et
    // ce qui écrirait du niveau 3 en clair pour toujours — y compris dans les sauvegardes.
    await expect(
      insererPiece({ id: "p-fuite", niveau: 3, resume_en_clair: false, recherche: "numéro de passeport" }),
    ).rejects.toThrow(/pieces_chiffre_sans_recherche/);
  });

  it("refuse un niveau hors de 0-3", async () => {
    await expect(insererPiece({ id: "p-niv", niveau: 4, resume_en_clair: false })).rejects.toThrow(
      /pieces_niveau_0_3/,
    );
  });

  it("REFUSE un titulaire sans sa confiance — il serait cru sur parole", async () => {
    await insererPiece({ id: "p-tit", niveau: 0, resume_en_clair: true });
    await expect(
      pg.query(`UPDATE pieces SET titulaire = 'x' WHERE id = 'p-tit'`),
    ).rejects.toThrow(/pieces_titulaire_avec_confiance/);
  });

  it("accepte un titulaire accompagné de sa confiance", async () => {
    await insererPiece({ id: "p-tit2", niveau: 0, resume_en_clair: true });
    await expect(
      pg.query(`UPDATE pieces SET titulaire = 'x', titulaire_confiance = 0.8 WHERE id = 'p-tit2'`),
    ).resolves.toBeDefined();
  });

  it("accepte une confiance SEULE — un titulaire inconnu reste mesuré", async () => {
    // « Je ne sais pas, et je suis sûr de ne pas savoir » est une information : la contrainte
    // ne vaut que dans un sens.
    await insererPiece({ id: "p-tit3", niveau: 0, resume_en_clair: true });
    await expect(
      pg.query(`UPDATE pieces SET titulaire_confiance = 0.2 WHERE id = 'p-tit3'`),
    ).resolves.toBeDefined();
  });

  it("refuse une confiance hors de 0-1", async () => {
    await insererPiece({ id: "p-tit4", niveau: 0, resume_en_clair: true });
    await expect(
      pg.query(`UPDATE pieces SET titulaire = 'x', titulaire_confiance = 1.5 WHERE id = 'p-tit4'`),
    ).rejects.toThrow(/pieces_titulaire_confiance_0_1/);
  });

  it("refuse deux pièces de même empreinte", async () => {
    await insererPiece({ id: "p-e1", niveau: 0, resume_en_clair: true, empreinte: "meme" });
    await expect(
      insererPiece({ id: "p-e2", niveau: 0, resume_en_clair: true, empreinte: "meme" }),
    ).rejects.toThrow(/pieces_empreinte/);
  });

  it("un exemplaire disparaît avec sa pièce", async () => {
    await insererPiece({ id: "p-ex", niveau: 0, resume_en_clair: true });
    await pg.query(`INSERT INTO piece_exemplaires (piece_id, file_id, principal) VALUES ($1,$2,true)`, [
      "p-ex",
      "file-1",
    ]);
    await pg.query(`DELETE FROM pieces WHERE id = 'p-ex'`);
    const r = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM piece_exemplaires WHERE piece_id='p-ex'`);
    expect(r.rows[0]?.n).toBe("0");
  });

  it("le même fichier ne peut pas être deux fois le même exemplaire", async () => {
    await insererPiece({ id: "p-dup", niveau: 0, resume_en_clair: true });
    await pg.query(`INSERT INTO piece_exemplaires (piece_id, file_id) VALUES ($1,$2)`, ["p-dup", "f"]);
    await expect(
      pg.query(`INSERT INTO piece_exemplaires (piece_id, file_id) VALUES ($1,$2)`, ["p-dup", "f"]),
    ).rejects.toThrow(/piece_exemplaires_unicite/);
  });
});

// La recherche plein texte FRANÇAISE de l'ADR 0004 §7, éprouvée sur la vraie Postgres : un
// dictionnaire anglais ne rapprocherait pas « cotisations » de « cotisation ».
describe("la recherche plein texte française", () => {
  it("retrouve une pièce par un mot fléchi", async () => {
    await insererPiece({
      id: "p-fts",
      niveau: 1,
      resume_en_clair: true,
      recherche: "avis de cotisation revenus 2024",
    });
    const r = await pg.query<{ id: string }>(
      `SELECT id FROM pieces WHERE to_tsvector('french', coalesce(recherche,'')) @@ plainto_tsquery('french', $1)`,
      ["cotisations"],
    );
    expect(r.rows.map((x) => x.id)).toContain("p-fts");
  });

  it("ne retrouve PAS une pièce au régime chiffré — elle est hors de l'index par construction", async () => {
    await insererPiece({ id: "p-hors", niveau: 3, resume_en_clair: false });
    const r = await pg.query<{ id: string }>(
      `SELECT id FROM pieces WHERE to_tsvector('french', coalesce(recherche,'')) @@ plainto_tsquery('french', $1)`,
      ["passeport"],
    );
    expect(r.rows.map((x) => x.id)).not.toContain("p-hors");
  });
});

describe("les contraintes de `faits`", () => {
  it("accepte un fait N1 complet", async () => {
    await expect(inserer({ id: "ok1", empreinte: "ok1" })).resolves.toBeUndefined();
  });

  it("refuse un niveau hors de 0-3", async () => {
    // Sans valeur : sinon c'est la contrainte N3 qui refuse d'abord, et ce test ne
    // prouverait plus la borne haute.
    await expect(inserer({ id: "n4", empreinte: "n4", niveau: 4, valeur: null as unknown as string })).rejects.toThrow(
      /faits_niveau_0_3/,
    );
    await expect(inserer({ id: "nm", empreinte: "nm", niveau: -1 })).rejects.toThrow(/faits_niveau_0_3/);
  });

  // LA contrainte de l'ADR : un fait N3 n'a pas de TEXTE — existence, date, pointeur, rien
  // d'autre. La base elle-même le refuse, quoi que `validerFait` ait laissé passer.
  it("refuse un TEXTE sur un fait de niveau 3, accepte une date ou un pointeur", async () => {
    await expect(inserer({ id: "n3v", empreinte: "n3v", niveau: 3, valeur: "x" })).rejects.toThrow(
      /faits_n3_sans_texte/,
    );
    await expect(inserer({ id: "n3", empreinte: "n3", niveau: 3, valeur: null as unknown as string })).resolves.toBeUndefined();
    await expect(inserer({ id: "n3d", empreinte: "n3d", niveau: 3, valeur: "scellé", valeur_type: "date" })).resolves.toBeUndefined();
    await expect(inserer({ id: "n3r", empreinte: "n3r", niveau: 3, valeur: "scellé", valeur_type: "ref_document" })).resolves.toBeUndefined();
  });

  it("refuse deux faits de même empreinte (idempotence)", async () => {
    await inserer({ id: "d1", empreinte: "dup" });
    await expect(inserer({ id: "d2", empreinte: "dup" })).rejects.toThrow(/faits_empreinte/);
  });

  it("le statut vaut `propose` par défaut, le canari est faux", async () => {
    await inserer({ id: "def", empreinte: "def" });
    const r = await pg.query<{ statut: string; canari: boolean }>(`SELECT statut, canari FROM faits WHERE id='def'`);
    expect(r.rows[0]).toEqual({ statut: "propose", canari: false });
  });
});

describe("provenances", () => {
  it("suit son fait, et disparaît avec lui (cascade)", async () => {
    await inserer({ id: "p1", empreinte: "p1" });
    await pg.query(
      `INSERT INTO provenances (fait_id, source_type, source_ref, extracteur) VALUES ('p1','document','1AbC','moteur-inventaire-v1')`,
    );
    await pg.query(`DELETE FROM faits WHERE id='p1'`);
    const r = await pg.query(`SELECT 1 FROM provenances WHERE fait_id='p1'`);
    expect(r.rows).toHaveLength(0);
  });

  it("refuse une provenance sans fait", async () => {
    await expect(
      pg.query(`INSERT INTO provenances (fait_id, source_type, source_ref, extracteur) VALUES ('absent','document','x','y')`),
    ).rejects.toThrow(/provenances_fait_id_faits_id_fk/);
  });
});

describe("perimetres — les défauts sont FERMÉS", () => {
  it("une app créée sans rien dire n'a accès à rien", async () => {
    await pg.query(`INSERT INTO perimetres (app_id) VALUES ('appx')`);
    const r = await pg.query<{ domaines: string; niveau_max: number; role: string; domicile: boolean }>(
      `SELECT domaines, niveau_max, role, domicile FROM perimetres WHERE app_id='appx'`,
    );
    expect(r.rows[0]).toEqual({ domaines: "[]", niveau_max: 0, role: "lecture", domicile: false });
  });
});

describe("predicats_refuses", () => {
  it("un couple (predicat, appelant) est unique", async () => {
    await pg.query(`INSERT INTO predicats_refuses (predicat, appelant, version_vocabulaire) VALUES ('x.y','driveai',1)`);
    await expect(
      pg.query(`INSERT INTO predicats_refuses (predicat, appelant, version_vocabulaire) VALUES ('x.y','driveai',1)`),
    ).rejects.toThrow(/predicats_refuses_predicat_appelant_pk/);
  });
});
