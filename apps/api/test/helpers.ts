import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { migrate } from '../src/db/migrator';

/** Recrée une base de test vierge et applique les migrations. */
export async function resetDb() {
  const admin = new Pool({ connectionString: process.env.ADMIN_DB_URL });
  const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  await migrate(process.env.DATABASE_URL!);
}

export async function boot(): Promise<{ app: INestApplication; pool: Pool }> {
  // Import tardif : la config est lue au premier import, après que les variables d'env du test sont posées.
  const { createApp } = require('../src/app.factory');
  const app: INestApplication = await createApp();
  await app.init();
  return { app, pool: new Pool({ connectionString: process.env.DATABASE_URL }) };
}

export const PW = 'Un-Mot-De-Passe-Solide-42';

/** Agent supertest qui conserve les cookies et envoie l'en-tête CSRF. */
export function agent(app: INestApplication) {
  const a = request.agent(app.getHttpServer());
  a.set('X-CAP-CSRF', '1');
  return a;
}

export async function registerUser(app: INestApplication, email: string, displayName = 'Test User') {
  const a = agent(app);
  const r = await a.post('/api/auth/register').send({ email, password: PW, displayName });
  if (r.status !== 201) throw new Error(`register ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return a;
}

export async function giveRoles(pool: Pool, email: string, roles: string[]) {
  await pool.query(`DELETE FROM user_roles WHERE user_id=(SELECT id FROM users WHERE email=$1)`, [email]);
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT (SELECT id FROM users WHERE email=$1), id FROM roles WHERE code = ANY($2)`,
    [email, roles]);
}

export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as any) ?? []).find((c) => c.startsWith(name + '='));
  return raw?.split(';')[0].split('=').slice(1).join('=');
}
