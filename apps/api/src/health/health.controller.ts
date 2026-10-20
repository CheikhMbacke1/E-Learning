import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { DbService } from '../db/db.service';

@Controller('health')
export class HealthController {
  constructor(private db: DbService) {}
  @Public() @Get()
  async check() {
    try { await this.db.query('SELECT 1'); } catch { throw new ServiceUnavailableException({ status: 'down', db: 'down' }); }
    return { status: 'ok', db: 'ok' };
  }
}
