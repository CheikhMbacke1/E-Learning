import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../db/db.service';
import { AuthUser } from './auth.types';

export const ACCESS_COOKIE = 'cap_at';
export const REFRESH_COOKIE = 'cap_rt';

/**
 * Garde globale : toute route exige une authentification, sauf @Public().
 * L'état (statut du compte, session révoquée, rôles, permissions) est relu en base à CHAQUE requête :
 * une suspension ou une révocation prend donc effet immédiatement, sans attendre l'expiration du JWT.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handlers = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', handlers);
    const req = ctx.switchToHttp().getRequest();

    const header: string | undefined = req.headers.authorization;
    const token = req.cookies?.[ACCESS_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (token) {
      try {
        const p = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token);
        const user = await this.loadUser(p.sub, p.sid);
        if (user) req.user = user;
      } catch { /* jeton invalide : traité comme non authentifié */ }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Authentification requise');

    const needed = this.reflector.getAllAndOverride<string[] | undefined>('permissions', handlers);
    if (needed?.length) {
      const u = req.user as AuthUser;
      if (!needed.every((p) => u.permissions.includes(p))) throw new ForbiddenException('Permission insuffisante');
    }
    return true;
  }

  private async loadUser(userId: string, sessionId: string): Promise<AuthUser | null> {
    const row = await this.db.one<{ id: string; email: string; status: string; roles: string[]; permissions: string[] }>(
      `SELECT u.id, u.email, u.status,
         COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
         COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'active' AND u.deleted_at IS NULL
       GROUP BY u.id`,
      [sessionId, userId],
    );
    return row ? { ...row, sessionId } : null;
  }
}
