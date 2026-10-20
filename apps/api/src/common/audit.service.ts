import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class AuditService {
  constructor(private db: DbService) {}

  /** Ne jamais passer de secrets (mots de passe, tokens) dans `metadata`. */
  async log(action: string, o: { actorId?: string | null; targetType?: string; targetId?: string; metadata?: object; ip?: string } = {}) {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [o.actorId ?? null, action, o.targetType ?? null, o.targetId ?? null, JSON.stringify(o.metadata ?? {}), o.ip ?? null],
    );
  }
}
