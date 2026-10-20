# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) — versionnage [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

## [0.1.0] - 2026-10-20
### Ajouté
- API NestJS + PostgreSQL : authentification (inscription, connexion, refresh avec rotation et détection de réutilisation, déconnexion, vérification d'e-mail, réinitialisation du mot de passe).
- Rôles et permissions (superadmin, admin, formateur, correcteur, apprenant), contrôle d'accès côté serveur.
- Administration des utilisateurs (liste, statut, rôles), journal d'audit, paramètres de la plateforme.
- Migrations SQL versionnées, Dockerfile, docker-compose de développement.
- 17 tests d'intégration, CI GitHub Actions, workflow de release.

### Limites connues
- Les e-mails ne sont pas envoyés (adaptateur de développement uniquement).
- Frontend, moteur de cours, quiz et sandbox non encore développés.
