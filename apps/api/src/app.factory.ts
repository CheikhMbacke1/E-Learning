import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './common/config';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: config().NODE_ENV === 'test' ? false : undefined });
  app.setGlobalPrefix('api');
  // Derrière un reverse proxy (Caddy/Traefik) : 1 saut de confiance pour obtenir la vraie IP client.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config().WEB_ORIGIN.split(',').map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();
  return app;
}
