#!/usr/bin/env node
// scripts/pousser-session.mjs — pousse une session de Claude Code dans la mémoire (lot 10).
//
// Marc a choisi (ADR 0002 §4, question C) que ce soit AUTOMATIQUE, contre ma recommandation.
// Ce script est donc à la fois l'outil manuel et le corps du hook : ce qu'il refuse
// d'envoyer, le hook le refuse aussi.
//
// ══ CE QU'IL ENVOIE, ET CE QU'IL N'ENVOIE JAMAIS ═════════════════════════════════════════
//
// Une transcription de Claude Code est un `.jsonl` où chaque ligne est un événement. Les
// lignes `user` et `assistant` portent le TEXTE ; elles portent AUSSI, dans le même tableau
// `content`, des blocs `tool_use` et `tool_result` — donc des diffs, des fichiers lus, des
// sorties de commandes. **Seuls les blocs `type: "text"` sont retenus.** Le reste n'est pas
// nettoyé, il est ignoré : le serveur refuse de toute façon un corps qui en contient un
// (`resultat_outil_interdit`), et c'est cette double barrière qui rend l'automatisme tenable.
//
// ⚠️ ÉCHEC FERMÉ. Si une ligne ne se lit pas, si l'extraction lève, si la réponse du serveur
// n'est pas un 200 : on n'envoie pas, ou on s'arrête, et on le DIT. Une session à moitié
// poussée dont personne ne sait qu'elle est à moitié poussée est pire que pas de session.
//
// Usage :
//   MEMORYAI_URL=https://memoryai.hubperso.com \
//   MEMORYAI_TOKEN_CLAUDECODE_ECRITURE=… \
//   node scripts/pousser-session.mjs <transcription.jsonl> [--dry-run]

import { readFileSync } from "node:fs";

export const MAX_MESSAGES_PAR_ENVOI = 200;

/**
 * Extrait les messages d'une transcription `.jsonl`. PURE, exportée, testée.
 *
 * Tolérante sur la FORME (une ligne illisible est comptée, pas fatale — une transcription
 * tronquée par un arrêt brutal est le cas NORMAL), stricte sur le FOND : seul du texte sort.
 */
export function extraireMessages(contenu) {
  const messages = [];
  let lignesIllisibles = 0;
  let blocsIgnores = 0;

  for (const ligne of contenu.split("\n")) {
    if (!ligne.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(ligne);
    } catch {
      lignesIllisibles++;
      continue;
    }
    const role = ev?.message?.role ?? ev?.role;
    if (role !== "user" && role !== "assistant") continue;
    const brut = ev?.message?.content ?? ev?.content;

    let texte = "";
    if (typeof brut === "string") {
      texte = brut;
    } else if (Array.isArray(brut)) {
      for (const bloc of brut) {
        if (bloc?.type === "text" && typeof bloc.text === "string") texte += (texte ? "\n" : "") + bloc.text;
        else if (bloc && typeof bloc === "object") blocsIgnores++;
      }
    }
    texte = texte.trim();
    if (texte.length > 0) messages.push({ role, contenu: texte });
  }

  return { messages, lignesIllisibles, blocsIgnores };
}

/** Découpe en envois : le serveur borne à 200 messages, et un lot partiel se reprend. */
export function decouperEnLots(messages, taille = MAX_MESSAGES_PAR_ENVOI) {
  const lots = [];
  for (let i = 0; i < messages.length; i += taille) lots.push(messages.slice(i, i + taille));
  return lots;
}

async function principal() {
  const [fichier, ...options] = process.argv.slice(2);
  const simulation = options.includes("--dry-run");
  if (!fichier) {
    console.error("Usage : node scripts/pousser-session.mjs <transcription.jsonl> [--dry-run]");
    process.exit(2);
  }

  const base = process.env.MEMORYAI_URL;
  const jeton = process.env.MEMORYAI_TOKEN_CLAUDECODE_ECRITURE;
  if (!simulation && (!base || !jeton)) {
    console.error("MEMORYAI_URL et MEMORYAI_TOKEN_CLAUDECODE_ECRITURE sont requis (ou --dry-run).");
    process.exit(2);
  }

  const { messages, lignesIllisibles, blocsIgnores } = extraireMessages(readFileSync(fichier, "utf8"));
  console.log(
    `${messages.length} message(s) de texte · ${blocsIgnores} bloc(s) non textuels ignorés (outils, diffs)` +
      (lignesIllisibles > 0 ? ` · ${lignesIllisibles} ligne(s) illisibles` : ""),
  );
  if (messages.length === 0) {
    console.log("Rien à pousser.");
    return;
  }
  if (simulation) {
    console.log("--dry-run : rien n'a été envoyé.");
    return;
  }

  let conversationId = null;
  let ecrits = 0;
  let masques = 0;
  for (const [i, lot] of decouperEnLots(messages).entries()) {
    const r = await fetch(new URL("/api/conversations", base), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ source: "claude-code", messages: lot, ...(conversationId ? { conversation_id: conversationId } : {}) }),
    });
    const corps = await r.json().catch(() => ({}));
    if (!r.ok) {
      // On s'arrête ICI : continuer sur un refus pousserait les lots suivants dans le vide.
      console.error(`Lot ${i + 1} refusé (${r.status}) : ${corps.error ?? "?"} — ${corps.message ?? ""}`);
      process.exit(1);
    }
    conversationId = corps.conversationId ?? conversationId;
    ecrits += corps.ecrits ?? 0;
    masques += corps.secretsRetires ?? 0;
  }

  console.log(`${ecrits} message(s) consigné(s) dans la conversation ${conversationId}.`);
  if (masques > 0) console.log(`⚠️ ${masques} fragment(s) ressemblant à un secret ont été masqués avant chiffrement.`);
}

// Exécuté directement (pas importé par un test).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  principal().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
