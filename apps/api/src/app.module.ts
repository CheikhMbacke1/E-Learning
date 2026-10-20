import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditController } from './admin/audit.controller';
import { UsersAdminController } from './admin/users.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/csrf.guard';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { SettingsController } from './settings/settings.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]), DbModule, CommonModule, AuthModule],
  controllers: [UsersAdminController, AuditController, SettingsController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
