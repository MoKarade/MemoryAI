// tests/sauvetageExtraire.test.ts — relire le clair dans les VRAIES pages, puis le prouver (ADR 0019).
//
// ⚠️ Les pages sont rendues par leur propre code (`app/fait/[id]/page`, `app/pieces/[id]/page`),
// pas par un HTML écrit à la main : une fixture recopiée validerait mes suppositions sur la
// page, pas la page. Les faits et papiers sont écrits par les vrais écrivains, sur une vraie
// Postgres (PGlite), sous une clé « ancienne » ; puis leurs scellés sont repassés en `v1`, comme
// ceux de la clé perdue le 23/10. L'ancien déploiement est simulé par les pages elles-mêmes,
// qui lisent sous l'ancienne clé.
//
// Données FICTIVES (dépôt public).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { renderToString } from "react-dom/server";
import * as schema from "@/lib/db/schema";
import { dechiffrer, deriverCle, estScelleAncien } from "@/lib/chiffrement";
import { depotDrizzle } from "@/lib/depotFaits";
import { ecrireLot } from "@/lib/ecrireFaits";
import { depotPiecesDrizzle } from "@/lib/pieces/depot";
import { ecrireLotPieces } from "@/lib/pieces/ecrire";
import { decoderHtml, extraireFait, extrairePiece, fileIdDuLien, pairesDl } from "@/lib/sauvetage/extraire";
import { entreesStructurees, reconstruireFait, reconstruirePiece, tailleJuste, type PieceAncienne } from "@/lib/sauvetage/reconstruire";
import type { Ecrivain } from "@/lib/jetons";

const ANCIENNE = deriverCle(Buffer.alloc(32, 7).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** Ce que l'ancien déploiement voit : ses scellés étaient lisibles, donc on lui rend leur version. */
function commeAvant<T>(x: T): T {
  if (typeof x === "string") return (x.startsWith("v1:") ? `v2:${x.slice(3)}` : x) as T;
  if (Array.isArray(x)) return x.map(commeAvant) as T;
  if (x instanceof Date || x === null || typeof x !== "object") return x;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, commeAvant(v)])) as T;
}

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, usePathname: () => "/", redirect: vi.fn() }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...reste }: { href: string; children?: unknown }) => ce("a", { href, ...reste }, children as never) };
});
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ email: "fictif@example.com" })) }));
vi.mock("@/components/Nav", () => ({ Nav: () => null }));
vi.mock("@/lib/pageDonnees", () => ({ accesDonnees: async () => ({ ok: true, db, cle: ANCIENNE }), MESSAGES_MANQUE: { base: "b", cle: "c" } }));
vi.mock("@/lib/depotAdmin", async (original) => {
  const m = await original<typeof import("@/lib/depotAdmin")>();
  return {
    ...m,
    depotAdminDrizzle: (d: Parameters<typeof m.depotAdminDrizzle>[0]) => {
      const r = m.depotAdminDrizzle(d);
      return { ...r, parId: async (id: string) => commeAvant(await r.parId(id)), autresDeLaMemeSource: async () => [] };
    },
  };
});
vi.mock("@/lib/pieces/depotLecture", async (original) => {
  const m = await original<typeof import("@/lib/pieces/depotLecture")>();
  return {
    ...m,
    depotPiecesLectureDrizzle: (d: Parameters<typeof m.depotPiecesLectureDrizzle>[0]) => {
      const r = m.depotPiecesLectureDrizzle(d);
      return { ...r, parId: async (id: string) => commeAvant(await r.parId(id)) };
    },
  };
});

const { default: FaitPage } = await import("@/app/fait/[id]/page");
const { default: PiecePage } = await import("@/app/pieces/[id]/page");

