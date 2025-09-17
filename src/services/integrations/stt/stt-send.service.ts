import { PrismaClient } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { format, utcToZonedTime } from 'date-fns-tz';
import { sttLogger } from '../../../config/logger.config';
import { config } from '../../../config/app.config';
import { STTDeduplicationService } from './stt-deduplication.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { SendResult, ConsultaCompleta, STTPayload } from '../../../types/stt.types';

export class STTSendService {
  private prisma: PrismaClient;
  private deduplicationService: STTDeduplicationService;
  private pdfService: PdfGeneratorService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.deduplicationService = new STTDeduplicationService(prisma);
    this.pdfService = new PdfGeneratorService(prisma);
  }

  /**
   * Envia consulta para o STT com todas as proteções anti-duplicação
   */
  async sendToSTT(consultaId: string, voucher: string): Promise<SendResult> {
    const startTime = Date.now();
    
    try {
      // 1. Verificar se pode enviar
      const { canSend, reason } = await this.deduplicationService.canSendToSTT(consultaId);
      
      if (!canSend) {
        return {
          success: false,
          reason,
          status: 'BLOCKED',
        };
      }

      // 2. Tentar adquirir lock
      const lockAcquired = await this.deduplicationService.acquireLock(consultaId, voucher);
      
      if (!lockAcquired) {
        // Double-check - pode ter sido enviado entre as verificações
        const checkAgain = await this.deduplicationService.canSendToSTT(consultaId);
        return {
          success: false,
          reason: checkAgain.reason || 'Não foi possível adquirir lock',
          status: 'LOCK_FAILED',
        };
      }

      // 3. Buscar dados completos da consulta
      const consulta = await this.buscarDadosConsulta(consultaId);
      
      if (!consulta) {
        await this.deduplicationService.releaseLock(consultaId);
        return {
          success: false,
          reason: 'Consulta não encontrada',
          status: 'ERROR',
        };
      }

      // 4. Gerar payload
      const payload = await this.buildPayload(consulta);
      
      // 5. Enviar para STT (ou simular se modo teste)
      let response: any;
      
      if (config.stt.modoTeste) {
        // Em modo teste, mostrar payload completo no console
        console.log('\n' + '='.repeat(80));
        console.log('🧪 MODO TESTE - PAYLOAD QUE SERIA ENVIADO AO STT:');
        console.log('='.repeat(80));
        console.log('Voucher:', voucher);
        console.log('ConsultaId:', consultaId);
        console.log('URL destino:', config.stt.webhookUrl);
        console.log('='.repeat(80));
        console.log('PAYLOAD:');
        console.log(JSON.stringify({
          ...payload,
          pdf: payload.pdf ? `[BASE64 STRING - ${payload.pdf.length} caracteres]` : '[VAZIO]'
        }, null, 2));
        console.log('='.repeat(80) + '\n');
        
        sttLogger.info('[MODO TESTE] Simulando envio para STT', {
          voucher,
          consultaId,
          payloadSize: JSON.stringify(payload).length,
        });
        
        response = {
          status: 200,
          data: { simulated: true, timestamp: new Date() },
          headers: { 'x-simulated': 'true' },
        };
      } else {
        response = await this.enviarHttpRequest(payload);
      }

      // 6. Atualizar resultado no banco
      await this.atualizarResultado(consultaId, voucher, consulta, payload, response);

      sttLogger.info('Envio STT concluído com sucesso', {
        voucher,
        consultaId,
        httpStatus: response.status,
        tempoMs: Date.now() - startTime,
      });

      return {
        success: true,
        status: 'SENT',
        httpStatus: response.status,
        response: response.data,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      
      sttLogger.error('Erro ao enviar para STT', {
        voucher,
        consultaId,
        error: errorMessage,
        tempoMs: Date.now() - startTime,
      });

      // Registrar erro no banco
      await this.registrarErro(consultaId, error);

      return {
        success: false,
        reason: errorMessage,
        status: 'ERROR',
      };

    } finally {
      // Sempre liberar o lock
      await this.deduplicationService.releaseLock(consultaId);
    }
  }

  /**
   * Busca dados completos da consulta
   */
  public async buscarDadosConsulta(consultaId: string): Promise<ConsultaCompleta | null> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT 
          c.id,
          c.voucher,
          c.status,
          c."dataRealizada",
          
          -- Evolução
          ev.status as evolucao_status,
          ev."tipoAtendimentoMedico" as evolucao_tipo_atendimento,
          ev."queixaDuracao" as evolucao_queixa_duracao,
          ev."tipoQueixa" as evolucao_tipo_queixa,
          ev."historiaProgressa" as evolucao_historia,
          ev."antecedentePessoal" as evolucao_antecedente,
          ev."antecedentePessoalDetalhes" as evolucao_antecedente_detalhes,
          ev."diagnosticoDetalhado" as evolucao_diagnostico,
          ev."hipoteseDiagnostica" as evolucao_hipotese,
          ev.conduta as evolucao_conduta,
          ev.atestado as evolucao_atestado,
          ev.prescricao as evolucao_prescricao,
          ev."solicitacaoExames" as evolucao_exames,
          ev.desfecho as evolucao_desfecho,
          
          -- Agendamento STT
          ast."codigoInterno" as stt_codigo,
          ast.origem as stt_origem,
          
          -- Tempos
          ct."atendimentoIniciadoEm" as tempo_inicio,
          ct."atendimentoFinalizadoEm" as tempo_fim,
          ct."profissionalAcessouEm" as tempo_acesso,
          
          -- Paciente
          p.nome as paciente_nome,
          p.cpf as paciente_cpf,
          
          -- Profissional
          ps.registro as profissional_registro,
          u.name as profissional_nome
          
        FROM projeto_prod.consultas c
        LEFT JOIN projeto_prod.evolucoes ev ON ev."consultaId" = c.id
        LEFT JOIN projeto_prod.agendamentos_stt ast ON ast.voucher = c.voucher
        LEFT JOIN projeto_prod.consulta_tempos ct ON ct."consultaId" = c.id
        LEFT JOIN projeto_prod.pacientes p ON p.id = c."pacienteId"
        LEFT JOIN projeto_prod.profissionais_saude ps ON ps.id = c."profissionalId"
        LEFT JOIN projeto_prod.users u ON u.id = ps."userId"
        WHERE c.id = ${consultaId}
        LIMIT 1
      `;

      if (result.length === 0) return null;

      const data = result[0];

      // Buscar CIDs separadamente
      const cids = await this.prisma.$queryRaw<any[]>`
        SELECT 
          ec.codigo,
          ec.descricao,
          ec.principal
        FROM projeto_prod.evolucao_cids ec
        WHERE ec.evolucao_id = (
          SELECT id FROM projeto_prod.evolucoes WHERE consulta_id = ${consultaId}
        )
      `;

      return {
        id: data.id,
        voucher: data.voucher,
        status: data.status,
        dataRealizada: data.dataRealizada,
        evolucao: data.evolucao_status ? {
          status: data.evolucao_status,
          tipoAtendimentoMedico: data.evolucao_tipo_atendimento,
          queixaDuracao: data.evolucao_queixa_duracao,
          tipoQueixa: data.evolucao_tipo_queixa,
          historiaProgressa: data.evolucao_historia,
          antecedentePessoal: data.evolucao_antecedente,
          antecedentePessoalDetalhes: data.evolucao_antecedente_detalhes,
          diagnosticoDetalhado: data.evolucao_diagnostico,
          hipoteseDiagnostica: data.evolucao_hipotese,
          conduta: data.evolucao_conduta,
          atestado: data.evolucao_atestado,
          prescricao: data.evolucao_prescricao,
          solicitacaoExames: data.evolucao_exames,
          desfecho: data.evolucao_desfecho,
          cids: cids.map((cid: any) => ({
            codigo: cid.codigo,
            descricao: cid.descricao,
            principal: cid.principal,
          })),
        } : null,
        agendamentoStt: data.stt_codigo ? {
          codigoInterno: data.stt_codigo,
          origem: data.stt_origem,
        } : null,
        consultaTempo: {
          atendimentoIniciadoEm: data.tempo_inicio,
          atendimentoFinalizadoEm: data.tempo_fim,
          profissionalAcessouEm: data.tempo_acesso,
        },
        paciente: data.paciente_nome ? {
          nome: data.paciente_nome,
          cpf: data.paciente_cpf,
        } : null,
        profissional: {
          registro: data.profissional_registro,
          user: data.profissional_nome ? {
            name: data.profissional_nome,
          } : null,
        },
      };
      
    } catch (error) {
      sttLogger.error('Erro ao buscar dados da consulta', {
        consultaId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Constrói payload usando dados do Prisma (como no projeto dev)
   */
  public async buildPayloadFromPrisma(consulta: any): Promise<any> {
    const { format, utcToZonedTime } = await import('date-fns-tz');
    
    // Gerar PDF (usar o serviço existente)
    const pdfBase64 = await this.pdfService.gerarPdfEvolucao(consulta.voucher);

    // Formatar CIDs
    const cidsFormatados = consulta.evolucao?.cids?.map((cid: any) => ({
      codigo: cid.codigo,
      descricao: cid.descricao,
      principal: cid.principal
    })) || [];

    // Montar payload exatamente como no projeto dev
    const DATA_WEBHOOK_STT = {
      status: consulta.evolucao?.status || 'Efetivo',
      tipoAtendimentoMedico: consulta.evolucao?.tipoAtendimentoMedico || 'OMV',
      prioridade: 'Normal',
      queixaDuracao: consulta.evolucao?.queixaDuracao || '',
      tipoQueixa: consulta.evolucao?.tipoQueixa || '',
      historiaPregressaMolestiaAtual: consulta.evolucao?.historiaProgressa || '',
      antecedentesPessoais: consulta.evolucao?.antecedentePessoal ? 
        consulta.evolucao?.antecedentePessoalDetalhes || 'Sim' : 'Não',
      detalharDiagnostico: consulta.evolucao?.diagnosticoDetalhado || '',
      hipoteseDiagnostica: consulta.evolucao?.hipoteseDiagnostica || '',
      cids: cidsFormatados,
      conduta: consulta.evolucao?.conduta || '',
      atestado: consulta.evolucao?.atestado || false,
      prescricao: consulta.evolucao?.prescricao || false,
      solicitaoExames: consulta.evolucao?.solicitacaoExames || false,
      desfecho: consulta.evolucao?.desfecho || '',
      casoId: consulta.agendamentoStt?.codigoInterno,
      dataInicioAtendimento: consulta.consultaTempo?.atendimentoIniciadoEm
        ? format(utcToZonedTime(consulta.consultaTempo.atendimentoIniciadoEm, 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: 'America/Sao_Paulo' })
        : consulta.consultaTempo?.profissionalAcessouEm
        ? format(utcToZonedTime(consulta.consultaTempo.profissionalAcessouEm, 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: 'America/Sao_Paulo' })
        : null,
      dataFimAtendimento: consulta.consultaTempo?.atendimentoFinalizadoEm
        ? format(utcToZonedTime(consulta.consultaTempo.atendimentoFinalizadoEm, 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: 'America/Sao_Paulo' })
        : format(utcToZonedTime(new Date(), 'America/Sao_Paulo'), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: 'America/Sao_Paulo' }),
      pdf: pdfBase64,
      crm: consulta.profissional?.registro || ''
    };

    return DATA_WEBHOOK_STT;
  }

  /**
   * Monta payload para envio ao STT
   */
  public async buildPayload(consulta: ConsultaCompleta): Promise<STTPayload> {
    // Buscar PDF
    const pdfBase64 = await this.pdfService.gerarPdfEvolucao(consulta.voucher);

    const timezone = 'America/Sao_Paulo';
    
    return {
      status: consulta.evolucao?.status || 'Efetivo',
      tipoAtendimentoMedico: consulta.evolucao?.tipoAtendimentoMedico || 'OMV',
      prioridade: 'Normal',
      queixaDuracao: consulta.evolucao?.queixaDuracao || '',
      tipoQueixa: consulta.evolucao?.tipoQueixa || '',
      historiaPregressaMolestiaAtual: consulta.evolucao?.historiaProgressa || '',
      antecedentesPessoais: consulta.evolucao?.antecedentePessoal 
        ? consulta.evolucao.antecedentePessoalDetalhes || 'Sim' 
        : 'Não',
      detalharDiagnostico: consulta.evolucao?.diagnosticoDetalhado || '',
      hipoteseDiagnostica: consulta.evolucao?.hipoteseDiagnostica || '',
      cids: consulta.evolucao?.cids || [],
      conduta: consulta.evolucao?.conduta || '',
      atestado: consulta.evolucao?.atestado || false,
      prescricao: consulta.evolucao?.prescricao || false,
      solicitaoExames: consulta.evolucao?.solicitacaoExames || false,
      desfecho: consulta.evolucao?.desfecho || '',
      casoId: consulta.agendamentoStt?.codigoInterno || '',
      dataInicioAtendimento: consulta.consultaTempo?.atendimentoIniciadoEm
        ? format(utcToZonedTime(consulta.consultaTempo.atendimentoIniciadoEm, timezone), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone })
        : consulta.consultaTempo?.profissionalAcessouEm
        ? format(utcToZonedTime(consulta.consultaTempo.profissionalAcessouEm, timezone), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone })
        : null,
      dataFimAtendimento: consulta.consultaTempo?.atendimentoFinalizadoEm
        ? format(utcToZonedTime(consulta.consultaTempo.atendimentoFinalizadoEm, timezone), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone })
        : format(utcToZonedTime(new Date(), timezone), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone }),
      pdf: pdfBase64,
      crm: consulta.profissional?.registro || '',
    };
  }

  /**
   * Envia requisição HTTP para o STT
   */
  private async enviarHttpRequest(payload: STTPayload): Promise<any> {
    try {
      const response = await axios.post(
        config.stt.webhookUrl,
        payload,
        {
          headers: {
            'Authorization': config.stt.webhookToken,
            'Content-Type': 'application/json',
          },
          timeout: config.timeouts.httpTimeoutMs,
        }
      );

      return response;
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        // Se tem resposta, retornar mesmo com erro
        if (axiosError.response) {
          return axiosError.response;
        }
      }
      
      throw error;
    }
  }

  /**
   * Atualiza resultado do envio no banco
   */
  private async atualizarResultado(
    consultaId: string, 
    voucher: string,
    consulta: ConsultaCompleta,
    payload: STTPayload,
    response: any
  ): Promise<void> {
    const sucesso = response.status === 200;
    
    await this.prisma.$executeRaw`
      UPDATE projeto_prod.stt_envio_controle
      SET 
        enviado = ${sucesso},
        data_envio = ${sucesso ? new Date() : null},
        resposta_status_code = ${response.status},
        resposta_body = ${JSON.stringify(response.data)}::text,
        resposta_headers = ${JSON.stringify(response.headers)}::text,
        resposta_erro = ${sucesso ? null : response.data?.error || response.statusText},
        payload_enviado = ${JSON.stringify(payload)}::text,
        processando_desde = NULL,
        paciente_nome = ${consulta.paciente?.nome},
        profissional_nome = ${consulta.profissional?.user?.name},
        profissional_registro = ${consulta.profissional?.registro},
        codigo_interno_stt = ${consulta.agendamentoStt?.codigoInterno},
        updated_at = NOW()
      WHERE consulta_id = ${consultaId}
    `;
  }

  /**
   * Registra erro no banco
   */
  private async registrarErro(consultaId: string, error: any): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode = error.response?.status || null;
      
      await this.prisma.$executeRaw`
        UPDATE projeto_prod.stt_envio_controle
        SET 
          resposta_erro = ${errorMessage},
          resposta_status_code = ${statusCode},
          proximo_retry = ${this.calculateNextRetry()},
          processando_desde = NULL,
          updated_at = NOW()
        WHERE consulta_id = ${consultaId}
      `;
      
    } catch (dbError) {
      sttLogger.error('Erro ao registrar erro no banco', {
        consultaId,
        error: dbError.message,
      });
    }
  }

  /**
   * Calcula próximo horário de retry com backoff exponencial
   */
  private calculateNextRetry(): Date {
    // Por enquanto, retry em 30 minutos
    return new Date(Date.now() + 30 * 60 * 1000);
  }
}