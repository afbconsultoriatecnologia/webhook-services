import { PrismaClient } from '@prisma/client';
import { sttLogger } from '../../../config/logger.config';
import { STTSendService } from './stt-send.service';
import { STTDeduplicationService } from './stt-deduplication.service';
import { PendingConsulta, ProcessOptions, ProcessResult } from '../../../types/stt.types';

export class STTService {
  private prisma: PrismaClient;
  private sendService: STTSendService;
  private deduplicationService: STTDeduplicationService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.sendService = new STTSendService(prisma);
    this.deduplicationService = new STTDeduplicationService(prisma);
  }

  /**
   * Busca consultas pendentes de envio ao STT
   */
  async findPendingConsultas(options: ProcessOptions): Promise<PendingConsulta[]> {
    try {
      const { days, limit } = options;
      
      const pendentes = await this.prisma.$queryRaw<PendingConsulta[]>`
        SELECT DISTINCT
          c.id as consulta_id,
          c.voucher,
          c."updatedAt" as updated_at,
          COALESCE(sec.tentativas, 0)::int as tentativas,
          sec.ultima_tentativa,
          sec.processando_desde
        FROM projeto_prod.consultas c
        INNER JOIN projeto_prod.agendamentos_stt ast ON ast.voucher = c.voucher
        LEFT JOIN projeto_prod.evolucoes ev ON ev."consultaId" = c.id
        LEFT JOIN projeto_prod.stt_envio_controle sec ON sec.consulta_id = c.id
        WHERE 
          c.status = 'finalizada'
          AND ev.id IS NOT NULL
          AND c."updatedAt" >= NOW() - INTERVAL '${days} days'
          AND (
            -- Nunca enviado
            sec.id IS NULL 
            -- Ou falhou e pode tentar novamente
            OR (
              (sec.enviado = false OR sec.enviado IS NULL)
              AND (sec.tentativas < 3 OR sec.tentativas IS NULL)
              AND (sec.proximo_retry IS NULL OR sec.proximo_retry <= NOW())
              AND (sec.processando_desde IS NULL OR sec.processando_desde < NOW() - INTERVAL '5 minutes')
            )
          )
        ORDER BY c."updatedAt" DESC
        LIMIT ${limit}
      `;

      sttLogger.info(`Consultas pendentes encontradas: ${pendentes.length}`, {
        dias: days,
        limite: limit,
      });

      return pendentes;
      
    } catch (error) {
      sttLogger.error('Erro ao buscar consultas pendentes', {
        error: error.message,
        options,
      });
      throw error;
    }
  }

  /**
   * Processa envio de consultas pendentes
   */
  async processarPendentes(options: ProcessOptions): Promise<ProcessResult> {
    const startTime = Date.now();
    
    // Limpar locks travados antes de processar
    await this.deduplicationService.cleanupStuckLocks();
    
    // Buscar pendentes
    const pendentes = await this.findPendingConsultas(options);
    
    const result: ProcessResult = {
      total: pendentes.length,
      processados: 0,
      sucesso: 0,
      bloqueados: 0,
      erros: 0,
      detalhes: [],
    };

    // Processar cada consulta
    for (const pendente of pendentes) {
      if (options.dryRun) {
        result.detalhes.push({
          voucher: pendente.voucher,
          status: 'DRY_RUN',
          tentativas: pendente.tentativas,
        });
        continue;
      }

      try {
        const sendResult = await this.sendService.sendToSTT(
          pendente.consulta_id,
          pendente.voucher
        );

        result.processados++;
        
        if (sendResult.success) {
          result.sucesso++;
        } else if (sendResult.status === 'BLOCKED' || sendResult.status === 'LOCK_FAILED') {
          result.bloqueados++;
        } else {
          result.erros++;
        }

        result.detalhes.push({
          voucher: pendente.voucher,
          status: sendResult.status,
          reason: sendResult.reason,
          tentativas: pendente.tentativas + 1,
        });

      } catch (error) {
        result.erros++;
        result.detalhes.push({
          voucher: pendente.voucher,
          status: 'ERROR',
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          tentativas: pendente.tentativas,
        });
      }
    }

    sttLogger.info('Processamento STT concluído', {
      ...result,
      tempoTotalMs: Date.now() - startTime,
    });

    return result;
  }

  /**
   * Gera estatísticas do sistema STT
   */
  async getStatistics(days: number = 7): Promise<any> {
    try {
      const stats = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE enviado = true)::int as total_enviados,
          COUNT(*) FILTER (WHERE enviado = false AND (tentativas < 3 OR tentativas IS NULL))::int as pendentes,
          COUNT(*) FILTER (WHERE processando_desde IS NOT NULL AND processando_desde > NOW() - INTERVAL '5 minutes')::int as processando,
          COUNT(*) FILTER (WHERE tentativas >= 3 AND enviado = false)::int as max_tentativas,
          COUNT(*) FILTER (WHERE resposta_status_code = 200)::int as sucesso_200,
          COUNT(*) FILTER (WHERE resposta_status_code != 200 AND resposta_status_code IS NOT NULL)::int as outros_status
        FROM projeto_prod.stt_envio_controle
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `;

      return (stats as any[])[0];
      
    } catch (error) {
      sttLogger.error('Erro ao gerar estatísticas', {
        error: error.message,
        days,
      });
      throw error;
    }
  }

  /**
   * Busca últimos envios realizados
   */
  async getRecentSends(limit: number = 10): Promise<any[]> {
    try {
      const sends = await this.prisma.$queryRaw`
        SELECT 
          voucher,
          data_envio,
          resposta_status_code,
          paciente_nome,
          profissional_nome,
          tentativas
        FROM projeto_prod.stt_envio_controle
        WHERE enviado = true
        ORDER BY data_envio DESC
        LIMIT ${limit}
      `;

      return sends as any[];
      
    } catch (error) {
      sttLogger.error('Erro ao buscar envios recentes', {
        error: error.message,
        limit,
      });
      throw error;
    }
  }
}