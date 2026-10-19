// lib/session.ts — revérification de session côté serveur (défense en profondeur).
//
// Le middleware garde déjà tout ce qui n'est pas explicitement public. Revérifier ICI n'est
// pas redondant : une erreur de matcher — un caractère dans une expression régulière —
// suffirait à exposer une route sans que rien ne le signale. Deux gardes indépendantes.
// Et une Server Action est un point d'entrée POST à part entière, atteignable sans la page
// qui affiche le bouton : elle revérifie, toujours. `tests/gardePages.test.ts` l'exige.

import { auth } from "@/auth";
import { cookies } from "next/headers";
import { isAuthConfigured } from "@/lib/authConfigured";
import { isAuthorizedEmail } from "@/lib/authorized";
import { identiteNouveauCookie, NOM_COOKIE_SESSION_HUB } from "@/lib/sessionAsymetrique";

export class NonAutorise extends Error {
  constructor(message = "Authentification requise.") {
    super(message);
    this.name = "NonAutorise";
  }
}

/** Exige une session valide du PROPRIÉTAIRE. Lève sinon. Échec fermé sans configuration. */
export async function requireSession(): Promise<{ email: string }> {
  if (!isAuthConfigured()) throw new NonAutorise("Authentification non configurée. Accès refusé.");

  // Plan `auth-asym-hubperso`, phase 1 : le nouveau cookie signé prime s'il est présent
  // et valide. Hubperso ne l'émet pas encore (phase 2) : cette branche ne joue nulle
  // part en production tant que ce n'est pas le cas. L'ancien chemin ci-dessous, lui,
  // n'est pas modifié.
  const cookieStore = await cookies();
  const nouveau = await identiteNouveauCookie(cookieStore.get(NOM_COOKIE_SESSION_HUB)?.value);
  if (nouveau) return nouveau;

  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!isAuthorizedEmail(email, process.env.AUTHORIZED_EMAIL)) throw new NonAutorise();
  return { email: email as string };
}
