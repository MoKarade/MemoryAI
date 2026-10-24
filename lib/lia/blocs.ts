// lib/lia/blocs.ts — les FORMES que LIA peut choisir pour répondre : un catalogue FERMÉ. PUR.
//
// La maquette v5 (validée par Marc le 22/10/2026) dessine 22 formes : carte, frise, liste,
// courbe… Ce module en est la SOURCE : le schéma de chacune, et la fonction qui trie ce que le
// modèle propose. Le rendu appartient à l'hôte (le hub d'abord, `renderBlocks`) ; le paquet
// `lia-ui` ne les interprète jamais. Copie lisible avec exemples fictifs :
// `commun/assistant/BLOCS-lia.md`.
//
// ⚠️ FERMÉ. Un `type` inconnu est rejeté, jamais « rendu au mieux ». Un champ inconnu est retiré.
// ⚠️ SOURCÉ. Un bloc de données porte `sources` : les identifiants des faits (ou papiers) qu'il montre. Un
// identifiant qui n'a PAS été servi pendant le tour rejette le bloc entier — la même garde que
// les citations de [L25] (`lib/chat/liens.ts`) : un modèle qui invente une référence est le cas
// le plus grave, et un graphique se croit plus vite qu'une phrase.
// ⚠️ UN BLOC FAUX NE TUE PAS LES AUTRES. Chacun est validé seul ; les rejetés sont COMPTÉS et
// nommés (indice, raison), jamais avalés.
// Seule `confirmation` n'a pas de source : c'est une action PROPOSÉE (ADR 0017), que le hub
// exécute après la confirmation de Marc. Elle ne montre aucun fait.

import { z } from "zod";

export const MAX_BLOCS = 20;

const ID_FAIT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const libelle = z.string().trim().min(1).max(80);
const texteCourt = z.string().trim().min(1).max(500);
const nombre = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/);
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const unite = z.string().trim().min(1).max(16).optional();

/**
 * Une source est l'`id` d'un fait ou d'un papier. Le modèle voit aussi l'adresse `ref="/fait/<id>"`
 * et la cite parfois : le préfixe est retiré AVANT la règle, qui reste la même (un id servi).
 */
const source = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().replace(/^\/(?:fait|pieces?)\//, "") : v),
  z.string().regex(ID_FAIT),
);

/** Ce que tout bloc de données porte. */
const base = {
  titre: z.string().trim().min(1).max(120).optional(),
  sources: z.array(source).min(1).max(50),
};

const Carte = z.object({
  type: z.literal("carte"),
  ...base,
  points: z
    .array(z.object({ lat: nombre.min(-90).max(90), lon: nombre.min(-180).max(180), libelle, quand: date.optional() }))
    .min(1)
    .max(50),
});

const Chrono = z
  .object({
    type: z.literal("chrono"),
    ...base,
    evenements: z.array(z.object({ date, libelle })).min(1).max(30),
    /** L'événement mis en avant, par son indice. */
    actuel: z.number().int().min(0).optional(),
  })
  .refine((b) => b.actuel === undefined || b.actuel < b.evenements.length, { message: "actuel hors de la frise" });

const Liste = z.object({
  type: z.literal("liste"),
  ...base,
  elements: z.array(z.object({ libelle: texteCourt, fait: z.boolean().optional() })).min(1).max(30),
});

const Chat = z.object({
  type: z.literal("chat"),
  ...base,
  messages: z.array(z.object({ de: z.string().trim().min(1).max(60), texte: texteCourt, quand: date.optional() })).min(1).max(20),
});

const Courbe = z.object({
  type: z.literal("courbe"),
  ...base,
  unite,
  series: z
    .array(z.object({ nom: libelle, points: z.array(z.object({ x: z.string().trim().min(1).max(40), y: nombre })).min(2).max(366) }))
    .min(1)
    .max(4),
});

