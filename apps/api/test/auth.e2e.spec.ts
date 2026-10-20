import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { agent, boot, cookieValue, PW, registerUser, resetDb } from './helpers';

describe('Authentification', () => {
  let app: INestApplication; let pool: Pool;
  beforeAll(async () => { await resetDb(); ({ app, pool } = await boot()); });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('inscrit un apprenant, ouvre une session et renvoie /me', async () => {
    const a = await registerUser(app, 'alice@example.com', 'Alice');
    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('alice@example.com');
    expect(me.body.user.roles).toEqual(['learner']);
    expect(me.body.permissions).toEqual([]);
    const row = await pool.query(`SELECT password_hash FROM users WHERE email='alice@example.com'`);
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('refuse un doublon (insensible à la casse) et un mot de passe faible', async () => {
    const dup = await agent(app).post('/api/auth/register').send({ email: 'ALICE@example.com', password: PW, displayName: 'X Y' });
    expect(dup.status).toBe(409);
    const weak = await agent(app).post('/api/auth/register').send({ email: 'bob@example.com', password: 'court', displayName: 'Bob' });
    expect(weak.status).toBe(400);
    expect(weak.body.errors[0].champ).toBe('password');
  });

  it('exige une authentification et l\'en-tête CSRF', async () => {
    expect((await request(app.getHttpServer()).get('/api/auth/me')).status).toBe(401);
    const noCsrf = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'alice@example.com', password: PW });
    expect(noCsrf.status).toBe(403);
    const badOrigin = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', 'https://evil.example').send({});
    expect(badOrigin.status).toBe(403);
  });

  it('connecte, puis rejette un mauvais mot de passe sans révéler si le compte existe', async () => {
    const ok = await agent(app).post('/api/auth/login').send({ email: 'alice@example.com', password: PW });
    expect(ok.status).toBe(200);
    const bad = await agent(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'faux-faux-faux' });
    const ghost = await agent(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'faux-faux-faux' });
    expect(bad.status).toBe(401); expect(ghost.status).toBe(401);
    expect(bad.body.message).toBe(ghost.body.message);
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe', async () => {
    await registerUser(app, 'lock@example.com', 'Lock Me');
    for (let i = 0; i < 5; i++) await agent(app).post('/api/auth/login').send({ email: 'lock@example.com', password: 'faux-faux-faux' });
    const r = await agent(app).post('/api/auth/login').send({ email: 'lock@example.com', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/verrouillé/);
  });

  it('fait tourner le refresh token et détecte sa réutilisation (session révoquée)', async () => {
    const a = await registerUser(app, 'rot@example.com', 'Rot Ate');
    const login = await agent(app).post('/api/auth/login').send({ email: 'rot@example.com', password: PW });
    const rt1 = cookieValue(login, 'cap_rt')!;
    const at1 = cookieValue(login, 'cap_at')!;

    const r2 = await request(app.getHttpServer()).post('/api/auth/refresh').set('X-CAP-CSRF', '1').set('Cookie', `cap_rt=${rt1}`);
    expect(r2.status).toBe(200);
    const rt2 = cookieValue(r2, 'cap_rt')!;
    expect(rt2).not.toBe(rt1);

    // Rejouer l'ancien jeton : refusé, et la session entière est révoquée.
    const replay = await request(app.getHttpServer()).post('/api/auth/refresh').set('X-CAP-CSRF', '1').set('Cookie', `cap_rt=${rt1}`);
    expect(replay.status).toBe(401);
    const afterReplay = await request(app.getHttpServer()).post('/api/auth/refresh').set('X-CAP-CSRF', '1').set('Cookie', `cap_rt=${rt2}`);
    expect(afterReplay.status).toBe(401);
    // L'access token de cette session ne fonctionne plus non plus.
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', `cap_at=${at1}`);
    expect(me.status).toBe(401);
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action='auth.refresh_reuse_detected'`);
    expect(audit.rowCount).toBe(1);
    void a;
  });

  it('déconnecte : la session est révoquée côté serveur', async () => {
    const a = await registerUser(app, 'out@example.com', 'Out User');
    const token = cookieValue(await agent(app).post('/api/auth/login').send({ email: 'out@example.com', password: PW }), 'cap_at')!;
    expect((await a.post('/api/auth/logout')).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(401);
    // Le jeton d'une autre session reste valide (logout ne touche que la session courante).
    expect((await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', `cap_at=${token}`)).status).toBe(200);
  });

  it('réinitialise le mot de passe : jeton à usage unique, sessions révoquées, réponse neutre', async () => {
    const a = await registerUser(app, 'reset@example.com', 'Reset Me');
    const mailer = app.get(require('../src/common/mailer.service').MailerService);
    const unknown = await agent(app).post('/api/auth/request-password-reset').send({ email: 'inconnu@example.com' });
    const known = await agent(app).post('/api/auth/request-password-reset').send({ email: 'reset@example.com' });
    expect(unknown.status).toBe(200); expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.outbox.filter((m: any) => m.to === 'inconnu@example.com')).toHaveLength(0);

    const mail = mailer.outbox.find((m: any) => m.to === 'reset@example.com');
    const token = /token=([\w-]+)/.exec(mail.text)![1];
    const NEW = 'Nouveau-Mot-De-Passe-77!';
    expect((await agent(app).post('/api/auth/reset-password').send({ token, password: NEW })).status).toBe(200);
    expect((await agent(app).post('/api/auth/reset-password').send({ token, password: NEW })).status).toBe(400);
    expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await agent(app).post('/api/auth/login').send({ email: 'reset@example.com', password: PW })).status).toBe(401);
    expect((await agent(app).post('/api/auth/login').send({ email: 'reset@example.com', password: NEW })).status).toBe(200);
  });

  it('ne stocke jamais les jetons en clair', async () => {
    const r = await pool.query(`SELECT token_hash FROM auth_tokens`);
    for (const row of r.rows) expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
