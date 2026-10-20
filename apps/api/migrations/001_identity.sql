-- 001 : identité, rôles, permissions, sessions, audit, paramètres
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended','disabled')),
  email_verified_at TIMESTAMPTZ,
  locale TEXT NOT NULL DEFAULT 'fr',
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  country TEXT,
  timezone TEXT,
  leaderboard_opt_in BOOLEAN NOT NULL DEFAULT false
);

-- Une ligne par session ; le refresh token n'est stocké que haché.
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  previous_refresh_hash TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX sessions_refresh_hash_uq ON sessions (refresh_hash);
CREATE INDEX sessions_prev_hash_idx ON sessions (previous_refresh_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email_verify','password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_kind_idx ON auth_tokens (user_id, kind);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES
  ('platform_name', '"CodeAcademy Pro"'),
  ('default_locale', '"fr"');

INSERT INTO roles (code, label) VALUES
  ('superadmin','Superadministrateur'),
  ('admin','Administrateur'),
  ('instructor','Formateur'),
  ('reviewer','Correcteur'),
  ('learner','Apprenant');

-- Les permissions des modules suivants seront ajoutées par leurs propres migrations.
INSERT INTO permissions (code, description) VALUES
  ('users.read','Consulter les utilisateurs'),
  ('users.manage','Activer, suspendre, désactiver des comptes'),
  ('users.assign_roles','Attribuer des rôles'),
  ('settings.manage','Modifier les paramètres généraux'),
  ('audit.read','Consulter le journal d''audit'),
  ('courses.create','Créer des formations'),
  ('courses.edit_own','Modifier ses propres formations'),
  ('courses.edit_any','Modifier toutes les formations'),
  ('courses.publish','Publier des formations'),
  ('quizzes.manage','Gérer les quiz et banques de questions'),
  ('reviews.grade','Corriger les projets'),
  ('content.moderate','Modérer les discussions');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
  r.code IN ('superadmin','admin')
  OR (r.code = 'instructor' AND p.code IN ('courses.create','courses.edit_own','quizzes.manage'))
  OR (r.code = 'reviewer' AND p.code = 'reviews.grade');
