import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/app.config';
import { logger } from './config/logger.config';
import { db } from './config/database.config';
import { STTController } from './controllers/stt.controller';
import { ipWhitelistMiddleware } from './middleware/auth.middleware';

class WebhookServicesApp {
  private app: Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = config.app.port;
  }

  async initialize(): Promise<void> {
    // Conectar ao banco
    await db.connect();

    // Configurar middlewares
    this.setupMiddlewares();

    // Configurar rotas
    this.setupRoutes();

    // Tratamento de erros
    this.setupErrorHandling();
  }

  private setupMiddlewares(): void {
    // Configurar trust proxy para Nginx
    this.app.set('trust proxy', 1);
    
    // Segurança básica
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true,
    }));

    // Parser JSON
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // IP Whitelist (temporariamente desabilitado para testes)
    // if (config.app.env === 'production') {
    //   this.app.use(ipWhitelistMiddleware);
    // }

    // Log de requisições
    this.app.use((req, res, next) => {
      logger.info('Request received', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req: Request, res: Response) => {
      const dbHealth = await db.healthCheck();
      
      res.status(dbHealth ? 200 : 503).json({
        status: dbHealth ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        database: dbHealth ? 'connected' : 'disconnected',
      });
    });

    // Root
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        service: 'Webhook Services',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          stt: '/api/v1/webhooks/stt',
        },
      });
    });

    // STT Routes
    const sttController = new STTController();
    this.app.use('/api/v1/webhooks/stt', sttController.getRouter());

    // 404
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Endpoint não encontrado',
        path: req.path,
      });
    });
  }

  private setupErrorHandling(): void {
    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
      });

      res.status(500).json({
        error: 'Erro interno do servidor',
        message: config.app.env === 'development' ? err.message : undefined,
      });
    });
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
      
      this.app.listen(this.port, () => {
        logger.info(`🚀 Webhook Services rodando na porta ${this.port}`);
        logger.info(`🔗 Ambiente: ${config.app.env}`);
        logger.info(`📊 Endpoints disponíveis:`);
        logger.info(`   - Health: http://localhost:${this.port}/health`);
        logger.info(`   - STT: http://localhost:${this.port}/api/v1/webhooks/stt`);
      });
      
    } catch (error) {
      logger.error('Falha ao iniciar aplicação', { error: error.message });
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    logger.info('Parando aplicação...');
    await db.disconnect();
    process.exit(0);
  }
}

// Iniciar aplicação
const app = new WebhookServicesApp();

app.start().catch((error) => {
  logger.error('Erro fatal ao iniciar', { error });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM recebido');
  await app.stop();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT recebido');
  await app.stop();
});