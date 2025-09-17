import { Request, Response, NextFunction } from 'express';
import { config } from '../config/app.config';
import { logger } from '../config/logger.config';

interface AuthRequest extends Request {
  integration?: string;
}

/**
 * Middleware de autenticação por Bearer Token
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).json({ error: 'Token não fornecido' });
      return;
    }

    const [scheme, token] = authHeader.split(' ');
    
    if (scheme !== 'Bearer') {
      res.status(401).json({ error: 'Formato de token inválido' });
      return;
    }

    // Por enquanto, apenas STT
    if (token === config.stt.cronToken) {
      req.integration = 'stt';
      logger.info('Autenticação bem-sucedida', {
        integration: 'stt',
        ip: req.ip,
        path: req.path,
      });
      next();
      return;
    }

    res.status(401).json({ error: 'Token inválido' });
    
  } catch (error) {
    logger.error('Erro na autenticação', { error: error.message });
    res.status(500).json({ error: 'Erro interno na autenticação' });
  }
}

/**
 * Middleware para verificar IPs permitidos
 */
export function ipWhitelistMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const allowedIPs = config.security.allowedIPs;

  // Permitir localhost IPv4 e IPv6
  const localhostIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  
  if (allowedIPs.includes(clientIp) || localhostIPs.includes(clientIp)) {
    next();
    return;
  }

  logger.warn('Acesso negado - IP não autorizado', {
    ip: clientIp,
    path: req.path,
  });

  res.status(403).json({ error: 'Acesso negado' });
}