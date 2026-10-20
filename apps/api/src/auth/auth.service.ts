import { ConflictException, ForbiddenException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import { randomToken, sha256 } from '../common/crypto';
import { MailerService } from '../common/mailer.service';
import { DbService } from '../db/db.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 60;
const VERIFY_TTL_H = 48;

export interface Tokens { accessToken: string; refreshToken: string; refreshExpiresAt: Date }
interface Ctx { ip?: string; userAgent?: string }

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(private db: DbService, private jwt: JwtService, private audit: AuditService, private mailer: MailerService) {}

  private hash(pw: string) { return argon2.hash(pw, { type: argon2.argon2id }); }

  async register(dto: { email: string; password: string; displayName: string }, ctx: Ctx) {
    const requireVerif = config().REQUIRE_EMAIL_VERIFICATION === 'true';
    const hash = await this.hash(dto.password);
    let userId: string;
    try {
      userId = await this.db.tx(async (c) => {
        const u = await c.query(
          `INSERT INTO users (email, password_hash, status) VALUES ($1,$2,$3) RETURNING id`,
          [dto.email, hash, requireVerif ? 'pending' : 'active'],
        );
        const id = u.rows[0].id as string;
        await c.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`, [id, dto.displayName]);
        await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code='learner'`, [id]);
        return id;
      });
    } catch (e: any) {
      // Compromis assumé : on signale le doublon (meilleure UX) au prix d'une énumération possible des comptes ;
      // le rate limiting réduit le risque. À durcir si la plateforme le requiert.
      if (e.code === '23505') throw new ConflictException('Cette adresse e-mail est déjà utilisée');
      throw e;
    }
    await this.audit.log('auth.register', { actorId: userId, targetType: 'user', targetId: userId, ip: ctx.ip });
    if (requireVerif) {
      await this.sendVerification(userId, dto.email);
      return { verificationRequired: true as const };
    }
    return { verificationRequired: false as const, userId, tokens: await this.createSession(userId, ctx) };
  }

  private async sendVerification(userId: string, email: string) {
    const token = randomToken();
    await this.db.query(`DELETE FROM auth_tokens WHERE user_id=$1 AND kind='email_verify' AND used_at IS NULL`, [userId]);
    await this.db.query(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,'email_verify',$2, now() + make_interval(hours => $3))`,
      [userId, sha256(token), VERIFY_TTL_H],
    );
    await this.mailer.send(email, 'Confirmez votre adresse e-mail',
      `Ouvrez ce lien pour confirmer votre compte : ${config().WEB_ORIGIN.split(',')[0]}/verifier-email?token=${token}`);
  }

  async verifyEmail(token: string) {
    const row = await this.db.one<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now()
       WHERE token_hash=$1 AND kind='email_verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)],
    );
    if (!row) throw new BadRequestException('Lien invalide ou expiré');
    await this.db.query(
      `UPDATE users SET email_verified_at = now(), status = CASE WHEN status='pending' THEN 'active' ELSE status END, updated_at = now() WHERE id=$1`,
      [row.user_id],
    );
    await this.audit.log('auth.email_verified', { actorId: row.user_id, targetType: 'user', targetId: row.user_id });
  }

  async login(email: string, password: string, ctx: Ctx) {
    const user = await this.db.one<any>(`SELECT * FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL`, [email]);
    if (!user) {
      // Égalise le temps de réponse pour ne pas révéler l'existence du compte.
      this.dummyHash ??= this.hash('dummy-password-for-timing');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      await this.audit.log('auth.login_failed', { metadata: { reason: 'unknown_user' }, ip: ctx.ip });
      throw new UnauthorizedException('Identifiants incorrects');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new ForbiddenException('Compte temporairement verrouillé après trop de tentatives. Réessayez plus tard.');
    }
    const ok = await argon2.verify(user.password_hash, password).catch(() => false);
    if (!ok) {
      const r = await this.db.one<{ failed_login_count: number }>(
        `UPDATE users SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id=$1 RETURNING failed_login_count`, [user.id, MAX_FAILED, LOCK_MINUTES]);
      await this.audit.log('auth.login_failed', { actorId: user.id, metadata: { reason: 'bad_password', attempts: r?.failed_login_count }, ip: ctx.ip });
      throw new UnauthorizedException('Identifiants incorrects');
    }
    // Le statut n'est révélé qu'après un mot de passe correct.
    if (user.status === 'pending') throw new ForbiddenException('Adresse e-mail non vérifiée. Consultez votre boîte de réception.');
    if (user.status !== 'active') throw new ForbiddenException('Ce compte est suspendu ou désactivé. Contactez un administrateur.');

    await this.db.query(`UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=now() WHERE id=$1`, [user.id]);
    await this.audit.log('auth.login', { actorId: user.id, ip: ctx.ip });
    return { userId: user.id as string, tokens: await this.createSession(user.id, ctx) };
  }

  private async issue(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: config().ACCESS_TOKEN_TTL_SECONDS });
  }

  private async createSession(userId: string, ctx: Ctx): Promise<Tokens> {
    const refreshToken = randomToken();
    const row = await this.db.one<{ id: string; expires_at: Date }>(
      `INSERT INTO sessions (user_id, refresh_hash, user_agent, ip, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING id, expires_at`,
      [userId, sha256(refreshToken), ctx.userAgent?.slice(0, 300) ?? null, ctx.ip ?? null, config().REFRESH_TOKEN_TTL_DAYS],
    );
    return { accessToken: await this.issue(userId, row!.id), refreshToken, refreshExpiresAt: row!.expires_at };
  }

  /** Rotation du refresh token. Présenter un ancien jeton déjà tourné = vol probable → la session est révoquée. */
  async refresh(refreshToken: string | undefined, ctx: Ctx): Promise<Tokens> {
    if (!refreshToken) throw new UnauthorizedException('Session expirée');
    const h = sha256(refreshToken);
    const reused = await this.db.one<{ id: string; user_id: string }>(
      `UPDATE sessions SET revoked_at = now() WHERE previous_refresh_hash=$1 AND revoked_at IS NULL RETURNING id, user_id`, [h]);
    if (reused) {
      await this.audit.log('auth.refresh_reuse_detected', { actorId: reused.user_id, targetType: 'session', targetId: reused.id, ip: ctx.ip });
      throw new UnauthorizedException('Session expirée');
    }
    const next = randomToken();
    const row = await this.db.one<{ id: string; user_id: string; expires_at: Date }>(
      `UPDATE sessions s SET previous_refresh_hash = s.refresh_hash, refresh_hash = $2, last_used_at = now()
       FROM users u
       WHERE s.refresh_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.id = s.user_id AND u.status='active' AND u.deleted_at IS NULL
       RETURNING s.id, s.user_id, s.expires_at`,
      [h, sha256(next)],
    );
    if (!row) throw new UnauthorizedException('Session expirée');
    return { accessToken: await this.issue(row.user_id, row.id), refreshToken: next, refreshExpiresAt: row.expires_at };
  }

  async logout(sessionId: string) {
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL`, [sessionId]);
  }

  async requestPasswordReset(email: string, ctx: Ctx) {
    const user = await this.db.one<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE lower(email)=lower($1) AND status IN ('active','pending') AND deleted_at IS NULL`, [email]);
    if (!user) return; // réponse identique dans tous les cas (pas d'énumération)
    const token = randomToken();
    await this.db.query(`DELETE FROM auth_tokens WHERE user_id=$1 AND kind='password_reset' AND used_at IS NULL`, [user.id]);
    await this.db.query(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,'password_reset',$2, now() + make_interval(mins => $3))`,
      [user.id, sha256(token), RESET_TTL_MIN]);
    await this.audit.log('auth.password_reset_requested', { actorId: user.id, ip: ctx.ip });
    await this.mailer.send(user.email, 'Réinitialisation de votre mot de passe',
      `Ouvrez ce lien (valable ${RESET_TTL_MIN} minutes) : ${config().WEB_ORIGIN.split(',')[0]}/reinitialiser-mot-de-passe?token=${token}`);
  }

  async resetPassword(token: string, newPassword: string, ctx: Ctx) {
    const hash = await this.hash(newPassword);
    const userId = await this.db.tx(async (c) => {
      const t = await c.query(
        `UPDATE auth_tokens SET used_at = now()
         WHERE token_hash=$1 AND kind='password_reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(token)]);
      if (!t.rows[0]) throw new BadRequestException('Lien invalide ou expiré');
      const id = t.rows[0].user_id as string;
      await c.query(`UPDATE users SET password_hash=$2, failed_login_count=0, locked_until=NULL, updated_at=now() WHERE id=$1`, [id, hash]);
      await c.query(`UPDATE sessions SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
      return id;
    });
    await this.audit.log('auth.password_reset', { actorId: userId, ip: ctx.ip });
  }

  async me(userId: string) {
    return this.db.one(
      `SELECT u.id, u.email, u.status, u.locale, u.email_verified_at, p.display_name, p.avatar_url,
         COALESCE((SELECT array_agg(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id=$1`, [userId]);
  }
}
