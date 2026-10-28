// lib/depotLiens.ts — l'accès à la base pour le graphe (ADR 0002 §5.3). Le calcul, lui, est
// PUR et vit dans `lib/graphe.ts` : ce module lit, déchiffre, appelle, écrit.
//
// ⚠️ LE RECALCUL REMPLACE, IL N'AJOUTE PAS. Les liens `origine: "regle"` sont supprimés puis
// réécrits : c'est ce qui fait qu'un fait oublié, une date corrigée ou une règle affinée ne
// laissent AUCUN lien périmé derrière eux. Un graphe qui accumulerait dirait, six mois plus
// tard, des rapports qui n'existent plus — et rien ne le signalerait.
//
// ⚠️ LES LIENS D'UN MODÈLE NE SONT JAMAIS TOUCHÉS par ce recalcul (`origine: "modele"`,
// phase suivante) : une règle ne supprime pas ce qu'un modèle a proposé, et l'inverse non
// plus. Les deux vivent dans la même table et se distinguent par une colonne, parce qu'un
// graphe qui mélange ce qui est établi et ce qui est deviné n'apprend rien à personne.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { dechiffrer, type Cle } from "./chiffrement";
import * as schema from "./db/schema";
import type { Lien } from "./db/schema";
import { calculerLiens, type Abstention, type FaitPourGraphe, type LienCalcule, type QuestionPourGraphe } from "./graphe";
import type { Plongeur } from "./plongement";
import { liensDeSens, texteAPlonger } from "./sensProche";
import type { Attributs } from "./validerFait";
import { definition } from "./vocabulaire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

/** Ce que le recalcul a fait, en clair — jamais un simple « ok ». */
export interface Recalcul {
  faitsLus: number;
  /** Comptés et ÉCARTÉS, jamais rendus vides : même règle que `rendreServables`. */
  illisibles: number;
  liensEcrits: number;
  abstentions: Abstention[];
}

export interface DepotLiens {
  /**
   * Ce que les règles diraient MAINTENANT, sans rien écrire. C'est ce qui permet à l'écran de
   * montrer l'ÉCART entre ce qui est enregistré et ce que la mémoire porte aujourd'hui — un
   * graphe qui n'affiche que sa table se présente comme à jour alors qu'il peut dater.
   */
  apercu(cle: Cle): Promise<{ liens: LienCalcule[]; abstentions: Abstention[]; faitsLus: number; illisibles: number }>;
  /** Recalcule TOUS les liens de règle. Rend ce qu'il a fait. */
  recalculer(cle: Cle, maintenant: Date): Promise<Recalcul>;
  /**
   * Recalcule les liens DEVINÉS (`origine: "modele"`, tâche MemoryAI 186 B) avec ce plongeur.
   * `faitsLus` compte les faits qui avaient un texte à comparer. Ne touche jamais aux liens de règle.
   */
  recalculerSens(cle: Cle, maintenant: Date, plonger: Plongeur): Promise<Recalcul>;
  /** Les liens en base, bornés. Les deux origines, distinguées par leur colonne. */
  tous(limite: number): Promise<Lien[]>;
  /**
   * Les liens qui TOUCHENT ce fait, dans les deux sens. [L33a].
   *
   * ⚠️ Les DEUX sens, et ce n'est pas un détail : la table stocke une paire ordonnée
   * (`fait_a`, `fait_b`) et seul `fait_a` est indexé, mais un lien « même document » est
   * SYMÉTRIQUE — ne lire que `fait_a` montrerait les liens à une extrémité et les cacherait
   * à l'autre, donc une fiche sur deux mentirait par omission, sans rien de rouge.
   *
   * ⚠️ `cible_b` filtre sur `fait` : un lien vers une QUESTION n'est pas un fait voisin, et
   * son `fait_b` n'est même pas une clé de `faits` (pas de FK sur cette colonne).
   */
  voisinsDe(faitId: string, limite: number): Promise<Lien[]>;
  /** Combien de liens, par type, et combien DEVINÉS — pour dire l'état sans tout charger. */
  comptes(): Promise<{ parType: Record<string, number>; total: number; devines: number }>;
  /** Les liens devinés en base, les plus forts d'abord, bornés (tâche MemoryAI 186 B). */
  devines(limite: number): Promise<Lien[]>;
}

