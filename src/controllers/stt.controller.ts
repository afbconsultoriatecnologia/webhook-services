import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database.config';
import { sttLogger } from '../config/logger.config';
import { STTService } from '../services/integrations/stt/stt.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { processRateLimiter, queryRateLimiter } from '../middleware/rate-limit.middleware';
import { successResponse, errorResponse } from '../utils/response.utils';

// Schemas de validação
const ProcessQuerySchema = z.object({
  days: z.coerce.number().min(1).max(90).default(7),
  limit: z.coerce.number().min(1).max(500).default(50),
  dryRun: z.coerce.boolean().default(false),
});

const ReportQuerySchema = z.object({
  days: z.coerce.number().min(1).max(90).default(7),
  format: z.enum(['json', 'csv']).default('json'),
});

export class STTController {
  private router: Router;
  private sttService: STTService;

  constructor() {
    this.router = Router();
    this.sttService = new STTService(db.getClient());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Endpoint público para testes (sem autenticação)
    this.router.get('/payload/:voucher', queryRateLimiter, this.showPayload.bind(this));

    // Aplicar autenticação apenas nas rotas protegidas
    this.router.use(authMiddleware);

    // Endpoints protegidos (requerem autenticação)
    this.router.post('/process', processRateLimiter, this.processWebhooks.bind(this));
    this.router.get('/status', queryRateLimiter, this.getStatus.bind(this));
    this.router.get('/report', queryRateLimiter, this.getReport.bind(this));
    this.router.get('/pending', queryRateLimiter, this.getPending.bind(this));
    this.router.post('/retry/:voucher', processRateLimiter, this.retryVoucher.bind(this));
  }

