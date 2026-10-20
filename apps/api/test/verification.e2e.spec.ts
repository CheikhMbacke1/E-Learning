import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { agent, boot, PW, resetDb } from './helpers';

describe('Vérification e-mail obligatoire', () => {
  let app: INestApplication; let pool: Pool;
  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    await resetDb(); ({ app, pool } = await boot());
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('bloque la connexion tant que l\'adresse n\'est pas confirmée, puis l\'autorise', async () => {
    const reg = await agent(app).post('/api/auth/register').send({ email: 'new@example.com', password: PW, displayName: 'New User' });
    expect(reg.status).toBe(201);
    expect(reg.body.verificationRequired).toBe(true);
    expect(reg.headers['set-cookie']).toBeUndefined();

    const early = await agent(app).post('/api/auth/login').send({ email: 'new@example.com', password: PW });
    expect(early.status).toBe(403);

    const mailer = app.get(require('../src/common/mailer.service').MailerService);
    const token = /token=([\w-]+)/.exec(mailer.outbox.find((m: any) => m.to === 'new@example.com').text)![1];
    expect((await agent(app).post('/api/auth/verify-email').send({ token: 'x'.repeat(30) })).status).toBe(400);
    expect((await agent(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);
    expect((await agent(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
    expect((await agent(app).post('/api/auth/login').send({ email: 'new@example.com', password: PW })).status).toBe(200);
  });
});