/**
 * Déchiffre un fait pour le graphe. ⚠️ Un fait ILLISIBLE (clé tournée, ligne altérée) est
 * ÉCARTÉ et COMPTÉ, jamais rendu avec une valeur vide : une chaîne vide se grouperait avec
 * les autres chaînes vides et fabriquerait des liens entre des faits sans rapport.
 */
function pourGraphe(f: schema.Fait, cle: Cle): FaitPourGraphe | null {
  try {
    const valeur = f.valeur === null ? "" : f.niveau >= 1 ? dechiffrer(cle, f.valeur, f.id, f.niveau) : f.valeur;
    let attributs: Attributs | null = null;
    if (f.attributs) {
      const brut = f.niveau >= 1 ? dechiffrer(cle, f.attributs, f.id + "#attributs", f.niveau) : f.attributs;
      attributs = JSON.parse(brut) as Attributs;
    }
    return {
      id: f.id,
      domaine: f.predicat.split(".")[0] ?? "",
      predicat: f.predicat,
      valeurType: f.valeurType,
      valeur,
      attributs,
      valideDe: f.valideDe,
      valideA: f.valideA,
      remplaceId: f.remplaceId,
    };
  } catch {
    return null;
  }
}

/** Lit et déchiffre les faits vivants, avec leurs sources. Un fait illisible est compté, jamais lu vide. */
async function lireFaits(db: Base, cle: Cle): Promise<{ faits: FaitPourGraphe[]; illisibles: number }> {
  const rows = await db
    .select()
    .from(schema.faits)
    .where(and(isNull(schema.faits.supprimeLe), inArray(schema.faits.statut, ["valide", "propose"])));

  // Les sources de chaque fait, pour la règle `meme-source` : des identifiants, jamais lus.
  const sources = new Map<string, string[]>();
  for (const p of await db.select({ faitId: schema.provenances.faitId, ref: schema.provenances.sourceRef }).from(schema.provenances)) {
    const liste = sources.get(p.faitId);
    if (liste) liste.push(p.ref);
    else sources.set(p.faitId, [p.ref]);
  }

  const faits: FaitPourGraphe[] = [];
  let illisibles = 0;
  for (const f of rows) {
    const p = pourGraphe(f, cle);
    if (p === null) illisibles++;
    else faits.push({ ...p, sources: sources.get(f.id) ?? [] });
  }
  return { faits, illisibles };
}

/**
 * Lit, déchiffre, calcule. UNE seule implémentation pour l'aperçu et le recalcul : deux
 * chemins finiraient par diverger, et l'écran montrerait un écart qui n'existe pas.
 */
async function lireEtCalculer(db: Base, cle: Cle) {
  const { faits, illisibles } = await lireFaits(db, cle);

  // Seules les questions RÉPONDUES portent un lien de cause : une question ouverte n'a encore
  // rien produit, et une écartée n'a rien produit du tout.
  const qs = await db
    .select({ id: schema.questions.id, question: schema.questions.question, faitId: schema.questions.faitId })
    .from(schema.questions)
    .where(eq(schema.questions.statut, "repondue"));
  const questions: QuestionPourGraphe[] = qs.map((q) => ({ id: q.id, question: q.question, faitId: q.faitId }));

  const { liens, abstentions } = calculerLiens(faits, questions);
  return { liens, abstentions, faitsLus: faits.length, illisibles };
}

