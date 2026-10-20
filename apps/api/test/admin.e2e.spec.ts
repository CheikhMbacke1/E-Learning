import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { agent, boot, giveRoles, PW, registerUser, resetDb } from './helpers';

describe('Administration et permissions', () => {
  let app: INestApplication; let pool: Pool;
  let learner: ReturnType<typeof agent>, admin: ReturnType<typeof agent>, root: ReturnType<typeof agent>, instructor: ReturnType<typeof agent>;
  const id = async (email: string) => (await pool.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id as string;

  beforeAll(async () => {
    await resetDb(); ({ app, pool } = await boot());
    learner = await registerUser(app, 'learner@example.com', 'Léa Learner');
    admin = await registerUser(app, 'admin@example.com', 'Adam Admin');
    root = await registerUser(app, 'root@example.com', 'Rita Root');
    instructor = await registerUser(app, 'teacher@example.com', 'Tom Teacher');
    await giveRoles(pool, 'admin@example.com', ['admin']);
    await giveRoles(pool, 'root@example.com', ['superadmin']);
    await giveRoles(pool, 'teacher@example.com', ['instructor']);
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('401 sans session, 403 sans permission, 200 avec permission', async () => {
    expect((await request(app.getHttpServer()).get('/api/admin/users')).status).toBe(401);
    expect((await learner.get('/api/admin/users')).status).toBe(403);
    expect((await instructor.get('/api/admin/users')).status).toBe(403);
    const r = await admin.get('/api/admin/users?pageSize=2');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    expect(r.body.items).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toMatch(/password|argon2/);
  });

  it('filtre et valide les paramètres de liste', async () => {
    expect((await admin.get('/api/admin/users?search=teacher')).body.items.map((u: any) => u.email)).toEqual(['teacher@example.com']);
    expect((await admin.get('/api/admin/users?status=nimporte')).status).toBe(400);
    expect((await admin.get('/api/admin/users/pas-un-uuid')).status).toBe(400);
  });

  it('suspend un compte : accès coupé immédiatement et connexion refusée', async () => {
    const victim = await registerUser(app, 'victim@example.com', 'Vic Tim');
    expect((await victim.get('/api/auth/me')).status).toBe(200);
    const r = await admin.patch(`/api/admin/users/${await id('victim@example.com')}/status`).send({ status: 'suspended' });
    expect(r.status).toBe(200);
    expect((await victim.get('/api/auth/me')).status).toBe(401);
    expect((await agent(app).post('/api/auth/login').send({ email: 'victim@example.com', password: PW })).status).toBe(403);
    await admin.patch(`/api/admin/users/${await id('victim@example.com')}/status`).send({ status: 'active' });
    expect((await agent(app).post('/api/auth/login').send({ email: 'victim@example.com', password: PW })).status).toBe(200);
  });

  it('empêche un admin de toucher un compte privilégié ou le sien', async () => {
    expect((await admin.patch(`/api/admin/users/${await id('root@example.com')}/status`).send({ status: 'disabled' })).status).toBe(403);
    expect((await admin.patch(`/api/admin/users/${await id('admin@example.com')}/status`).send({ status: 'disabled' })).status).toBe(403);
    expect((await admin.put(`/api/admin/users/${await id('learner@example.com')}/roles`).send({ roles: ['admin'] })).status).toBe(403);
    expect((await admin.put(`/api/admin/users/${await id('admin@example.com')}/roles`).send({ roles: ['superadmin'] })).status).toBe(403);
  });

  it('un admin attribue des rôles non privilégiés ; un superadmin peut nommer un admin ; tout est audité', async () => {
    const lid = await id('learner@example.com');
    const r = await admin.put(`/api/admin/users/${lid}/roles`).send({ roles: ['learner', 'instructor'] });
    expect(r.status).toBe(200);
    // Les permissions suivent immédiatement le changement de rôle.
    expect((await learner.get('/api/auth/me')).body.permissions).toContain('courses.create');
    expect((await root.put(`/api/admin/users/${lid}/roles`).send({ roles: ['admin'] })).status).toBe(200);
    expect((await root.put(`/api/admin/users/${lid}/roles`).send({ roles: [] })).status).toBe(400);
    expect((await root.put(`/api/admin/users/${lid}/roles`).send({ roles: ['pirate'] })).status).toBe(400);
    const logs = await root.get('/api/admin/audit-logs?action=user.roles_changed');
    expect(logs.status).toBe(200);
    expect(logs.body.items.length).toBeGreaterThanOrEqual(2);
    expect((await instructor.get('/api/admin/audit-logs')).status).toBe(403);
  });

  it('paramètres : lecture publique, écriture réservée', async () => {
    const pub = await request(app.getHttpServer()).get('/api/settings/public');
    expect(pub.body.platform_name).toBe('CodeAcademy Pro');
    expect((await instructor.patch('/api/admin/settings').send({ platform_name: 'Pirate' })).status).toBe(403);
    const r = await root.patch('/api/admin/settings').send({ platform_name: 'Académie Teranga' });
    expect(r.body.platform_name).toBe('Académie Teranga');
    expect((await root.patch('/api/admin/settings').send({})).status).toBe(400);
  });

  it('expose un health check public', async () => {
    const r = await request(app.getHttpServer()).get('/api/health');
    expect(r.body).toEqual({ status: 'ok', db: 'ok' });
  });
});
