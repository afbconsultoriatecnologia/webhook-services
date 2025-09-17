import rateLimit from 'express-rate-limit';
import { config } from '../config/app.config';

/**
 * Rate limiter para endpoints de processamento
 */
export const processRateLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMaxRequests,
  message: 'Muitas requisições. Tente novamente mais tarde.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip para testes locais
  skip: (req) => {
    return config.app.env === 'development' && req.ip === '::1';
  },
});

/**
 * Rate limiter mais permissivo para endpoints de consulta
 */
export const queryRateLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMaxRequests * 3, // 3x mais permissivo
  message: 'Muitas requisições. Tente novamente mais tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});