const Barres = z.object({
  type: z.literal("barres"),
  ...base,
  unite,
  barres: z.array(z.object({ libelle, valeur: nombre })).min(1).max(30),
});

const Camembert = z.object({
  type: z.literal("camembert"),
  ...base,
  unite,
  parts: z.array(z.object({ libelle, valeur: nombre.min(0) })).min(2).max(12),
});

const Jauge = z
  .object({ type: z.literal("jauge"), ...base, libelle, unite, valeur: nombre, min: nombre, max: nombre })
  .refine((b) => b.min < b.max && b.valeur >= b.min && b.valeur <= b.max, { message: "valeur hors de [min, max]" });

const Chiffre = z.object({
  type: z.literal("chiffre"),
  ...base,
  libelle,
  unite,
  valeur: nombre,
  /** Écart avec la mesure précédente, dans la même unité. */
  variation: nombre.optional(),
});

const Tableau = z
  .object({
    type: z.literal("tableau"),
    ...base,
    colonnes: z.array(libelle).min(1).max(8),
    lignes: z.array(z.array(z.string().max(200))).min(1).max(50),
  })
  .refine((b) => b.lignes.every((l) => l.length === b.colonnes.length), { message: "ligne de largeur différente des colonnes" });

const Calendrier = z.object({
  type: z.literal("calendrier"),
  ...base,
  jours: z.array(z.object({ date, libelle: libelle.optional(), intensite: nombre.min(0).max(1).optional() })).min(1).max(62),
});

const Reseau = z
  .object({
    type: z.literal("reseau"),
    ...base,
    noeuds: z.array(z.object({ id: z.string().trim().min(1).max(40), libelle })).min(2).max(60),
    liens: z.array(z.object({ a: z.string(), b: z.string() })).max(200),
  })
  .refine(
    (b) => {
      const ids = new Set(b.noeuds.map((n) => n.id));
      return ids.size === b.noeuds.length && b.liens.every((l) => ids.has(l.a) && ids.has(l.b));
    },
    { message: "lien vers un nœud absent, ou nœud en double" },
  );

const Comparaison = z.object({
  type: z.literal("comparaison"),
  ...base,
  colonnes: z
    .array(z.object({ libelle, lignes: z.array(z.object({ cle: libelle, valeur: z.string().trim().min(1).max(200) })).min(1).max(20) }))
    .min(2)
    .max(4),
});

const Radar = z
  .object({
    type: z.literal("radar"),
    ...base,
    axes: z.array(libelle).min(3).max(10),
    series: z.array(z.object({ nom: libelle, valeurs: z.array(nombre) })).min(1).max(3),
  })
  .refine((b) => b.series.every((s) => s.valeurs.length === b.axes.length), { message: "série de longueur différente des axes" });

const Entonnoir = z.object({
  type: z.literal("entonnoir"),
  ...base,
  etapes: z.array(z.object({ libelle, valeur: nombre.min(0) })).min(2).max(8),
});

const Flux = z.object({
  type: z.literal("flux"),
  ...base,
  unite,
  liens: z.array(z.object({ de: libelle, vers: libelle, valeur: nombre.positive() })).min(1).max(30),
});

const Heatmap = z
  .object({
    type: z.literal("heatmap"),
    ...base,
    lignes: z.array(libelle).min(1).max(31),
    colonnes: z.array(libelle).min(1).max(31),
    valeurs: z.array(z.array(nombre)),
  })
  .refine((b) => b.valeurs.length === b.lignes.length && b.valeurs.every((v) => v.length === b.colonnes.length), {
    message: "grille de valeurs de taille différente",
  });

const Kanban = z.object({
  type: z.literal("kanban"),
  ...base,
  colonnes: z.array(z.object({ libelle, cartes: z.array(texteCourt).max(20) })).min(2).max(6),
});

