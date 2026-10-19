#!/usr/bin/env node
// scripts/seed.mjs — envoie un fichier de seed à `POST /api/faits`, par lots de 50.
//
// Le seed (ADR 0001 §8, lot 6) est une liste de faits PROPOSÉS depuis la session de
// démarrage, relue par Marc AVANT tout envoi, puis validée fait par fait dans `/a-valider`.
// Ce script ne décide rien : il met chaque entrée à la forme que la route attend, découpe en
// lots, envoie, et rend compte. Un refus (422 par fait, dans `refuses`) est AFFICHÉ avec son
// index et son code — jamais avalé. Un seul lot en échec ⇒ code de sortie 1.
//
// Le fichier de seed est LOCAL (`seed/*.local.json`, ignoré par git) : il porte des faits
// personnels. `seed/exemple.json` en montre la forme, et `tests/seed.test.ts` valide TOUT
// fichier présent avec la vraie `validerFait` — sans base ni réseau.
//
// Usage :
//   MEMORYAI_URL=https://memoryai.hubperso.com \
//   MEMORYAI_TOKEN_SEED_ECRITURE=… \
//   node scripts/seed.mjs seed/faits.local.json            # envoie
//   node scripts/seed.mjs seed/faits.local.json --lister   # affiche la liste, n'envoie rien
//   node scripts/seed.mjs seed/faits.local.json --lots     # montre les lots, n'envoie rien
//
// Les fonctions PURES (`normaliser`, `decouperEnLots`) sont exportées pour le test.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Plafond de la route (`lib/ecrireFaits.ts` — `LOT_MAX`). Recopié ; le test le compare. */
export const TAILLE_LOT = 50;

/**
 * @typedef {object} EntreeSeed
 * @property {string} predicat
 * @property {string} valeur
 * @property {"texte"|"date"|"ref_document"} valeur_type
 * @property {number} [confiance]
 * @property {number} [niveau_propose]
 * @property {string} [valide_de]
 * @property {string} [valide_a]
 * @property {Record<string, string>} [attributs]
 * @property {string} [source]  "doc:<alias>", "app:<id>", "seed:<origine>" ou "session"
 * @property {string} [dossier]
 * @property {string} [type_document]
 */

/**
 * @typedef {object} FichierSeed
 * @property {string} extracteur
 * @property {string} date_source
 * @property {Record<string, string | null>} documents  alias → fileId Drive, ou null si inconnu
 * @property {EntreeSeed[]} faits
 */

/**
 * La provenance d'une entrée, dérivée de son `source` :
 *   - un pointeur (`ref_document`) sans `source` pointe vers lui-même (source_type `document`) ;
 *   - `doc:<alias>` avec un fileId connu ⇒ `document` + ce fileId ; inconnu ⇒ `seed` + `drive:<alias>` ;
 *   - `app:<id>` ⇒ `app` ; `seed:<origine>` ⇒ `seed` ; `session` ⇒ `seed` + `session-<date>`.
 * `dossier` et `type_document` ne sont transmis que s'ils sont écrits sur l'entrée : ce sont
 * eux qui MONTENT le niveau (`lib/niveau.ts`), et un texte monté en N3 serait refusé.
 * @param {EntreeSeed} e
 * @param {FichierSeed} f
 */
export function provenanceDe(e, f) {
  const base = { extracteur: f.extracteur, date_source: f.date_source };
  const contexte = {
    ...(e.dossier ? { dossier: e.dossier } : {}),
    ...(e.type_document ? { type_document: e.type_document } : {}),
  };
  const src = e.source;
  if (!src) {
    if (e.valeur_type !== "ref_document") {
      throw new Error(`« ${e.predicat} » : une entrée sans \`source\` doit être un pointeur`);
    }
    return { source_type: "document", source_ref: e.valeur, ...base, ...contexte };
  }
  if (src === "session") return { source_type: "seed", source_ref: `session-${f.date_source}`, ...base, ...contexte };
  const deuxPoints = src.indexOf(":");
  const genre = deuxPoints === -1 ? src : src.slice(0, deuxPoints);
  const reste = deuxPoints === -1 ? "" : src.slice(deuxPoints + 1);
  if (!reste) throw new Error(`« ${e.predicat} » : source « ${src} » mal formée`);
  if (genre === "doc") {
    if (!(reste in f.documents)) throw new Error(`« ${e.predicat} » : alias de document « ${reste} » inconnu`);
    const fileId = f.documents[reste];
    return fileId
      ? { source_type: "document", source_ref: fileId, ...base, ...contexte }
      : { source_type: "seed", source_ref: `drive:${reste}`, ...base, ...contexte };
  }
  if (genre === "app") return { source_type: "app", source_ref: reste, ...base, ...contexte };
  if (genre === "seed") return { source_type: "seed", source_ref: reste, ...base, ...contexte };
  throw new Error(`« ${e.predicat} » : genre de source « ${genre} » inconnu`);
}

/**
 * Met une entrée à la forme EXACTE de `POST /api/faits`. Rien d'autre n'est transmis :
 * un champ de plus serait refusé (`champ_inconnu`).
 * @param {EntreeSeed} e
 * @param {FichierSeed} f
 */