const pageFait = async (id: string) =>
  renderToString(await FaitPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const pagePiece = async (id: string) => renderToString(await PiecePage({ params: Promise.resolve({ id }) }));

/** Repasse en `v1` tout scellé `v2` : la clé qui les a écrits est désormais « perdue ». */
async function perdreLaCle() {
  const v1 = (t: string, c: string) =>
    db.execute(sql.raw(`UPDATE ${t} SET ${c} = 'v1:' || substr(${c}, 4) WHERE ${c} LIKE 'v2:%'`));
  for (const c of ["valeur", "attributs"]) await v1("faits", c);
  for (const c of ["type", "emetteur", "titulaire", "resume", "champs_structures", "champs_libres"]) await v1("pieces", c);
  await v1("piece_exemplaires", "chemin");
}

const ORIGINAUX = {
  employeur: "Entreprise « Exemple » & fils, l'atelier",
  adresse: "12, rue de l’Exemple",
  fileId: "1Doc-Exemple_abc",
};

const ids: Record<string, string> = {};

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });

  const provenance = (ref: string) => ({ source_type: "document", source_ref: ref, extracteur: "moteur-document-v1" });
  const faits = await ecrireLot(
    [
      { sujet: "marc", predicat: "emploi.employeur", valeur: ORIGINAUX.employeur, valeur_type: "texte",
        attributs: { type: "contrat", annee: "2024" }, provenance: provenance("ref-1") },
      { sujet: "marc", predicat: "logement.adresse", valeur: ORIGINAUX.adresse, valeur_type: "texte", provenance: provenance("ref-2") },
      { sujet: "marc", predicat: "document.existe", valeur: ORIGINAUX.fileId, valeur_type: "ref_document",
        attributs: { type: "bail", emetteur: "Gestion Exemple", annee: "2025" }, provenance: provenance("ref-3") },
    ],
    DRIVEAI,
    ANCIENNE,
    depotDrizzle(db),
  );
  expect(faits.refuses).toEqual([]);
  [ids.employeur, ids.adresse, ids.document] = faits.idsCrees as [string, string, string];

  const pieces = await ecrireLotPieces(
    [
      {
        type: "bail",
        emetteur: "Gestion Exemple & cie",
        titulaire: "Personne Fictive",
        titulaire_confiance: 0.8,
        annee: 2026,
        domaine: "03 · Logement & véhicule",
        resume: "Bail de 12 mois, loyer 900 $ « tout compris ».",
        champs_libres: { "téléphone du propriétaire": "418 555 0199", note: "clé n° 2" },
        champs_structures: {
          numeros: [
            { libelle: "n° de bail", valeur: "BX-2026-0042" },
            { libelle: "n° de dossier", valeur: "D-17" },
          ],
        },
        exemplaires: [
          { file_id: "f-bail-1", chemin: "/03 · Logement & véhicule/Bail" },
          { file_id: "f-bail-2", chemin: "/08 · Perso & projets/Copies/Bail" },
        ],
        extracteur: "haiku-4.5-piece-v1",
      },
      {
        type: "passeport",
        emetteur: "Pays Fictif",
        annee: 2025,
        domaine: "04 · Immigration",
        resume: "Passeport fictif.",
        champs_structures: { numeros: [{ libelle: "n° de passeport", valeur: "ZZ000000" }] },
        exemplaires: [{ file_id: "f-passeport", chemin: "/04 · Immigration/Passeport" }],
        extracteur: "haiku-4.5-piece-v1",
      },
    ],
    DRIVEAI,
    ANCIENNE,
    depotPiecesDrizzle(db),
  );
  expect(pieces.refusees).toEqual([]);
  [ids.bail, ids.passeport] = pieces.idsCrees as [string, string];

  await perdreLaCle();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pg?.close();
});

const ligneFait = async (id: string) => (await db.select().from(schema.faits).where(eq(schema.faits.id, id)))[0]!;

async function lignePiece(id: string): Promise<PieceAncienne & { niveau: number }> {
  const p = (await db.select().from(schema.pieces).where(eq(schema.pieces.id, id)))[0]!;
  const ex = await db.select().from(schema.pieceExemplaires).where(eq(schema.pieceExemplaires.pieceId, id));
  return { ...p, exemplaires: ex.map((x) => ({ fileId: x.fileId, chemin: x.chemin })) };
}

