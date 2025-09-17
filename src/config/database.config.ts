import { PrismaClient } from '@prisma/client';
import { logger } from './logger.config';
import { config } from './app.config';

export class DatabaseService {
  private prisma: PrismaClient;
  private static instance: DatabaseService;

  private constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.database.url,
        },
      },
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    });

    // Log de queries em desenvolvimento
    if (config.app.env === 'development') {
      (this.prisma.$on as any)('query', (e: any) => {
        logger.debug('Query:', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      });
    }

    (this.prisma.$on as any)('error', (e: any) => {
      logger.error('Database error:', e);
    });

    (this.prisma.$on as any)('warn', (e: any) => {
      logger.warn('Database warning:', e);
    });
  }

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  getClient(): PrismaClient {
    return this.prisma;
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      
      // Validar conexão com banco de produção
      const result = await this.prisma.$queryRaw`
        SELECT current_database() as database, 
               current_schema() as schema,
               current_user as user
      ` as any[];
      
      const connection = result[0];
      logger.info('Database connected:', connection);
      
      // Verificar se está conectado ao banco correto
      if (connection.database !== 'projeto_prod' || connection.schema !== 'projeto_prod') {
        throw new Error(`Conectado ao banco incorreto: ${connection.database}.${connection.schema}`);
      }
      
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    logger.info('Database disconnected');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export const db = DatabaseService.getInstance();