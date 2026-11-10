import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { resolve } from 'path';
import { RazorpayProvider } from './modules/payments/razorpay.provider';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Fail fast on key-mode mismatch (test keys in production, live keys in
  // preview) before serving a single payment-capable request.
  app.get(RazorpayProvider).assertKeyMode();
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // TLS terminates at the hosting edge, which appends the real client IP to
  // X-Forwarded-For. Trust exactly one hop so req.ip (rate limiting) is
  // correct; trusting more would let clients spoof their own IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // rawBody supports HMAC webhook signatures (Razorpay); JSON parsing is unchanged.
  app.use(json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  if (process.env.NODE_ENV !== 'production') {
    app.useStaticAssets(resolve(process.env.UPLOAD_DIR ?? 'uploads', 'avatars'), { prefix: '/uploads/avatars/', index: false, dotfiles: 'deny', maxAge: '1d', setHeaders: response => response.setHeader('X-Content-Type-Options', 'nosniff') });
  }
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
  }

  app.setGlobalPrefix('api/v1');
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  if (isProduction && allowedOrigins.length === 0) {
    console.warn('[cors] CORS_ORIGINS is empty: browser clients (admin panel) will be blocked; mobile apps are unaffected.');
  }
  app.enableCors({
    origin: isProduction ? allowedOrigins : true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 NAHTREEK Central Backend API running on port ${port} (/api/v1)`);
}

bootstrap();