export function depotLiensDrizzle(db: Base): DepotLiens {
  return {
    async apercu(cle) {
      return lireEtCalculer(db, cle);
    },

    async recalculer(cle, maintenant) {
      const { liens, abstentions, faitsLus, illisibles } = await lireEtCalculer(db, cle);

      // ⚠️ L'ORDRE COMPTE : on supprime AVANT d'insérer, sinon l'index unique refuse une
      // paire que le calcul vient de reproduire à l'identique — le cas le plus fréquent.
      await db.delete(schema.liens).where(eq(schema.liens.origine, "regle"));
      const aEcrire = liens.map((l: LienCalcule) => ({
        id: randomUUID(),
        faitA: l.faitA,
        faitB: l.faitB,
        cibleB: l.cibleB,
        type: l.type,
        poids: l.poids,
        origine: "regle" as const,
        regle: l.regle,
        pourquoi: l.pourquoi,
        creeLe: maintenant,
      }));
      // Par paquets : une seule instruction de 5 000 valeurs dépasse ce qu'un pilote HTTP
      // accepte, et l'échec serait total plutôt que partiel.
      for (let i = 0; i < aEcrire.length; i += 200) {
        await db.insert(schema.liens).values(aEcrire.slice(i, i + 200));
      }

      return { faitsLus, illisibles, liensEcrits: aEcrire.length, abstentions };
    },

    async recalculerSens(cle, maintenant, plonger) {
      const { faits, illisibles } = await lireFaits(db, cle);
      const aPlonger = faits.flatMap((f) => {
        const texte = texteAPlonger(f, definition(f.predicat)?.description ?? null);
        return texte ? [{ id: f.id, texte }] : [];
      });
      // Le modèle tourne AVANT toute suppression : s'il échoue, les liens devinés d'hier restent.
      const vecteurs = aPlonger.length ? await plonger(aPlonger.map((x) => x.texte)) : [];
      if (vecteurs.length !== aPlonger.length) throw new Error(`le modèle a rendu ${vecteurs.length} vecteurs pour ${aPlonger.length} textes`);
      const { liens, abstentions } = liensDeSens(aPlonger.map((x, i) => ({ ...x, vecteur: vecteurs[i]! })));

      await db
        .delete(schema.liens)
        .where(and(eq(schema.liens.origine, "modele"), eq(schema.liens.type, "sens-proche")));
      const aEcrire = liens.map((l) => ({
        id: randomUUID(),
        faitA: l.faitA,
        faitB: l.faitB,
        cibleB: l.cibleB,
        type: l.type,
        poids: l.poids,
        origine: "modele" as const,
        regle: l.regle,
        pourquoi: l.pourquoi,
        creeLe: maintenant,
      }));
      for (let i = 0; i < aEcrire.length; i += 200) {
        await db.insert(schema.liens).values(aEcrire.slice(i, i + 200));
      }
      return { faitsLus: aPlonger.length, illisibles, liensEcrits: aEcrire.length, abstentions };
    },

    async tous(limite) {
      return db.select().from(schema.liens).limit(limite);
    },

    async voisinsDe(faitId, limite) {
      return db
        .select()
        .from(schema.liens)
        .where(
          or(
            eq(schema.liens.faitA, faitId),
            and(eq(schema.liens.faitB, faitId), eq(schema.liens.cibleB, "fait")),
          ),
        )
        .limit(limite);
    },

    async comptes() {
      const rows = await db.select({ type: schema.liens.type, origine: schema.liens.origine }).from(schema.liens);
      const parType: Record<string, number> = {};
      let devines = 0;
      for (const r of rows) {
        parType[r.type] = (parType[r.type] ?? 0) + 1;
        if (r.origine === "modele") devines++;
      }
      return { parType, total: rows.length, devines };
    },

    async devines(limite) {
      return db.select().from(schema.liens).where(eq(schema.liens.origine, "modele")).orderBy(desc(schema.liens.poids), asc(schema.liens.faitA)).limit(limite);
    },
  };
}

/** Lie un fait retenu par LIA aux faits qu'elle a déjà lus pendant le tour. */
export async function poserLiensLia(db: Base, faitId: string, cibles: readonly string[], maintenant: Date): Promise<number> {
  const valeurs = [...new Set(cibles)]
    .filter((cible) => cible !== faitId)
    .map((cible) => {
      const [faitA, faitB] = faitId < cible ? [faitId, cible] : [cible, faitId];
      return {
        id: randomUUID(),
        faitA,
        faitB,
        cibleB: "fait" as const,
        type: "lie-par-lia" as const,
        poids: 0.5,
        origine: "modele" as const,
        regle: "lia-lie-v1",
        pourquoi: "Rapproché par LIA quand Marc l'a dit : même sujet (lien deviné).",
        creeLe: maintenant,
      };
    });
  if (valeurs.length === 0) return 0;
  const inseres = await db.insert(schema.liens).values(valeurs).onConflictDoNothing().returning({ id: schema.liens.id });
  return inseres.length;
}