export function normaliser(e, f) {
  return {
    sujet: "marc",
    predicat: e.predicat,
    valeur: e.valeur,
    valeur_type: e.valeur_type,
    ...(e.valide_de ? { valide_de: e.valide_de } : {}),
    ...(e.valide_a ? { valide_a: e.valide_a } : {}),
    ...(e.niveau_propose !== undefined ? { niveau_propose: e.niveau_propose } : {}),
    ...(e.confiance !== undefined ? { confiance: e.confiance } : {}),
    ...(e.attributs ? { attributs: e.attributs } : {}),
    provenance: provenanceDe(e, f),
  };
}

/** @param {FichierSeed} f */
export function normaliserFichier(f) {
  return f.faits.map((e) => normaliser(e, f));
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} [taille]
 * @returns {T[][]}
 */
export function decouperEnLots(items, taille = TAILLE_LOT) {
  const lots = [];
  for (let i = 0; i < items.length; i += taille) lots.push(items.slice(i, i + taille));
  return lots;
}

/** @param {string} chemin @returns {FichierSeed} */
export function lireSeed(chemin) {
  const f = JSON.parse(readFileSync(chemin, "utf8"));
  if (!f || !Array.isArray(f.faits) || typeof f.extracteur !== "string" || typeof f.date_source !== "string") {
    throw new Error(`${chemin} : attendu { extracteur, date_source, documents, faits: [...] }`);
  }
  f.documents ??= {};
  return f;
}

/** Une ligne lisible par fait, pour la relecture. @param {EntreeSeed} e @param {number} i */
export function ligne(e, i) {
  const extras = [];
  if (e.niveau_propose !== undefined) extras.push(`N${e.niveau_propose}`);
  if (e.confiance !== undefined && e.confiance < 1) extras.push(`confiance ${e.confiance}`);
  if (e.valide_de || e.valide_a) extras.push(`${e.valide_de ?? "…"} → ${e.valide_a ?? "…"}`);
  if (e.attributs) extras.push(Object.entries(e.attributs).map(([k, v]) => `${k}=${v}`).join(", "));
  const suffixe = extras.length ? ` (${extras.join(" · ")})` : "";
  return `${String(i + 1).padStart(3)}. ${e.predicat} = ${e.valeur}${suffixe}`;
}

async function envoyer(url, jeton, lot) {
  const r = await fetch(`${url.replace(/\/$/, "")}/api/faits`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
    body: JSON.stringify({ faits: lot }),
  });
  const texte = await r.text();
  let corps;
  try {
    corps = JSON.parse(texte);
  } catch {
    corps = { brut: texte.slice(0, 500) };
  }
  return { status: r.status, corps };
}

async function main() {
  const [chemin, ...drapeaux] = process.argv.slice(2);
  if (!chemin) {
    console.error("usage : node scripts/seed.mjs <fichier.json> [--lister | --lots]");
    process.exit(2);
  }
  const f = lireSeed(chemin);
  const faits = normaliserFichier(f);
  const lots = decouperEnLots(faits);

  if (drapeaux.includes("--lister")) {
    f.faits.forEach((e, i) => console.log(ligne(e, i)));
    console.log(`\n${f.faits.length} faits, ${lots.length} lot(s) de ${TAILLE_LOT} au plus.`);
    return;
  }
  if (drapeaux.includes("--lots")) {
    lots.forEach((l, i) => console.log(`lot ${i + 1} : ${l.length} faits — ${l[0].predicat} … ${l[l.length - 1].predicat}`));
    return;
  }

  const url = process.env.MEMORYAI_URL;
  const jeton = process.env.MEMORYAI_TOKEN_SEED_ECRITURE;
  if (!url || !jeton) {
    console.error("MEMORYAI_URL et MEMORYAI_TOKEN_SEED_ECRITURE sont requis pour envoyer (ou --lister / --lots).");
    process.exit(2);
  }

  let echec = false;
  const total = { recus: 0, acceptes: 0, dejaPresents: 0, refuses: 0 };
  for (const [i, lot] of lots.entries()) {
    const { status, corps } = await envoyer(url, jeton, lot);
    if (status !== 200) {
      echec = true;
      console.error(`lot ${i + 1}/${lots.length} : HTTP ${status} — ${JSON.stringify(corps)}`);
      continue;
    }
    total.recus += corps.recus;
    total.acceptes += corps.acceptes;
    total.dejaPresents += corps.dejaPresents;
    total.refuses += corps.refuses.length;
    console.log(
      `lot ${i + 1}/${lots.length} : ${corps.acceptes} acceptés, ${corps.dejaPresents} déjà présents, ${corps.refuses.length} refusés`,
    );
    for (const r of corps.refuses) {
      echec = true;
      const e = lot[r.index];
      console.error(`  refusé [${r.code}] ${e.predicat} = ${e.valeur} — ${r.raison}`);
    }
  }
  console.log(`\nTotal : ${total.acceptes} acceptés, ${total.dejaPresents} déjà présents, ${total.refuses} refusés sur ${total.recus}.`);
  console.log("Prochaine étape : /a-valider — chaque fait est en statut « proposé » tant que Marc ne l'a pas validé.");
  process.exit(echec ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
