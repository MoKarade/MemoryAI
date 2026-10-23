// lib/sauvetage/depot.ts — ce que le sauvetage lit et écrit en base (ADR 0019 §2, migration 0024).
//
// ── UNE LIGNE SAUVÉE = UNE INSTRUCTION ───────────────────────────────────────────────────
// neon-http n'a pas de transaction interactive, et PGlite (les tests) n'a pas `batch`. Une
// requête SQL UNIQUE, elle, est atomique partout : la mise à jour, l'archive et le ménage des
// échecs sont donc des CTE d'une même instruction. L'archive n'est écrite QUE si la mise à jour
// a touché la ligne (`FROM maj`), et la mise à jour ne touche la ligne QUE si elle n'a pas bougé
// depuis la lecture (empreinte ET scellés identiques) : un écrivain concurrent fait échouer le
// sauvetage de cette ligne, jamais l'inverse.
//
// ── CE QUI EST À SAUVER ──────────────────────────────────────────────────────────────────
// Toute ligne vivante qui n'a pas encore d'archive — pas seulement celles qui portent un `v1` :
// une ligne N0 n'a aucun scellé, mais son empreinte est un HMAC de la clé perdue. Les papiers
// remplacés ou retirés n'ont plus de page : ils restent tels quels, comptés à part.

