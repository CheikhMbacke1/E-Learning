import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const q = z.object({
  action: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('admin/audit-logs')
export class AuditController {
  constructor(private db: DbService) {}

  @RequirePermissions('audit.read') @Get()
  async list(@Query(new ZodPipe(q)) f: z.infer<typeof q>) {
    const params: unknown[] = [];
    let where = '';
    if (f.action) { params.push(f.action); where = `WHERE a.action = $1`; }
    params.push(f.pageSize, (f.page - 1) * f.pageSize);
    const items = await this.db.query(
      `SELECT a.id, a.created_at, a.action, a.actor_id, u.email AS actor_email, a.target_type, a.target_id, a.metadata, a.ip
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ${where}
       ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items, page: f.page, pageSize: f.pageSize };
  }
}
