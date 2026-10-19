<!-- Extrait de l'ancien CLAUDE.md (6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Vécu le 31/07/2026 dans l'écosystème : quatre
projets Vercel ont cessé de créer des déploiements pendant ~3 h, et un commit d'en-têtes de
sécurité est resté cinq jours en attente. Après un merge qui change ce qui est SERVI :
vérifier qu'un déploiement de production a été créé, qu'il est `READY` **sur le bon SHA**
(`meta.githubCommitSha`), puis contrôler l'effet sur la réponse HTTP réelle.

⚠️ **Aucune branche autre que `main` ne déploie de préversion** (`vercel.json`, verrou `tests/vercelJson.test.ts`) : le quota de
100 déploiements/jour est partagé entre les sept projets. Conséquence : il n'existe pas d'URL
où voir une PR avant son merge. Une PR d'interface se fusionne pour être vue.

⚠️ « Redeploy » rejoue le commit du déploiement existant, jamais le HEAD : pour faire avancer
la production, un nouveau push.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier.
