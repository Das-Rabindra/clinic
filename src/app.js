import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config/env.js';
import { securityHeaders } from './middleware/security.js';
import { loadSession } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';

import publicRoutes from './routes/public.routes.js';
import publicApi from './routes/api/public.routes.js';
import authApi from './routes/api/auth.routes.js';
import adminApi from './routes/admin/index.js';
import adminPages from './routes/admin.pages.js';
import oauthRoutes from './routes/oauth.routes.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());
  app.use(loadSession);

  /* Static assets. Uploaded media is served read-only with a long cache; the
     filenames are content-hashed so they can be cached aggressively. */
  app.use(express.static(path.join(root, '..', 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    etag: true,
  }));
  app.use('/media', express.static(config.paths.uploadDir, {
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
    setHeaders(res) {
      // Never let an uploaded file be interpreted as active content.
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', 'inline');
    },
  }));

  app.use('/api/auth', authApi);
  app.use('/api/admin', adminApi);
  app.use('/api', publicApi);
  app.use('/oauth', oauthRoutes);
  app.use('/admin', adminPages);
  app.use('/', publicRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
