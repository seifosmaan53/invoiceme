import { Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SYNC_REQUIRED_TRIGGERS, SYNC_SCHEMA_SQL } from './sync-schema';

/**
 * Makes sure the revision and tombstone triggers exist before sync accepts
 * writes. Revisions and tombstones are the evidence conflict detection relies
 * on; without the triggers a stale write would look current, so sync writes
 * are refused (503) rather than processed without that evidence.
 *
 * - DB_SYNCHRONIZE=true (tests, local development): tables come from the
 *   entities, so the functions and triggers are installed here.
 * - Otherwise: migration 019 must have been applied; this only checks the
 *   live database (pg_trigger), never a recorded fingerprint.
 */
@Injectable()
export class SyncSchemaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncSchemaService.name);
  private ready = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('DB_SYNCHRONIZE') === 'true') {
      await this.dataSource.query(SYNC_SCHEMA_SQL);
    }
    await this.check();
    if (!this.ready) {
      this.logger.error(
        'Sync triggers from migrations 019/021 are missing: sync writes, protocol-2 pulls and conflict resolution are disabled until they are applied',
      );
    }
  }

  private async check(): Promise<void> {
    const rows: Array<{ table: string; name: string }> = await this.dataSource.query(
      `SELECT c.relname AS table, t.tgname AS name
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relnamespace = current_schema()::regnamespace`,
    );
    const present = new Set(rows.map((row) => `${row.table}.${row.name}`));
    this.ready = SYNC_REQUIRED_TRIGGERS.every((t) => present.has(`${t.table}.${t.name}`));
  }

  /** Throws 503 unless the triggers were found (checked again if not). */
  async assertReady(): Promise<void> {
    if (!this.ready) await this.check();
    if (!this.ready) {
      throw new ServiceUnavailableException('Sync is unavailable: the server database is missing migration 019 or 021');
    }
  }
}
