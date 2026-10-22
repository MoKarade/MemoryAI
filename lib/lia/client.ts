// lib/lia/client.ts — le `ask` que `@mokarade/lia-ui` appelle, côté navigateur, dans la maison.
//
// Parle à la route de MemoryAI (même origine, cookie de session), jamais au hub : aucun jeton dans
// le navigateur. Toute erreur devient un rejet : le paquet affiche alors « indisponible » (échec
// fermé), jamais une réponse inventée. Les blocs passent tels quels : `rendreBlocs` les revérifie.

import { z } from "zod";

const ReponseMaison = z.object({
  text: z.string().min(1).max(8000),
  blocks: z.array(z.unknown()).max(20).optional(),
});
export type ReponseMaison = z.infer<typeof ReponseMaison>;

export async function demanderLia(
  question: string,
  signal: AbortSignal,
  { fetchImpl = fetch, page = "/" }: { fetchImpl?: typeof fetch; page?: string } = {},
): Promise<ReponseMaison> {
  const reponse = await fetchImpl("/api/lia/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, page }),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!reponse.ok) throw new Error(`LIA indisponible (${reponse.status})`);
  const lue = ReponseMaison.safeParse(await reponse.json());
  if (!lue.success) throw new Error("LIA indisponible (réponse non conforme)");
  return lue.data;
}
