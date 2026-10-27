// lib/chat/erreursModele.ts — ce que le chat DIT quand l'API du modèle refuse. PUR.
//
// ⚠️ Né le 24/09 : le compte Anthropic était à sec, `/api/chat` laissait l'exception remonter,
// Next rendait un 500 SANS CORPS, et l'écran affichait « Failed to execute 'json' on
// 'Response': Unexpected end of JSON input ». Rien dans cette phrase ne disait qu'il fallait
// recharger un compte. Et après la recharge, le même refus a continué : les crédits étaient
// ailleurs — une confusion que seul un message qui NOMME le bon compte peut éviter.
//
// Chaque cause appelle un geste différent, donc chacune a son code et sa phrase. Ce qu'on ne
// reconnaît pas n'est PAS deviné : il est rendu comme une panne du modèle, avec le statut, et
// le détail reste dans les journaux.
//
// ⚠️ SERVEUR SEULEMENT : ce module importe le SDK pour reconnaître ses erreurs par leur CLASSE.
// Revue #72 : reconnaître « un objet qui porte un `status` numérique » classait aussi une
// erreur maison (`OAuthErreur` porte `status = 400`) en refus du modèle. Le message côté
// écran vit à part, dans `messageDeReponse.ts`, pour que le navigateur n'embarque pas le SDK.

import Anthropic from "@anthropic-ai/sdk";

export interface ErreurModele {
  status: number;
  code: string;
  message: string;
}

/**
 * Classe une erreur levée par l'appel au modèle. `null` si ce n'est pas une erreur du SDK
 * (un défaut du code, une panne de base) : celle-là n'est pas l'affaire de ce module.
 */
export function classerErreurModele(err: unknown): ErreurModele | null {
  // Avant `APIError` générique : une coupure réseau n'a PAS de statut, et c'est la panne
  // transitoire la plus fréquente (revue #72, sonde avec la vraie classe du SDK).
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 503, code: "modele_injoignable", message: "Anthropic est injoignable en ce moment (réseau ou délai dépassé). Réessaie dans un instant." };
  }
  if (!(err instanceof Anthropic.APIError) || typeof err.status !== "number") return null;
  const e = err as { status: number; error?: { error?: { type?: unknown; message?: unknown } } | null };
  const type = typeof e.error?.error?.type === "string" ? e.error.error.type : "";
  const texte = typeof e.error?.error?.message === "string" ? e.error.error.message : "";

  // ⚠️ Le crédit épuisé arrive en 400 `invalid_request_error` : son TYPE ne le distingue pas
  // d'une requête mal formée, seule sa phrase le fait. C'est de la prose, que le fournisseur
  // peut reformuler — d'où `billing_error` accepté aussi, et un repli qui reste une panne
  // NOMMÉE (jamais un 500 muet) si la phrase change.
  if (type === "billing_error" || (e.status === 400 && /credit balance/i.test(texte))) {
    return {
      status: 503,
      code: "credit_epuise",
      message:
        "Le crédit de l'API Anthropic est épuisé. Recharge-le dans la console API (platform.claude.com → Billing), dans l'organisation de la clé du chat — le crédit de claude.ai ne compte pas.",
    };
  }
  // La limite d'usage de l'API (plafond de dépense du compte, pas le solde) arrive aussi en 400
  // `invalid_request_error`, avec une phrase qui donne la date de reprise. Sans cette branche elle
  // tombait dans « requête refusée (HTTP 400) », qui ne dit ni la cause ni quand LIA revient.
  // La date n'est reprise que si elle a la forme exacte `AAAA-MM-JJ at HH:MM UTC` : tout autre
  // texte du fournisseur reste une donnée, jamais recopié.
  if (e.status === 400 && /api usage limits?/i.test(texte)) {
    const reprise = /(\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) UTC/.exec(texte);
    return {
      status: 503,
      code: "limite_usage",
      message: reprise
        ? `La limite d'usage de l'API Anthropic est atteinte : LIA et le chat reprennent le ${reprise[1]} à ${reprise[2]} UTC, ou dès que la limite est relevée dans la console API.`
        : "La limite d'usage de l'API Anthropic est atteinte : LIA et le chat reprennent à la date de reprise indiquée par Anthropic, ou dès que la limite est relevée dans la console API.",
    };
  }
  if (e.status === 401 || type === "authentication_error") {
    return { status: 503, code: "cle_refusee", message: "Anthropic refuse la clé ANTHROPIC_API_KEY : elle est invalide ou révoquée." };
  }
  if (e.status === 403 || type === "permission_error") {
    return { status: 503, code: "acces_refuse", message: "Anthropic refuse l'accès à ce modèle pour cette clé." };
  }
  if (e.status === 429 || type === "rate_limit_error") {
    return { status: 503, code: "debit_limite", message: "Anthropic limite le débit en ce moment. Réessaie dans une minute." };
  }
  if (e.status === 529 || type === "overloaded_error" || e.status >= 500) {
    return { status: 503, code: "modele_indisponible", message: "Le modèle est surchargé ou indisponible côté Anthropic. Réessaie dans quelques minutes." };
  }
  return {
    status: 502,
    code: "modele_refus",
    message: `Anthropic a refusé la requête (HTTP ${e.status}). Le détail est dans les journaux du serveur.`,
  };
}
