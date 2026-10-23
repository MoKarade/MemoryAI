// components/LogoMemoire.tsx — le logo de MemoryAI (série A) : trois strates, la plus haute
// porte l'étincelle de l'IA. Le même dans l'en-tête de l'accueil et dans celui de la Mémoire.

export function LogoMemoire() {
  return (
    <svg className="maison-logo" viewBox="0 0 64 64" role="img" aria-label="MemoryAI">
      <path className="maison-logo-corps" d="M7 42L32 55L57 42M7 32L32 45L57 32" />
      <path className="maison-logo-masse" d="M32 9L57 22L32 35L7 22Z" />
      <path className="maison-logo-corps" d="M32 9L57 22L32 35L7 22Z" />
      <path className="maison-logo-ia" d="M32 14Q33.28 20.72 40 22Q33.28 23.28 32 30Q30.72 23.28 24 22Q30.72 20.72 32 14Z" />
    </svg>
  );
}