import { and, asc, count, eq, gt, isNull, notExists, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { RaisonEchec } from "./reconstruire";
import type { FaitARescueller, PatchFait, PatchPiece, PieceARescueller } from "./resceller";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export type TableSauvee = "faits" | "pieces";

export interface BilanSauvetage {
  /** `null` : la base n'avait rien à sauver (aucune ligne d'état). */
  ouvertLe: Date | null;
  closLe: Date | null;
  faits: { aSauver: number; sauves: number };
  pieces: { aSauver: number; sauves: number; horsSauvetage: number };
  /** Par raison, toutes tables confondues — des codes, jamais des valeurs. */
  echecs: Partial<Record<RaisonEchec | string, number>>;
  /** Les oublis gardés, que la nouvelle clé ne reconnaît plus (ADR 0019 §4). */
  oublisAveugles: number;
}

export interface DepotSauvetage {
  /** Vrai tant que le sauvetage est ouvert et pas clos : les écritures des apps répondent 503. */
  ecrituresFermees(): Promise<boolean>;
  faitsASauver(apres: string, limite: number): Promise<FaitARescueller[]>;
  piecesASauver(apres: string, limite: number): Promise<PieceARescueller[]>;
  /** `false` si la ligne a bougé depuis sa lecture : rien n'est écrit. */
  sauverFait(f: FaitARescueller, patch: PatchFait): Promise<boolean>;
  sauverPiece(p: PieceARescueller, patch: PatchPiece): Promise<boolean>;
  noterEchec(table: TableSauvee, id: string, raisons: readonly string[]): Promise<void>;
  bilan(): Promise<BilanSauvetage>;
  /** Clôt le sauvetage (geste de Marc, étape 6). `false` s'il était déjà clos ou jamais ouvert. */
  clore(): Promise<boolean>;
}

const nombre = (r: { n: number }[]) => Number(r[0]?.n ?? 0);

/** Les lignes d'un `execute`, quel que soit le pilote (neon-http et PGlite les rangent sous `rows`). */
function lignes(resultat: unknown): unknown[] {
  const rows = (resultat as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

export function depotSauvetageDrizzle(db: Base): DepotSauvetage {
  const archivee = (table: TableSauvee, id: typeof schema.faits.id | typeof schema.pieces.id) =>
    notExists(
      db
        .select({ x: sql`1` })
        .from(schema.chiffreV1Archive)
        .where(and(eq(schema.chiffreV1Archive.tableNom, table), eq(schema.chiffreV1Archive.ligneId, id))),
    );
  const pieceVivante = () => [isNull(schema.pieces.supprimeLe), eq(schema.pieces.statut, "active")];

  return {
    async ecrituresFermees() {
      const r = await db.select({ clos: schema.sauvetageEtat.closLe }).from(schema.sauvetageEtat).limit(1);
      return r.length > 0 && r[0]!.clos === null;
    },

    async faitsASauver(apres, limite) {
      const rows = await db
        .select({ f: schema.faits })
        .from(schema.faits)
        .where(and(gt(schema.faits.id, apres), isNull(schema.faits.supprimeLe), archivee("faits", schema.faits.id)))
        .orderBy(asc(schema.faits.id))
        .limit(limite);
      if (rows.length === 0) return [];
      // La PREMIÈRE provenance de chaque fait : celle qu'`ecrireLot` a écrite avec lui, et donc
      // celle de son empreinte. Les suivantes sont des confirmations venues après.
      const provs = await db
        .select({ faitId: schema.provenances.faitId, sourceRef: schema.provenances.sourceRef, extracteur: schema.provenances.extracteur })
        .from(schema.provenances)
        .where(sql`${schema.provenances.faitId} in ${rows.map((r) => r.f.id)}`)
        .orderBy(asc(schema.provenances.id));
      const premiere = new Map<string, { sourceRef: string; extracteur: string }>();
      for (const p of provs) if (!premiere.has(p.faitId)) premiere.set(p.faitId, { sourceRef: p.sourceRef, extracteur: p.extracteur });
      return rows.map(({ f }) => ({
        id: f.id,
        sujet: f.sujet,
        predicat: f.predicat,
        niveau: f.niveau,
        valeurType: f.valeurType,
        valeur: f.valeur,
        attributs: f.attributs,
        empreinte: f.empreinte,
        provenance: premiere.get(f.id) ?? null,
      }));
    },

    async piecesASauver(apres, limite) {
      const rows = await db
        .select()
        .from(schema.pieces)
        .where(and(gt(schema.pieces.id, apres), ...pieceVivante(), archivee("pieces", schema.pieces.id)))
        .orderBy(asc(schema.pieces.id))
        .limit(limite);
      if (rows.length === 0) return [];
      const ex = await db
        .select()
        .from(schema.pieceExemplaires)
        .where(sql`${schema.pieceExemplaires.pieceId} in ${rows.map((r) => r.id)}`)
        .orderBy(asc(schema.pieceExemplaires.fileId));
      return rows.map((p) => ({
        id: p.id,
        sujet: p.sujet,
        niveau: p.niveau,
        resumeEnClair: p.resumeEnClair,
        empreinte: p.empreinte,
        titulaireConfiance: p.titulaireConfiance,
        type: p.type,
        emetteur: p.emetteur,
        titulaire: p.titulaire,
        typeCle: p.typeCle,
        emetteurCle: p.emetteurCle,
        titulaireCle: p.titulaireCle,
        resume: p.resume,
        champsStructures: p.champsStructures,
        champsLibres: p.champsLibres,
        // L'ordre de la page (`rendreLisiblePiece`) : principal d'abord, puis par fileId.
        exemplaires: ex
          .filter((x) => x.pieceId === p.id)
          .sort((a, b) => Number(b.principal) - Number(a.principal))
          .map((x) => ({ fileId: x.fileId, chemin: x.chemin, principal: x.principal })),
      }));
    },

    async sauverFait(f, patch) {
      const r = await db.execute(sql`
        with maj as (
          update faits set valeur = ${patch.valeur}, attributs = ${patch.attributs}, empreinte = ${patch.empreinte}
          where id = ${f.id} and empreinte = ${f.empreinte}
            and valeur is not distinct from ${f.valeur} and attributs is not distinct from ${f.attributs}
          returning id
        ),
        menage as (
          delete from sauvetage_echecs where table_nom = 'faits' and ligne_id in (select id from maj)
        )
        insert into chiffre_v1_archive (table_nom, ligne_id, ancien)
        select 'faits', id, ${JSON.stringify(patch.ancien)} from maj
        on conflict do nothing
        returning ligne_id`);
      return lignes(r).length === 1;
    },

    async sauverPiece(p, patch) {
      const chemins = Object.entries(patch.chemins);
      // Les chemins des exemplaires, dans la même instruction : une CTE de plus, seulement s'il y
      // en a. `piece_id in (select id from maj)` les lie au succès de la mise à jour du papier.
      const majChemins =
        chemins.length === 0
          ? sql``
          : sql`, chemins as (
              update piece_exemplaires e set chemin = v.chemin
              from (values ${sql.join(
                chemins.map(([fileId, chemin]) => sql`(${fileId}, ${chemin})`),
                sql`, `,
              )}) as v(file_id, chemin)
              where e.piece_id in (select id from maj) and e.file_id = v.file_id
              returning 1
            )`;
      const r = await db.execute(sql`
        with maj as (
          update pieces set
            type = ${patch.type}, emetteur = ${patch.emetteur}, titulaire = ${patch.titulaire},
            type_cle = ${patch.typeCle}, emetteur_cle = ${patch.emetteurCle}, titulaire_cle = ${patch.titulaireCle},
            resume = ${patch.resume}, champs_structures = ${patch.champsStructures}, champs_libres = ${patch.champsLibres},
            empreinte = ${patch.empreinte}
          where id = ${p.id} and empreinte = ${p.empreinte}
            and type is not distinct from ${p.type} and emetteur is not distinct from ${p.emetteur}
            and titulaire is not distinct from ${p.titulaire} and resume is not distinct from ${p.resume}
            and champs_structures is not distinct from ${p.champsStructures}
            and champs_libres is not distinct from ${p.champsLibres}
          returning id
        )${majChemins},
        menage as (
          delete from sauvetage_echecs where table_nom = 'pieces' and ligne_id in (select id from maj)
        )
        insert into chiffre_v1_archive (table_nom, ligne_id, ancien)
        select 'pieces', id, ${JSON.stringify(patch.ancien)} from maj
        on conflict do nothing
        returning ligne_id`);
      return lignes(r).length === 1;
    },

    async noterEchec(table, id, raisons) {
      await db
        .insert(schema.sauvetageEchecs)
        .values({ tableNom: table, ligneId: id, raisons: [...new Set(raisons)].sort().join(",") })
        .onConflictDoUpdate({
          target: [schema.sauvetageEchecs.tableNom, schema.sauvetageEchecs.ligneId],
          set: {
            raisons: [...new Set(raisons)].sort().join(","),
            essais: sql`${schema.sauvetageEchecs.essais} + 1`,
            majLe: sql`now()`,
          },
        });
    },

    async bilan() {
      const etat = (await db.select().from(schema.sauvetageEtat).limit(1))[0];
      const parTable = async (table: TableSauvee) =>
        nombre(
          await db
            .select({ n: count() })
            .from(schema.chiffreV1Archive)
            .where(eq(schema.chiffreV1Archive.tableNom, table)),
        );
      const faitsRestants = nombre(
        await db
          .select({ n: count() })
          .from(schema.faits)
          .where(and(isNull(schema.faits.supprimeLe), archivee("faits", schema.faits.id))),
      );
      const piecesRestantes = nombre(
        await db
          .select({ n: count() })
          .from(schema.pieces)
          .where(and(...pieceVivante(), archivee("pieces", schema.pieces.id))),
      );
      const horsSauvetage = nombre(
        await db
          .select({ n: count() })
          .from(schema.pieces)
          .where(sql`not (${schema.pieces.supprimeLe} is null and ${schema.pieces.statut} = 'active')`),
      );
      const echecs: Record<string, number> = {};
      for (const e of await db.select({ raisons: schema.sauvetageEchecs.raisons }).from(schema.sauvetageEchecs)) {
        for (const r of e.raisons.split(",")) echecs[r] = (echecs[r] ?? 0) + 1;
      }
      return {
        ouvertLe: etat?.ouvertLe ?? null,
        closLe: etat?.closLe ?? null,
        faits: { aSauver: faitsRestants, sauves: await parTable("faits") },
        pieces: { aSauver: piecesRestantes, sauves: await parTable("pieces"), horsSauvetage },
        echecs,
        oublisAveugles: nombre(await db.select({ n: count() }).from(schema.oublis)),
      };
    },

    async clore() {
      const r = await db
        .update(schema.sauvetageEtat)
        .set({ closLe: sql`now()` })
        .where(and(eq(schema.sauvetageEtat.id, 1), isNull(schema.sauvetageEtat.closLe)))
        .returning({ id: schema.sauvetageEtat.id });
      return r.length === 1;
    },
  };
}