  /**
   * POST /api/v1/webhooks/stt/process
   * Processa envio de consultas pendentes
   */
  private async processWebhooks(req: Request, res: Response): Promise<void> {
    try {
      const query = ProcessQuerySchema.parse(req.query);
      
      sttLogger.info('Iniciando processamento STT', {
        ...query,
        ip: req.ip,
      });

      const result = await this.sttService.processarPendentes(query);
      
      // Se modo teste, adicionar aviso na resposta
      const message = query.dryRun || process.env.STT_MODO_TESTE === 'true' 
        ? '⚠️ MODO TESTE - Nenhum envio real foi feito. Verifique os logs/console para ver os payloads.'
        : 'Processamento concluído';
      
      successResponse(res, result, message);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        errorResponse(res, 'Parâmetros inválidos: ' + error.message, 400);
        return;
      }
      
      sttLogger.error('Erro no processamento STT', { error: error.message });
      errorResponse(res, error);
    }
  }

  /**
   * GET /api/v1/webhooks/stt/status
   * Status geral do sistema
   */
  private async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const [stats, recentSends] = await Promise.all([
        this.sttService.getStatistics(7),
        this.sttService.getRecentSends(5),
      ]);

      const dbHealth = await db.healthCheck();

      const status = {
        sistema: 'Webhook Services - STT',
        versao: '1.0.0',
        status: dbHealth ? 'operational' : 'degraded',
        database: dbHealth ? 'connected' : 'disconnected',
        timestamp: new Date(),
        estatisticas: stats,
        ultimosEnvios: recentSends.map(send => ({
          voucher: send.voucher,
          dataEnvio: send.data_envio,
          statusCode: send.resposta_status_code,
        })),
      };

      successResponse(res, status);
      
    } catch (error) {
      sttLogger.error('Erro ao obter status', { error: error.message });
      errorResponse(res, error);
    }
  }

  /**
   * GET /api/v1/webhooks/stt/report
   * Relatório de envios
   */
  private async getReport(req: Request, res: Response): Promise<void> {
    try {
      const query = ReportQuerySchema.parse(req.query);
      
      const [stats, recentSends] = await Promise.all([
        this.sttService.getStatistics(query.days),
        this.sttService.getRecentSends(20),
      ]);

      const report = {
        periodo: {
          dias: query.days,
          inicio: new Date(Date.now() - query.days * 24 * 60 * 60 * 1000),
          fim: new Date(),
        },
        resumo: stats,
        detalhes: recentSends,
      };

      if (query.format === 'csv') {
        // Implementar export CSV se necessário
        res.status(501).json({ error: 'Export CSV não implementado' });
        return;
      }

      successResponse(res, report);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        errorResponse(res, 'Parâmetros inválidos: ' + error.message, 400);
        return;
      }
      
      sttLogger.error('Erro ao gerar relatório', { error: error.message });
      errorResponse(res, error);
    }
  }

  /**
   * GET /api/v1/webhooks/stt/pending
   * Lista consultas pendentes
   */
  private async getPending(req: Request, res: Response): Promise<void> {
    try {
      const query = ProcessQuerySchema.parse(req.query);
      
      const pendentes = await this.sttService.findPendingConsultas({
        days: query.days,
        limit: query.limit,
        dryRun: true, // Sempre dry run para listagem
      });

      successResponse(res, {
        total: pendentes.length,
        consultas: pendentes.map(p => ({
          voucher: p.voucher,
          finalizadaEm: p.updated_at,
          tentativas: p.tentativas,
          processandoDesde: p.processando_desde,
        })),
      });
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        errorResponse(res, 'Parâmetros inválidos: ' + error.message, 400);
        return;
      }
      
      sttLogger.error('Erro ao listar pendentes', { error: error.message });
      errorResponse(res, error);
    }
  }

  /**
   * POST /api/v1/webhooks/stt/retry/:voucher
   * Reprocessa um voucher específico
   */
  private async retryVoucher(req: Request, res: Response): Promise<void> {
    try {
      const { voucher } = req.params;
      
      if (!voucher) {
        errorResponse(res, 'Voucher não informado', 400);
        return;
      }

      sttLogger.info('Reprocessando voucher', { voucher });

      // Buscar consultaId pelo voucher
      const consulta = await db.getClient().$queryRaw<any[]>`
        SELECT id FROM projeto_prod.consultas 
        WHERE voucher = ${voucher}
        LIMIT 1
      `;

      if (consulta.length === 0) {
        errorResponse(res, 'Consulta não encontrada', 404);
        return;
      }

      // Resetar controle para permitir reenvio
      await db.getClient().$executeRaw`
        UPDATE projeto_prod.stt_envio_controle
        SET 
          enviado = false,
          processando_desde = NULL,
          tentativas = GREATEST(tentativas - 1, 0),
          proximo_retry = NULL,
          updated_at = NOW()
        WHERE consulta_id = ${consulta[0].id}
      `;

      // Processar
      const result = await this.sttService.processarPendentes({
        days: 90, // Buscar em período maior
        limit: 1, // Apenas este voucher
        dryRun: false,
      });

      successResponse(res, result, 'Reprocessamento iniciado');
      
    } catch (error) {
      sttLogger.error('Erro ao reprocessar voucher', { 
        error: error.message,
        voucher: req.params.voucher,
      });
      errorResponse(res, error);
    }
  }

  /**
   * GET /api/v1/webhooks/stt/payload/:voucher
   * Mostra o payload que seria enviado para uma consulta específica
   * PÚBLICO: Não requer autenticação (para testes via navegador)
   * Parâmetros:
   *   - ?download=true : Faz download do PDF em vez de mostrar o JSON
   */
  private async showPayload(req: Request, res: Response): Promise<void> {
    try {
      const { voucher } = req.params;
      const { download } = req.query;
      
      if (!voucher) {
        errorResponse(res, 'Voucher não informado', 400);
        return;
      }

      sttLogger.info('Buscando payload para voucher', { voucher, download: !!download });

      // Buscar consultaId pelo voucher
      const consulta = await db.getClient().$queryRaw<any[]>`
        SELECT id FROM projeto_prod.consultas 
        WHERE voucher = ${voucher}
        LIMIT 1
      `;

      if (consulta.length === 0) {
        errorResponse(res, 'Consulta não encontrada', 404);
        return;
      }

      // Importar serviço de envio
      const { STTSendService } = await import('../services/integrations/stt/stt-send.service');
      const sendService = new STTSendService(db.getClient());
      
      // Buscar consulta com includes (como no projeto dev)
      const consultaCompleta = await db.getClient().consulta.findUnique({
        where: { id: consulta[0].id },
        include: {
          paciente: true,
          profissional: {
            include: {
              user: true,
            },
          },
          evolucao: {
            include: {
              cids: true,
              profissional: {
                include: {
                  user: true,
                },
              },
            },
          },
          agendamentoStt: true,
          consultaTempo: true,
        },
      });
      
      if (!consultaCompleta) {
        errorResponse(res, 'Dados da consulta não encontrados', 404);
        return;
      }

      // Se solicitado download, gerar e baixar apenas o PDF
      if (download === 'true') {
        const { PdfGeneratorService } = await import('../services/integrations/stt/pdf-generator.service');
        const pdfService = new PdfGeneratorService(db.getClient());
        
        // Gerar PDF como base64
        const pdfBase64 = await pdfService.gerarPdfEvolucao(voucher);
        
        if (!pdfBase64) {
          errorResponse(res, 'Erro ao gerar PDF', 500);
          return;
        }
        
        // Converter base64 para buffer
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        
        // Configurar headers para download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="evolucao_${voucher}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        // Enviar o PDF como download
        res.send(pdfBuffer);
        return;
      }

      // Construir payload usando método do projeto dev
      const payload = await sendService.buildPayloadFromPrisma(consultaCompleta);
      
      // Log no console (conforme solicitado)
      console.log('\n=== PAYLOAD STT ===');
      console.log('Voucher:', voucher);
      console.log('Consulta ID:', consulta[0].id);
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('===================\n');

      successResponse(res, {
        voucher,
        consultaId: consulta[0].id,
        payload,
        timestamp: new Date(),
      }, 'Payload gerado com sucesso (veja também o console dos logs)');
      
    } catch (error) {
      sttLogger.error('Erro ao gerar payload', { 
        error: error.message,
        voucher: req.params.voucher,
      });
      errorResponse(res, error);
    }
  }

  getRouter(): Router {
    return this.router;
  }
}