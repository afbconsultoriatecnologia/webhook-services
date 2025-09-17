import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '4000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  stt: {
    webhookUrl: process.env.STT_WEBHOOK_URL!,
    webhookToken: process.env.STT_WEBHOOK_TOKEN!,
    cronToken: process.env.STT_CRON_TOKEN!,
    modoTeste: process.env.STT_MODO_TESTE === 'true',
  },
  security: {
    allowedIPs: process.env.ALLOWED_IPS?.split(',') || ['127.0.0.1', '::1'],
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10),
  },
  timeouts: {
    lockTimeoutMinutes: parseInt(process.env.LOCK_TIMEOUT_MINUTES || '5', 10),
    httpTimeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS || '30000', 10),
  },
  paths: {
    logs: path.join(process.cwd(), 'logs'),
  }
};

// Validação de configurações obrigatórias
const requiredConfigs = [
  'DATABASE_URL',
  'STT_WEBHOOK_URL',
  'STT_WEBHOOK_TOKEN',
  'STT_CRON_TOKEN'
];

for (const configName of requiredConfigs) {
  if (!process.env[configName]) {
    throw new Error(`Configuração obrigatória ausente: ${configName}`);
  }
}