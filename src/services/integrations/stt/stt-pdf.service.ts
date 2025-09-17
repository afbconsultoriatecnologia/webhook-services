import axios from 'axios';
import { sttLogger } from '../../../config/logger.config';

export class STTPdfService {
  private readonly apiBaseUrl: string;

  constructor() {
    // URL da API principal onde está o serviço de PDF
    this.apiBaseUrl = process.env.MAIN_API_URL || 'https://telemedicina-v001.informarsaude.com.br/api';
  }

  /**
   * Busca o PDF da evolução através da API principal
   */
  async gerarPdfEvolucao(voucher: string): Promise<string> {
    try {
      sttLogger.info('Gerando PDF da evolução', { voucher });

      const response = await axios.get(
        `${this.apiBaseUrl}/telemedicina/pdf/evolucao/${voucher}/base64`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.STT_CRON_TOKEN}`,
          },
          timeout: 30000,
        }
      );

      if (response.data && response.data.base64) {
        const tamanho = response.data.base64.length;
        sttLogger.info('PDF gerado com sucesso', { 
          voucher, 
          tamanhoBase64: tamanho,
        });
        return response.data.base64;
      }

      throw new Error('PDF não retornado pela API');
      
    } catch (error) {
      sttLogger.error('Erro ao gerar PDF', {
        voucher,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      
      // Retornar string vazia se falhar (não bloquear envio)
      return '';
    }
  }
}