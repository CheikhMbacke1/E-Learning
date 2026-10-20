import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const schema = z.object({
  platform_name: z.string().trim().min(2).max(60).optional(),
  default_locale: z.enum(['fr', 'en']).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Aucun paramètre fourni');

@Controller()
export class SettingsController {
  constructor(private db: DbService, private audit: AuditService) {}

  private async all() {
    const rows = await this.db.query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings`);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Public() @Get('settings/public')
  publicSettings() { return this.all(); }

  @RequirePermissions('settings.manage') @Patch('admin/settings')
  async update(@Body(new ZodPipe(schema)) body: z.infer<typeof schema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    for (const [k, v] of Object.entries(body)) {
      await this.db.query(
        `INSERT INTO platform_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
        [k, JSON.stringify(v)]);
    }
    await this.audit.log('settings.updated', { actorId: u.id, metadata: body, ip: req.ip });
    return this.all();
  }
}
