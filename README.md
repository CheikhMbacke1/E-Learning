# CodeAcademy Pro — Phase 1 : fondations

API NestJS + PostgreSQL : authentification, rôles/permissions, administration des utilisateurs, journal d'audit, paramètres.
Le frontend (Next.js), le moteur de cours, les quiz et les sandbox arrivent dans les phases suivantes : **rien de cela n'existe encore**.

## Prérequis
Node 22+, PostgreSQL 16 (ou Docker).

## Lancement local (sans Docker)
```bash
npm install
cd apps/api
cp .env.example .env        # renseigner DATABASE_URL et JWT_SECRET (openssl rand -base64 48)
set -a; . ./.env; set +a
npm run db:migrate
ADMIN_EMAIL=vous@exemple.com ADMIN_PASSWORD='12-caracteres-min' npm run admin:create
npm run start:dev           # http://localhost:4000/api/health
```

## Avec Docker Compose (non testé dans mon environnement)
```bash
cp .env.example .env        # remplir POSTGRES_PASSWORD et JWT_SECRET
docker compose up --build -d
docker compose exec api node -e "require('./dist/db/migrator').migrate(process.env.DATABASE_URL).then(console.log)"
```
Le premier administrateur se crée avec `npm run admin:create` depuis la machine hôte (base exposée sur 127.0.0.1:5432).

## Tests
Base PostgreSQL locale avec un utilisateur autorisé à créer des bases (`CREATEDB`). Chaque fichier de test recrée `cap_test`.
```bash
DATABASE_URL=postgresql://USER:PWD@localhost:5432/cap_test ADMIN_DB_URL=postgresql://USER:PWD@localhost:5432/postgres npm run api:test
```

## API (préfixe /api)
| Route | Accès |
|---|---|
| POST auth/register, auth/login, auth/refresh, auth/verify-email, auth/request-password-reset, auth/reset-password | public |
| POST auth/logout, GET auth/me | connecté |
| GET admin/users, GET admin/users/:id | users.read |
| PATCH admin/users/:id/status | users.manage |
| PUT admin/users/:id/roles | users.assign_roles |
| GET admin/audit-logs | audit.read |
| GET settings/public · PATCH admin/settings | public · settings.manage |
| GET health | public |

Les requêtes modifiantes doivent porter l'en-tête `X-CAP-CSRF: 1` (ou une `Origin` autorisée par `WEB_ORIGIN`).

## Choix de sécurité
- Mots de passe : argon2id. Verrouillage 15 min après 5 échecs. Limitation de débit sur les routes d'authentification.
- Sessions : JWT d'accès 15 min + refresh token opaque en base (haché), rotation à chaque usage, **révocation de la session si un ancien jeton est rejoué**. Cookies `HttpOnly`, `SameSite=Lax`, `Secure` en production.
- Statut, rôles et session sont relus en base à chaque requête : suspension et changement de rôle sont immédiats.
- Seul un superadministrateur peut attribuer/retirer `admin`/`superadmin` ou modifier un compte privilégié ; personne ne modifie son propre statut ou ses rôles.
- Jetons de vérification/réinitialisation : usage unique, expirants, stockés hachés.
- Compromis connu : l'inscription signale un e-mail déjà utilisé (énumération possible, atténuée par le rate limiting).

## Limites actuelles
- **E-mails non envoyés** : l'adaptateur journalise en développement uniquement ; en production rien n'est envoyé. Avec `REQUIRE_EMAIL_VERIFICATION=true`, il faut d'abord brancher un fournisseur réel.
- Pas de 2FA, pas de suppression/export RGPD des données personnelles (prévus).
- ORM : migrations SQL versionnées + `pg` (pas de Prisma pour l'instant).
- Docker/Compose écrits mais **non exécutés** ici.