interface Noeud {
  libelle: string;
  enfants?: Noeud[];
}
const MAX_PROFONDEUR_ARBRE = 4;
const MAX_NOEUDS_ARBRE = 60;
const NoeudArbre: z.ZodType<Noeud> = z.lazy(() => z.object({ libelle, enfants: z.array(NoeudArbre).max(12).optional() }));
function mesurer(n: Noeud, profondeur = 1): { noeuds: number; profondeur: number } {
  let noeuds = 1;
  let max = profondeur;
  for (const e of n.enfants ?? []) {
    const m = mesurer(e, profondeur + 1);
    noeuds += m.noeuds;
    max = Math.max(max, m.profondeur);
  }
  return { noeuds, profondeur: max };
}
const Arbre = z
  .object({ type: z.literal("arbre"), ...base, racine: NoeudArbre })
  .refine(
    (b) => {
      const m = mesurer(b.racine);
      return m.noeuds <= MAX_NOEUDS_ARBRE && m.profondeur <= MAX_PROFONDEUR_ARBRE;
    },
    { message: `arbre au-delà de ${MAX_NOEUDS_ARBRE} nœuds ou de ${MAX_PROFONDEUR_ARBRE} niveaux` },
  );

const Document = z.object({
  type: z.literal("document"),
  ...base,
  libelle,
  emetteur: libelle.optional(),
  date: date.optional(),
  /** Le papier lui-même : https seulement. */
  lien: z
    .string()
    .max(500)
    .regex(/^https:\/\/[^\s]+$/)
    .optional(),
});

const Cadran = z.object({
  type: z.literal("cadran"),
  ...base,
  segments: z.array(z.object({ debut: heure, fin: heure, libelle })).min(1).max(24),
  maintenant: heure.optional(),
});

