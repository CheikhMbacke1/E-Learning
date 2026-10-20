/** Crée (ou promeut) le premier superadministrateur. Usage : ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create */
import * as argon2 from 'argon2';
import { Pool } from 'pg';

async function main() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('DATABASE_URL, ADMIN_EMAIL et ADMIN_PASSWORD sont requis');
  if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD : 12 caractères minimum');
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const hash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const res = await pool.query(
      `INSERT INTO users (email, password_hash, status, email_verified_at) VALUES ($1,$2,'active',now())
       ON CONFLICT ((lower(email))) WHERE deleted_at IS NULL DO UPDATE SET status='active' RETURNING id`, [email, hash]);
    const id = res.rows[0].id;
    await pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, ADMIN_NAME ?? 'Administrateur']);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code IN ('superadmin','learner') ON CONFLICT DO NOTHING`, [id]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id) VALUES ('admin.bootstrap','user',$1)`, [id]);
    console.log(`Superadministrateur prêt : ${email}`);
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
