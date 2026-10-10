import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TimingInterceptor } from './common/timing.interceptor';
import { APP_CONFIG, AppConfig, loadDotEnv } from './config/config';

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  app.enableCors({ origin: config.CORS_ORIGIN, credentials: true });
  app.useGlobalInterceptors(new TimingInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT);
}

void bootstrap();
