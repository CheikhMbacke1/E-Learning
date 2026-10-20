import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { config } from './common/config';

createApp().then((app) => app.listen(config().PORT)).then(() => {
  new Logger('Bootstrap').log(`API prête sur le port ${config().PORT}`);
}).catch((e) => { console.error(e.message); process.exit(1); });
