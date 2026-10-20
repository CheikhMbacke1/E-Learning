import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { DbService } from '../db/db.service';

const idSchema = z.string().uuid();
const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'disabled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const statusSchema = z.object({ status: z.enum(['active', 'suspended', 'disabled']) });
const ROLE_CODES = ['superadmin', 'admin', 'instructor', 'reviewer', 'learner'] as const;
const rolesSchema = z.object({ roles: z.array(z.enum(ROLE_CODES)).min(1, 'Au moins un rôle').max(5) });
const PRIVILEGED = ['superadmin', 'admin'];

@Controller('admin/users')
export class UsersAdminController {
  constructor(private db: DbService, private audit: AuditService) {}

  @RequirePermissions('users.read') @Get()
  async list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const where: string[] = ['u.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.status) { params.push(q.status); where.push(`u.status = $${params.length}`); }
    if (q.search) {
      params.push(`%${q.search.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(u.email ILIKE $${params.length} OR p.display_name ILIKE $${params.length})`);
    }
    const w = where.join(' AND ');
    const total = (await this.db.one<{ n: string }>(
      `SELECT count(*) n FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE ${w}`, params))!.n;
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const items = await this.db.query(
      `SELECT u.id, u.email, u.status, u.created_at, u.last_login_at, p.display_name,
         COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id), '{}') AS roles
       FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE ${w}
       ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
  }

  private async target(id: string) {
    if (!idSchema.safeParse(id).success) throw new BadRequestException('Identifiant invalide');
    const t = await this.db.one<{ id: string; email: string; status: string; roles: string[] }>(
      `SELECT u.id, u.email, u.status,
         COALESCE((SELECT array_agg(r.code) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id), '{}') AS roles
       FROM users u WHERE u.id=$1 AND u.deleted_at IS NULL`, [id]);
    if (!t) throw new NotFoundException('Utilisateur introuvable');
    return t;
  }

  @RequirePermissions('users.read') @Get(':id')
  async get(@Param('id') id: string) { return this.target(id); }

  @RequirePermissions('users.manage') @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>,
                  @CurrentUser() actor: AuthUser, @Req() req: Request) {
    const t = await this.target(id);
    if (t.id === actor.id) throw new ForbiddenException('Vous ne pouvez pas modifier le statut de votre propre compte');
    if (t.roles.some((r) => PRIVILEGED.includes(r)) && !actor.roles.includes('superadmin'))
      throw new ForbiddenException('Seul un superadministrateur peut modifier un compte administrateur');
    await this.db.tx(async (c) => {
      await c.query(`UPDATE users SET status=$2, updated_at=now() WHERE id=$1`, [id, body.status]);
      if (body.status !== 'active') await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
    });
    await this.audit.log('user.status_changed', { actorId: actor.id, targetType: 'user', targetId: id, metadata: { from: t.status, to: body.status }, ip: req.ip });
    return { id, status: body.status };
  }

  @RequirePermissions('users.assign_roles') @Put(':id/roles')
  async setRoles(@Param('id') id: string, @Body(new ZodPipe(rolesSchema)) body: z.infer<typeof rolesSchema>,
                 @CurrentUser() actor: AuthUser, @Req() req: Request) {
    const t = await this.target(id);
    if (t.id === actor.id) throw new ForbiddenException('Vous ne pouvez pas modifier vos propres rôles');
    const next: string[] = [...new Set(body.roles)];
    const touchesPrivileged = PRIVILEGED.some((r) => next.includes(r) !== t.roles.includes(r));
    if (touchesPrivileged && !actor.roles.includes('superadmin'))
      throw new ForbiddenException('Seul un superadministrateur peut attribuer ou retirer les rôles administrateur');
    await this.db.tx(async (c) => {
      if (t.roles.includes('superadmin') && !next.includes('superadmin')) {
        const n = await c.query(`SELECT count(*)::int n FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id
                                 WHERE r.code='superadmin' AND u.status='active' AND u.deleted_at IS NULL`);
        if (n.rows[0].n <= 1) throw new ForbiddenException('Impossible de retirer le dernier superadministrateur');
      }
      await c.query(`DELETE FROM user_roles WHERE user_id=$1`, [id]);
      await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = ANY($2)`, [id, next]);
    });
    await this.audit.log('user.roles_changed', { actorId: actor.id, targetType: 'user', targetId: id, metadata: { from: t.roles, to: next }, ip: req.ip });
    return { id, roles: next };
  }
}