/** Le clair d'origine d'un scellé `v1`, sous l'ancienne clé : ce que le sauvetage doit retrouver. */
const original = (scelle: string, id: string, niveau: number) => dechiffrer(ANCIENNE, `v2:${scelle.slice(3)}`, id, niveau);

describe("les pages de l'ancien déploiement rendent le clair exact", () => {
  it("un fait : valeur et attributs, échappements compris", async () => {
    const l = await ligneFait(ids.employeur!);
    expect(estScelleAncien(l.valeur)).toBe(true);
    expect(estScelleAncien(l.attributs)).toBe(true);

    const r = reconstruireFait(l, extraireFait(await pageFait(l.id), l.id));
    expect(r).toEqual({
      ok: true,
      clairs: { valeur: ORIGINAUX.employeur, attributs: original(l.attributs!, `${l.id}#attributs`, l.niveau) },
    });
    // Le JSON refait est bien celui qui avait été scellé, au caractère près.
    expect(r.ok && JSON.parse(r.clairs.attributs!)).toEqual({ type: "contrat", annee: "2024" });
  });

  it("un fait N2 sans attributs : seule la valeur est à sauver", async () => {
    const l = await ligneFait(ids.adresse!);
    expect(l.niveau).toBe(2);
    expect(reconstruireFait(l, extraireFait(await pageFait(l.id), l.id))).toEqual({ ok: true, clairs: { valeur: ORIGINAUX.adresse } });
  });

  it("un ref_document : la valeur vient du bouton « Ouvrir le document », pas du champ Corriger", async () => {
    const l = await ligneFait(ids.document!);
    const html = await pageFait(l.id);
    expect(html).not.toContain('id="correction-valeur"');
    const r = reconstruireFait(l, extraireFait(html, l.id));
    expect(r.ok && r.clairs.valeur).toBe(ORIGINAUX.fileId);
    expect(r.ok && JSON.parse(r.clairs.attributs!)).toEqual({ type: "bail", emetteur: "Gestion Exemple", annee: "2025" });
  });

  it("un papier : facettes, titulaire sans sa certitude, résumé, champs, et le chemin de CHAQUE exemplaire", async () => {
    const l = await lignePiece(ids.bail!);
    const r = reconstruirePiece(l, extrairePiece(await pagePiece(l.id), l.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clairs.type).toBe("bail");
    expect(r.clairs.emetteur).toBe("Gestion Exemple & cie");
    expect(r.clairs.titulaire).toBe("Personne Fictive");
    expect(r.clairs.chemins).toEqual({
      "f-bail-1": "/03 · Logement & véhicule/Bail",
      "f-bail-2": "/08 · Perso & projets/Copies/Bail",
    });
    // Le résumé n'était `v1` que si le régime le chiffrait ; les champs le sont toujours.
    if (estScelleAncien(l.resume)) expect(r.clairs.resume).toBe("Bail de 12 mois, loyer 900 $ « tout compris ».");
    expect(r.clairs.champsStructures).toBe(original(l.champsStructures!, l.id, l.niveau));
    expect(r.clairs.champsLibres).toBe(original(l.champsLibres!, l.id, l.niveau));
  });

  it("un papier N3 que l'ancien environnement ne montre pas : échec « sommaire-n3 », rien n'est deviné", async () => {
    const l = await lignePiece(ids.passeport!);
    expect(l.niveau).toBe(3);
    const r = reconstruirePiece(l, extrairePiece(await pagePiece(l.id), l.id));
    expect(r.ok).toBe(false);
    expect(!r.ok && new Set(r.echecs.map((e) => e.raison))).toEqual(new Set(["sommaire-n3"]));
  });

  it("le même papier N3, quand l'ancien environnement l'ouvrait (MEMORYAI_N3_CHAT=1) : sauvé", async () => {
    vi.stubEnv("MEMORYAI_N3_CHAT", "1");
    try {
      const l = await lignePiece(ids.passeport!);
      const r = reconstruirePiece(l, extrairePiece(await pagePiece(l.id), l.id));
      expect(r.ok && r.clairs.resume).toBe("Passeport fictif.");
      expect(r.ok && r.clairs.chemins).toEqual({ "f-passeport": "/04 · Immigration/Passeport" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("la page d'un AUTRE fait, ou une page de connexion, n'est pas lue", async () => {
    const html = await pageFait(ids.employeur!);
    expect(extraireFait(html, ids.adresse!)).toBeNull();
    expect(extraireFait("<html><body>Connexion</body></html>", ids.employeur!)).toBeNull();
    expect(extrairePiece(await pagePiece(ids.bail!), ids.passeport!)).toBeNull();
    const l = await ligneFait(ids.employeur!);
    expect(reconstruireFait(l, null)).toEqual({
      ok: false,
      echecs: [
        { colonne: "valeur", raison: "page-absente" },
        { colonne: "attributs", raison: "page-absente" },
      ],
    });
  });
});

describe("la taille refuse ce qui n'est pas le bon clair", () => {
  it("un clair tronqué, ou un « — », ne passe pas ; la ligne entière reste en échec", async () => {
    const l = await ligneFait(ids.employeur!);
    const page = extraireFait(await pageFait(l.id), l.id)!;
    const r = reconstruireFait(l, { ...page, valeur: ORIGINAUX.employeur.slice(0, -1) });
    expect(r).toEqual({ ok: false, echecs: [{ colonne: "valeur", raison: "taille-differente" }] });
    expect(tailleJuste(l.valeur!, ORIGINAUX.employeur)).toBe(true);
    expect(tailleJuste(l.valeur!, "—")).toBe(false);
    expect(tailleJuste("pas-un-scelle", "x")).toBe(false);
  });

  it("une colonne absente de la page est un échec nommé, pas un clair vide", async () => {
    const l = await lignePiece(ids.bail!);
    const page = extrairePiece(await pagePiece(l.id), l.id)!;
    const r = reconstruirePiece(l, { ...page, type: null });
    expect(r).toEqual({ ok: false, echecs: [{ colonne: "type", raison: "absent-de-la-page" }] });
  });

  it("une ligne sans scellé v1 n'a besoin d'aucune page", () => {
    expect(reconstruireFait({ id: "x", valeurType: "texte", valeur: "clair", attributs: null }, null)).toEqual({ ok: true, clairs: {} });
    expect(
      reconstruirePiece(
        { id: "x", titulaireConfiance: null, type: "v2:a:b:c", emetteur: null, titulaire: null, resume: null, champsStructures: null, champsLibres: null, exemplaires: [] },
        null,
      ),
    ).toEqual({ ok: true, clairs: { chemins: {} } });
  });
});

describe("les briques de lecture", () => {
  it("défait l'échappement de React et les entités numériques, garde l'inconnu", () => {
    expect(decoderHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#39; &#233; &bidule;")).toBe(`a & b <c> "d" 'e' é &bidule;`);
    expect(decoderHtml("&#xZZ; &#99999999;")).toBe("&#xZZ; &#99999999;");
  });

  it("lit les paires dt/dd, séparateurs React retirés, et saute celles qui portent une balise", () => {
    expect(pairesDl("<dl><div><dt>a</dt><dd>x<!-- --> y</dd></div><div><dt>b</dt><dd><code>z</code></dd></div></dl>")).toEqual([["a", "x y"]]);
  });

  it("ne prend un fileId que d'un lien Drive bien formé", () => {
    expect(fileIdDuLien("https://drive.google.com/file/d/abc%2Fd/view")).toBe("abc/d");
    expect(fileIdDuLien("https://drive.google.com/file/d/%E0%A4%A/view")).toBeNull();
    expect(fileIdDuLien("https://exemple.test/file/d/abc/view")).toBeNull();
  });

  it("défait les champs structurés aplatis, refuse une autre forme", () => {
    expect(entreesStructurees("")).toEqual([]);
    expect(entreesStructurees("libelle : a · valeur : b · libelle : c · valeur : d")).toEqual([
      { libelle: "a", valeur: "b" },
      { libelle: "c", valeur: "d" },
    ]);
    expect(entreesStructurees("autre chose")).toBeNull();
    expect(entreesStructurees("libelle : sans valeur")).toBeNull();
  });
});
