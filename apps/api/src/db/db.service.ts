import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../common/config';

@Injectable()
export class DbService implements OnApplicationShutdown {
  readonly pool = new Pool({ connectionString: config().DATABASE_URL, max: 10 });

  async query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(text, params)).rows;
  }
  async one<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(text, params))[0] ?? null;
  }
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async onApplicationShutdown() { await this.pool.end(); }
}
