// auth.ts
//
// Auth.js (NextAuth v5) SANS fournisseur. MemoryAI lit, elle n'émet pas.
//
// Depuis l'ADR 0001 de Hubperso, le hub est la porte d'entrée unique de l'écosystème :
// MemoryAI ne parle pas à Google, elle déchiffre le cookie de session posé sur
// `.hubperso.com`. Patron porté de CarAI (`carai/auth.ts`), à une différence près, et elle
// est structurelle :
//
// ── UNE APP SANS INVITÉ, JAMAIS (ADR 0001 §3, menace n° 3) ────────────────────────────
//
// Les autres apps ont DEUX étages — le propriétaire, puis `aAccesHub` qui interroge la
// liste des personnes invitées. MemoryAI n'a que le premier : elle contient des faits sur
// Marc de niveau 2 (santé, domicile, relations) que personne d'autre n'a à lire, et une
// personne admise « pour la liste d'épicerie » ne doit jamais tomber ici par le cookie
// partagé. `lib/accesHub.ts` du gabarit est donc SUPPRIMÉ, pas seulement inutilisé, et
// `tests/sansInvite.test.ts` refuse sa réintroduction.
//
// ── LE CONTRÔLE EST REJOUÉ À CHAQUE LECTURE ───────────────────────────────────────────
//
// Il n'y a pas de callback `signIn` : aucune connexion ne se fait ici, il ne tournerait
// jamais. Tout repose sur `jwt`, qui tourne à CHAQUE lecture de session. Sans lui,
// MemoryAI accepterait n'importe quelle session posée sur `.hubperso.com` par une autre
// app. Renvoyer `null` INVALIDE la session (Auth.js v5) : la middleware redirige vers
// /login, aucune donnée n'est rendue.
//
// `AUTHORIZED_EMAIL` est comparé SANS réseau : une panne du hub ne peut pas enfermer Marc
// dehors de sa propre mémoire — le seul endroit d'où il pourrait la geler ou la purger.

import NextAuth from "next-auth";
import { isAuthorizedEmail } from "@/lib/authorized";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // AUCUN FOURNISSEUR, ET C'EST LE POINT : le `client_secret` Google n'existe pas dans cet
  // environnement. Auth.js reste indispensable — c'est lui qui déchiffre le cookie et
  // expose `auth()` au garde. Les routes `/api/auth/*` continuent de servir la session et
  // la DÉCONNEXION, laquelle vaut pour toutes les apps puisque le cookie est partagé.
  providers: [],
  session: { strategy: "jwt" },
  // Cookie déclaré sur le domaine parent en production (`AUTH_COOKIE_DOMAIN=.hubperso.com`),
  // avec un `AUTH_SECRET` IDENTIQUE à celui du hub — sans lui, MemoryAI reçoit le cookie
  // mais n'en tire rien, et boucle sur /login sans erreur. Voir `lib/sessionPartagee.ts`.
  cookies: cookiesSessionPartagee(process.env.AUTH_COOKIE_DOMAIN),
  // Requis en local (sinon Auth.js lève UntrustedHost). Sans risque : aucun flux OAuth à
  // détourner ici, on ne fait que déchiffrer.
  trustHost: true,
  // `/login` n'est pas une porte mais un couloir vers le hub. Auth.js y renvoie aussi ses
  // erreurs — la page s'y arrête alors pour les DIRE au lieu de rediriger et de boucler.
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      // `user` reste dans la signature bien qu'aucune connexion locale ne le fournisse :
      // Auth.js le passe encore si une session naît par un chemin qu'on n'a pas prévu.
      if (user?.email) token.email = user.email;
      if (isAuthorizedEmail(token.email, process.env.AUTHORIZED_EMAIL)) return token;
      return null;
    },
  },
});
