import { PrismaClient } from '@prisma/client';
import { sttLogger } from '../../../config/logger.config';
import { config } from '../../../config/app.config';
import { STTEnvioControle } from '../../../types/stt.types';

export class STTDeduplicationService {
  private prisma: PrismaClient;
  private readonly LOCK_TIMEOUT_MS: number;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.LOCK_TIMEOUT_MS = config.timeouts.lockTimeoutMinutes * 60 * 1000;
  }

  /**
   * Verifica se uma consulta pode ser enviada ao STT
   */
  async canSendToSTT(consultaId: string): Promise<{
    canSend: boolean;
    reason?: string;
  }> {
    try {
      // 1. Verificar se já foi enviado com sucesso
      const controle = await this.prisma.$queryRaw<STTEnvioControle[]>`
        SELECT * FROM projeto_prod.stt_envio_controle
        WHERE consulta_id = ${consultaId}
        AND enviado = true
        AND resposta_status_code = 200
        LIMIT 1
      `;

      if (controle.length > 0) {
        const dataEnvio = controle[0].dataEnvio 
          ? new Date(controle[0].dataEnvio).toLocaleString('pt-BR')
          : 'data desconhecida';
        
        sttLogger.info(`Consulta ${consultaId} já foi enviada com sucesso`, {
          voucher: controle[0].voucher,
          dataEnvio,
        });
        
        return {
          canSend: false,
          reason: `Já enviado com sucesso em ${dataEnvio}`,
        };
      }

      // 2. Verificar se está em processamento
      const emProcessamento = await this.prisma.$queryRaw<STTEnvioControle[]>`
        SELECT * FROM projeto_prod.stt_envio_controle
        WHERE consulta_id = ${consultaId}
        AND processando_desde IS NOT NULL
        AND processando_desde > NOW() - INTERVAL '${config.timeouts.lockTimeoutMinutes} minutes'
        LIMIT 1
      `;

      if (emProcessamento.length > 0) {
        const processandoDesde = emProcessamento[0].processandoDesde;
        const tempoProcessando = Date.now() - new Date(processandoDesde!).getTime();
        const segundos = Math.floor(tempoProcessando / 1000);
        
        sttLogger.warn(`Consulta ${consultaId} em processamento`, {
          voucher: emProcessamento[0].voucher,
          processandoHa: `${segundos}s`,
        });
        
        return {
          canSend: false,
          reason: `Em processamento há ${segundos}s`,
        };
      }

      return { canSend: true };
      
    } catch (error) {
      sttLogger.error('Erro ao verificar se pode enviar STT', {
        consultaId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Tenta adquirir lock para processar consulta
   */
  async acquireLock(consultaId: string, voucher: string): Promise<boolean> {
    try {
      // Usar INSERT ... ON CONFLICT para operação atômica
      const result = await this.prisma.$executeRaw`
        INSERT INTO projeto_prod.stt_envio_controle (
          id, 
          consulta_id, 
          voucher, 
          enviado, 
          tentativas, 
          ultima_tentativa, 
          processando_desde,
          created_at,
          updated_at
        )
        VALUES (
          gen_random_uuid()::text,
          ${consultaId},
          ${voucher},
          false,
          1,
          NOW(),
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (consulta_id) DO UPDATE SET
          tentativas = stt_envio_controle.tentativas + 1,
          ultima_tentativa = NOW(),
          processando_desde = CASE
            -- Só atualizar se não está processando ou timeout
            WHEN stt_envio_controle.processando_desde IS NULL 
              OR stt_envio_controle.processando_desde < NOW() - INTERVAL '${config.timeouts.lockTimeoutMinutes} minutes'
              OR stt_envio_controle.enviado = true
            THEN NOW()
            ELSE stt_envio_controle.processando_desde
          END,
          updated_at = NOW()
        WHERE 
          -- Só atualizar se não foi enviado com sucesso
          stt_envio_controle.enviado = false 
          OR stt_envio_controle.resposta_status_code != 200
          OR stt_envio_controle.resposta_status_code IS NULL
      `;

      const lockAcquired = result > 0;
      
      if (lockAcquired) {
        sttLogger.info('Lock adquirido com sucesso', { consultaId, voucher });
      } else {
        sttLogger.warn('Falha ao adquirir lock', { consultaId, voucher });
      }
      
      return lockAcquired;
      
    } catch (error) {
      sttLogger.error('Erro ao adquirir lock', {
        consultaId,
        voucher,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Libera lock de processamento
   */
  async releaseLock(consultaId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE projeto_prod.stt_envio_controle
        SET 
          processando_desde = NULL,
          updated_at = NOW()
        WHERE consulta_id = ${consultaId}
      `;
      
      sttLogger.debug('Lock liberado', { consultaId });
      
    } catch (error) {
      sttLogger.error('Erro ao liberar lock', {
        consultaId,
        error: error.message,
      });
    }
  }

  /**
   * Verifica e limpa locks travados
   */
  async cleanupStuckLocks(): Promise<number> {
    try {
      const result = await this.prisma.$executeRaw`
        UPDATE projeto_prod.stt_envio_controle
        SET 
          processando_desde = NULL,
          updated_at = NOW()
        WHERE 
          processando_desde IS NOT NULL
          AND processando_desde < NOW() - INTERVAL '${config.timeouts.lockTimeoutMinutes * 2} minutes'
          AND enviado = false
      `;
      
      if (result > 0) {
        sttLogger.warn(`Locks travados limpos: ${result}`);
      }
      
      return result;
      
    } catch (error) {
      sttLogger.error('Erro ao limpar locks travados', {
        error: error.message,
      });
      return 0;
    }
  }
}