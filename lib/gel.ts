// lib/gel.ts — le kill-switch de la Mémoire (ADR 0001 §3).
//
// `MEMORYAI_GEL=1` ⇒ toute route MACHINE répond 503 « mémoire gelée » : le serveur MCP,
// `POST /api/faits`, `POST /api/contexte`, le chat. L'interface, elle, reste lisible : geler
// sert à ARRÊTER de servir et d'écrire sans perdre la possibilité de regarder ce qu'il y a.
//
// Fonction PURE : l'environnement est un paramètre, pour que le test exerce les deux sens
// sans toucher `process.env`. Seule la valeur « 1 » gèle — un « true », un « oui » ou un
// « 0 » ne gèlent pas, et c'est voulu : un kill-switch qui interprète large finit par
// s'allumer par accident, et un kill-switch allumé par accident finit par être retiré.

type Env = Record<string, string | undefined>;

export function estGele(env: Env = process.env): boolean {
  return env.MEMORYAI_GEL?.trim() === "1";
}

/** La réponse que toute route machine rend quand la mémoire est gelée. */
export function reponseGelee(): Response {
  return Response.json(
    {
      error: "memoire_gelee",
      message: "MemoryAI est gelée (MEMORYAI_GEL=1) : rien n'est servi ni écrit.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