/** Une action PROPOSÉE (ADR 0017) : le hub l'exécute après la confirmation de Marc. Aucun fait. */
const Confirmation = z.object({
  type: z.literal("confirmation"),
  titre: z.string().trim().min(1).max(120).optional(),
  action: z.object({ id: z.string().regex(/^[a-z0-9_.-]{1,60}$/), libelle }),
  resume: texteCourt,
  /** Niveau du catalogue d'actions : 1 direct annulable, 2 aperçu puis jeton, 3 lecture seule. */
  niveau: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const SCHEMAS = {
  carte: Carte,
  chrono: Chrono,
  liste: Liste,
  chat: Chat,
  courbe: Courbe,
  barres: Barres,
  camembert: Camembert,
  jauge: Jauge,
  chiffre: Chiffre,
  tableau: Tableau,
  calendrier: Calendrier,
  reseau: Reseau,
  comparaison: Comparaison,
  radar: Radar,
  entonnoir: Entonnoir,
  flux: Flux,
  heatmap: Heatmap,
  kanban: Kanban,
  arbre: Arbre,
  document: Document,
  cadran: Cadran,
  confirmation: Confirmation,
} as const;

export type TypeBloc = keyof typeof SCHEMAS;
export type Bloc = { [K in TypeBloc]: z.infer<(typeof SCHEMAS)[K]> }[TypeBloc];

/** Les 22 formes, dans l'ordre de la maquette. */
export const TYPES_BLOCS = Object.keys(SCHEMAS) as TypeBloc[];

// ── La forme de chaque bloc, pour le MODÈLE ─────────────────────────────────────────────
//
// ⚠️ DÉRIVÉE des schémas, jamais recopiée à la main. Le 24/10, l'outil ne donnait que les NOMS
// des 22 formes : le modèle devinait les champs et le tri rejetait tout (tâche Hubperso 360). Une
// description écrite à part aurait fini par diverger du tri ; celle-ci ne le peut pas.
// Compacte exprès (environ 2 Ko, contre 15 Ko pour le JSON Schema complet) : elle part à chaque tour.

type Js = { [k: string]: unknown };
const COMMUNS = new Set(["type", "titre", "sources"]);

function forme(js: Js, defs: Js, vus: ReadonlySet<string>, racine: boolean): string {
  const ref = typeof js.$ref === "string" ? js.$ref.replace("#/$defs/", "") : null;
  if (ref) return vus.has(ref) ? "(même forme)" : forme(defs[ref] as Js, defs, new Set([...vus, ref]), false);
  if (js.const !== undefined) return JSON.stringify(js.const);
  const variantes = (js.anyOf ?? js.oneOf) as Js[] | undefined;
  if (Array.isArray(variantes)) return variantes.map((v) => forme(v, defs, vus, false)).join("|");
  if (js.type === "array") return `[${forme(js.items as Js, defs, vus, false)}]`;
  if (js.type === "object") {
    const requis = new Set((js.required as string[] | undefined) ?? []);
    const champs = Object.entries((js.properties as Record<string, Js> | undefined) ?? {})
      .filter(([k]) => !(racine && COMMUNS.has(k)))
      .map(([k, v]) => `${k}${requis.has(k) ? "" : "?"}:${forme(v, defs, vus, false)}`);
    return `{${champs.join(",")}}`;
  }
  if (js.type === "number" || js.type === "integer") return "nombre";
  if (js.type === "boolean") return "booléen";
  if (js.type === "string") {
    const motif = typeof js.pattern === "string" ? js.pattern : "";
    if (motif.startsWith("^\\d{4}")) return "date";
    if (motif.startsWith("^([01]")) return "HH:MM";
    if (motif.startsWith("^https")) return "https";
    return "texte";
  }
  return "valeur";
}

/** Une ligne par forme : `chiffre {libelle:texte,unite?:texte,valeur:nombre,variation?:nombre}`. */
export const SIGNATURES_BLOCS: string = TYPES_BLOCS.map((t) => {
  const js = z.toJSONSchema(SCHEMAS[t], { io: "input", unrepresentable: "any" }) as Js;
  return `${t} ${forme(js, (js.$defs as Js | undefined) ?? {}, new Set(), true)}`;
}).join("\n");

export interface BlocsTries {
  blocs: Bloc[];
  rejetes: { indice: number; raison: string }[];
}

/**
 * Trie ce que le modèle propose. `servis` : les identifiants des faits et papiers servis pendant CE tour.
 * Au-delà de `MAX_BLOCS`, le reste est rejeté (et compté), pas tronqué en silence.
 */
export function trierBlocs(brut: unknown, servis: ReadonlySet<string>): BlocsTries {
  const resultat: BlocsTries = { blocs: [], rejetes: [] };
  if (!Array.isArray(brut)) {
    if (brut !== undefined) resultat.rejetes.push({ indice: -1, raison: "blocs attendus en liste" });
    return resultat;
  }
  brut.forEach((b: unknown, indice) => {
    if (indice >= MAX_BLOCS) {
      resultat.rejetes.push({ indice, raison: `au-delà de ${MAX_BLOCS} blocs` });
      return;
    }
    const type = typeof b === "object" && b !== null ? (b as { type?: unknown }).type : undefined;
    const schema = typeof type === "string" && Object.hasOwn(SCHEMAS, type) ? SCHEMAS[type as TypeBloc] : null;
    if (!schema) {
      resultat.rejetes.push({ indice, raison: "type inconnu" });
      return;
    }
    const r = schema.safeParse(b);
    if (!r.success) {
      // Les chemins des champs fautifs, jamais leurs valeurs : elles peuvent porter un fait.
      const champs = [...new Set(r.error.issues.map((i) => i.path.join(".") || i.message))].join(", ");
      resultat.rejetes.push({ indice, raison: `${type} invalide : ${champs}` });
      return;
    }
    const bloc = r.data as Bloc;
    if ("sources" in bloc && bloc.sources.some((s) => !servis.has(s))) {
      resultat.rejetes.push({ indice, raison: `${type} : source non servie pendant ce tour` });
      return;
    }
    resultat.blocs.push(bloc);
  });
  return resultat;
}
