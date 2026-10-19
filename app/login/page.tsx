// app/login/page.tsx — seule page publique de l'app (avec l'endpoint du hub).
//
// MemoryAI ne se connecte pas à Google elle-même : le hub est la porte d'entrée unique.
// Cette page ne propose donc aucun bouton, elle REDIRIGE vers `hubperso.com/login` en
// emportant de quoi revenir. Elle ne s'arrête que pour DIRE une erreur, et distingue les
// cas : une authentification non configurée n'est pas un compte refusé.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { URL_HUB, urlConnexionHub } from "@/lib/connexionHub";
import { isAuthConfigured } from "@/lib/authConfigured";

export const dynamic = "force-dynamic";

/** L'origine de cette app, vue de la requête — jamais une constante. */
async function origineDeLaRequete(): Promise<string> {
  const h = await headers();
  const hote = h.get("x-forwarded-host") ?? h.get("host") ?? "memoryai.hubperso.com";
  const protocole = h.get("x-forwarded-proto") ?? "https";
  return `${protocole}://${hote}`;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const configured = isAuthConfigured();

  // ⚠️ Pas de redirection si l'auth n'est PAS configurée : sans `AUTH_SECRET`, MemoryAI ne
  // saurait pas lire le cookie que le hub lui rendrait, et on bouclerait entre les deux
  // apps indéfiniment. Mieux vaut s'arrêter ici et le dire.
  if (!error && configured) {
    redirect(urlConnexionHub(await origineDeLaRequete(), callbackUrl));
  }

  return (
    <main className="principal">
      <div className="carte carte-page carte-corps">
        <p className="surtitre">MemoryAI</p>
        <h1>Connexion</h1>

        {!configured && (
          <p className="lead">
            Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants). La
            redirection vers le hub est retenue exprès : sans ces variables, MemoryAI ne
            pourrait pas lire la session qu’il lui rendrait, et on tournerait en rond.
          </p>
        )}

        {error && (
          <p className="lead">
            Session refusée. Cette app n’admet que son propriétaire — elle n’a pas
            d’invités, par décision.
          </p>
        )}

        <p className="hint">
          <a href={URL_HUB}>Aller au hub</a>
        </p>
      </div>
    </main>
  );
}
