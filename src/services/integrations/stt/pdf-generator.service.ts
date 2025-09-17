import { PrismaClient } from '@prisma/client';
import PDFDocument = require('pdfkit');
import * as QRCode from 'qrcode';
import { format, utcToZonedTime } from 'date-fns-tz';
import { sttLogger } from '../../../config/logger.config';

export interface EvolucaoPdfResult {
  base64: string;
  buffer: Buffer;
  fileName: string;
}

export class PdfGeneratorService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Gera PDF da evolução médica e retorna base64
   */
  async gerarPdfEvolucao(voucher: string): Promise<string> {
    try {
      sttLogger.info('Gerando PDF da evolução localmente', { voucher });

      // Buscar dados da consulta
      const consulta = await this.buscarDadosConsulta(voucher);
      
      if (!consulta) {
        throw new Error('Consulta não encontrada');
      }

      if (!consulta.evolucao) {
        throw new Error('Consulta sem evolução');
      }

      // Gerar o PDF
      const pdfData = await this.criarPdf(consulta);
      
      sttLogger.info('PDF gerado com sucesso localmente', { 
        voucher, 
        tamanhoBase64: pdfData.base64.length,
      });

      return pdfData.base64;
    } catch (error) {
      sttLogger.error('Erro ao gerar PDF localmente', {
        voucher,
        error: error.message,
      });
      
      // Retornar string vazia se falhar (não bloquear envio)
      return '';
    }
  }

  /**
   * Busca os dados completos da consulta usando Prisma
   */
  private async buscarDadosConsulta(voucher: string) {
    const consulta = await this.prisma.consulta.findUnique({
      where: { voucher },
      include: {
        paciente: true,
        profissional: {
          include: {
            user: true,
          },
        },
        evolucao: {
          include: {
            cids: {
              orderBy: {
                principal: 'desc'
              }
            },
            profissional: {
              include: {
                user: true,
              },
            },
          },
        },
        agendamentoStt: true,
      },
    });

    return consulta;
  }

  /**
   * Cria o PDF e retorna os dados
   */
  private async criarPdf(consulta: any): Promise<EvolucaoPdfResult> {
    return new Promise(async (resolve, reject) => {
      try {
        const evolucao = consulta.evolucao;

        // Preparar dados para o PDF
        const DATA_PDF = {
          prontuario: evolucao.id,
          paciente: consulta.paciente?.nome || 'Paciente não identificado',
          dataHora: consulta.dataRealizada 
            ? format(utcToZonedTime(consulta.dataRealizada, 'America/Sao_Paulo'), 'dd/MM/yyyy HH:mm:ss', { timeZone: 'America/Sao_Paulo' })
            : format(utcToZonedTime(consulta.createdAt, 'America/Sao_Paulo'), 'dd/MM/yyyy HH:mm:ss', { timeZone: 'America/Sao_Paulo' }),
          classificacaoRiscoEnfermagem: evolucao.classificacaoRiscoEnfermagem?.trim() || 'Não informado',
          classificacaoRiscoMedico: evolucao.classificacaoRiscoMedico?.trim() || 'Não informado',
          tipoAtendimento: evolucao.tipoAtendimentoMedico?.trim() || null,
          queixaPrincipal: evolucao.queixaDuracao || evolucao.tipoQueixa || 'Não informado',
          historiaProgressa: evolucao.historiaProgressa?.trim() || 'Não informado',
          antecedentePessoal: evolucao.antecedentePessoal,
          antecedentePessoalDetalhes: evolucao.antecedentePessoalDetalhes?.trim() || null,
          hipoteseDiagnostica: evolucao.hipoteseDiagnostica?.trim() || evolucao.diagnosticoDetalhado?.trim() || 'Não informado',
          cids: evolucao.cids || [],
          conduta: evolucao.conduta?.trim() || 'Não informado',
          desfecho: evolucao.desfecho?.trim() || null,
          atestado: evolucao.atestado,
          prescricao: evolucao.prescricao,
          solicitacaoExames: evolucao.solicitacaoExames,
          medico: {
            nome: evolucao.profissional?.user?.name || consulta.profissional?.user?.name || 'Médico não identificado',
            conselho: consulta.profissional?.tipoRegistro || 'CRM',
            numeroConselho: consulta.profissional?.registro || '',
            crm: consulta.profissional?.registro || '',
          },
          status: evolucao.status || 'Efetivo',
          voucher: consulta.voucher,
        };

        // Criar documento PDF
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, left: 50, right: 50, bottom: 60 },
        });

        // Array para armazenar chunks do PDF
        const chunks: Buffer[] = [];
        
        // Capturar dados do stream
        doc.on('data', (chunk: any) => chunks.push(chunk));
        
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          
          resolve({
            base64,
            buffer,
            fileName: `evolucao_${DATA_PDF.voucher}.pdf`
          });
        });

        doc.on('error', (error: any) => {
          reject(error);
        });

        // Gerar conteúdo do PDF
        await this.gerarConteudoPdf(doc, DATA_PDF);

        // Finalizar documento
        doc.end();

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Gera o conteúdo do PDF
   */
  private async gerarConteudoPdf(doc: any, dados: any): Promise<void> {
    const pageWidth = doc.page.width;
    const usableWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

    // === LOGO E TÍTULO ALINHADOS "BETWEEN" ===
    const logoX = doc.page.margins.left;
    const logoY = 40;
    const logoWidth = 80;
    const logoHeight = 26;

    // Por enquanto, sem logo (pode ser adicionado depois)
    // if (fs.existsSync(logoPath)) {
    //   doc.image(logoPath, logoX, logoY, { width: logoWidth });
    // }

    const tituloFontSize = 8;
    const tituloY = logoY + logoHeight / 2 - tituloFontSize / 2 + 2;

    doc
      .font('Helvetica-Bold')
      .fontSize(tituloFontSize)
      .text('Ficha de atendimento Médico', pageWidth - doc.page.margins.right - 200, tituloY, {
        width: 200,
        align: 'right',
      });

    // ==== LINHA DE IDENTIFICAÇÃO COM MARGEM TOP DE 30px ====
    const linhaIdY = logoY + logoHeight + 30;
    
    // Prontuário (primeira linha)
    doc
      .font('Times-Roman')
      .fontSize(10)
      .fillColor('black')
      .text(`Prontuário: ${dados.prontuario}`, doc.page.margins.left, linhaIdY);
    
    // Paciente e Data/Hora (segunda linha - mesma linha)
    doc
      .text(`Paciente: ${dados.paciente}    Data/Hora: ${dados.dataHora}`, doc.page.margins.left, linhaIdY + 15);

    // ==== UMA ÚNICA CAIXA COM TODAS AS SESSÕES ====
    const boxX = doc.page.margins.left;
    const boxY = linhaIdY + 35; // Ajustado para dar espaço para as 2 linhas
    const boxWidth = usableWidth;
    const boxPadding = 18;

    // Sessões do documento - incluir apenas campos com conteúdo
    const sessoes: { titulo: string; conteudo: string }[] = [];
    
    // Campos obrigatórios
    sessoes.push({ titulo: 'Classificação de Risco Enfermagem:', conteudo: dados.classificacaoRiscoEnfermagem || 'Não informado' });
    sessoes.push({ titulo: 'Classificação de Risco Médico:', conteudo: dados.classificacaoRiscoMedico || 'Não informado' });
    
    // Tipo de atendimento (se existir)
    if (dados.tipoAtendimento) {
      sessoes.push({ titulo: 'Tipo de Atendimento:', conteudo: dados.tipoAtendimento });
    }
    
    sessoes.push({ titulo: 'Queixa principal:', conteudo: dados.queixaPrincipal });
    sessoes.push({ titulo: 'HPMA:', conteudo: dados.historiaProgressa });
    
    // Antecedentes pessoais (se existir)
    if (dados.antecedentePessoal && dados.antecedentePessoalDetalhes) {
      sessoes.push({ titulo: 'Antecedentes Pessoais:', conteudo: dados.antecedentePessoalDetalhes });
    }
    
    sessoes.push({ titulo: 'Hipótese diagnóstica:', conteudo: dados.hipoteseDiagnostica });
    
    // CIDs (se existirem)
    if (dados.cids && dados.cids.length > 0) {
      const cidsTexto = dados.cids.map((cid: any) => `${cid.codigo} - ${cid.descricao}${cid.principal ? ' (Principal)' : ''}`).join('\n');
      sessoes.push({ titulo: 'CID(s):', conteudo: cidsTexto });
    }
    
    sessoes.push({ titulo: 'Conduta e destino:', conteudo: dados.conduta });
    
    // Desfecho (se existir)
    if (dados.desfecho) {
      sessoes.push({ titulo: 'Desfecho:', conteudo: dados.desfecho });
    }
    
    // Documentos emitidos (se existirem)
    const documentosEmitidos: string[] = [];
    if (dados.atestado) documentosEmitidos.push('Atestado Médico');
    if (dados.prescricao) documentosEmitidos.push('Prescrição');
    if (dados.solicitacaoExames) documentosEmitidos.push('Solicitação de Exames');
    
    if (documentosEmitidos.length > 0) {
      sessoes.push({ titulo: 'Documentos Emitidos:', conteudo: documentosEmitidos.join(', ') });
    }

    doc.font('Times-Roman').fontSize(10);

    // Estimar altura da caixa principal
    let tempY = boxY + boxPadding;
    let totalHeight = 0;
    for (let i = 0; i < sessoes.length; i++) {
      doc.font('Helvetica-Bold').fontSize(10);
      const th = doc.heightOfString(sessoes[i].titulo, { width: boxWidth - 2 * boxPadding });
      doc.font('Times-Roman').fontSize(10);
      const ch = doc.heightOfString(sessoes[i].conteudo, { width: boxWidth - 2 * boxPadding });
      totalHeight += th + ch + 8; // 8px padding
      if (i < sessoes.length - 1) totalHeight += 8; // espaço para linha/borda
    }
    totalHeight += boxPadding;

    // RESERVA rodapé (borda + 2 linhas + LGPD) = 120px é seguro
    const rodapeTotalHeight = 120;
    const maxBoxHeight = doc.page.height - boxY - rodapeTotalHeight;
    const finalBoxHeight = Math.min(totalHeight, maxBoxHeight);

    // Desenha caixa arredondada principal
    doc
      .roundedRect(boxX, boxY, boxWidth, finalBoxHeight, 10)
      .lineWidth(1)
      .strokeColor('#cccccc')
      .stroke();

    // === Renderizar sessões com linhas internas ===
    let y = boxY + boxPadding;
    for (let i = 0; i < sessoes.length; i++) {
      const sessao = sessoes[i];
      // Título
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
        .text(sessao.titulo, boxX + boxPadding, y, {
          width: boxWidth - 2 * boxPadding,
          align: 'left'
        });
      const titleHeight = doc.heightOfString(sessao.titulo, { width: boxWidth - 2 * boxPadding });

      // Conteúdo
      doc.font('Times-Roman').fontSize(10).fillColor('#000')
        .text(sessao.conteudo, boxX + boxPadding, y + titleHeight, {
          width: boxWidth - 2 * boxPadding,
          align: 'left'
        });
      const contentHeight = doc.heightOfString(sessao.conteudo, { width: boxWidth - 2 * boxPadding });

      // Y da borda inferior
      const sessaoBottomY = y + titleHeight + contentHeight + 8;

      // Desenha borda inferior (exceto última sessão)
      if (i < sessoes.length - 1 && sessaoBottomY < boxY + finalBoxHeight - boxPadding) {
        doc.moveTo(boxX + boxPadding, sessaoBottomY)
          .lineTo(boxX + boxWidth - boxPadding, sessaoBottomY)
          .lineWidth(0.7)
          .strokeColor('#cccccc')
          .stroke();
      }
      // Avança para próxima sessão
      y = sessaoBottomY + 8;
      // Impede overflow
      if (y > boxY + finalBoxHeight - boxPadding) break;
    }

    // Gera e adiciona QR code (antes da borda do rodapé)
    const qrSize = 60;
    const qrMarginBottom = 10; // Margem inferior entre QR code e borda do rodapé
    
    // === RODAPÉ: PRESTADOR + BORDA TOPO + LGPD ===
    const rodapePrestadorY = doc.page.height - 95;
    
    // Calcula a posição Y do QR code (acima da borda do rodapé)
    const qrY = rodapePrestadorY - qrSize - qrMarginBottom;
    
    // Gera o QR code como dataURL
    try {
      const qrCodeUrl = `https://webhook-telemedicina.informarsaude.com.br/api/v1/webhooks/stt/payload/${dados.voucher}`;
      const qrDataUrl = await QRCode.toDataURL(qrCodeUrl, { 
        width: qrSize,
        margin: 0
      });
      
      // Adiciona o QR code ao PDF (alinhado à esquerda)
      doc.image(qrDataUrl, doc.page.margins.left, qrY, {
        width: qrSize,
        height: qrSize
      });
    } catch (error) {
      sttLogger.warn('Erro ao gerar QR code:', error);
    }

    // Linha top do rodapé
    doc
      .moveTo(doc.page.margins.left, rodapePrestadorY)
      .lineTo(pageWidth - doc.page.margins.right, rodapePrestadorY)
      .lineWidth(1)
      .strokeColor('#cccccc')
      .stroke();

    // PRESTADOR / CONSELHO - Posicionados no rodapé
    const medicoX = doc.page.margins.left;
    
    // Nome do médico
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#000')
      .text(
        dados.medico?.nome ? `PRESTADOR: Dr(a) ${dados.medico.nome}` : 'PRESTADOR: Dr(a) ', 
        medicoX, 
        rodapePrestadorY + 6, 
        {
          width: usableWidth - qrSize - 15,
          align: 'left',
          lineBreak: false
        }
      );
      
    // Conselho e número
    doc
      .font('Times-Roman')
      .fontSize(9)
      .fillColor('#000')
      .text(
        dados.medico?.conselho && dados.medico?.numeroConselho ? 
          `CONSELHO: ${dados.medico.conselho}: ${dados.medico.numeroConselho}` : 
          `CONSELHO: CRM: ${dados.medico.crm || 'Não informado'} `, 
        medicoX, 
        rodapePrestadorY + 21, 
        {
          width: usableWidth - qrSize - 15,
          align: 'left',
          lineBreak: false
        }
      );

    // LGPD
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(
        'Os dados pessoais e/ou pessoais sensíveis contidos neste relatório são sigilosos e protegidos por lei, devendo seu acesso, uso e/ou ' +
        'compartilhamento obedecerem às diretrizes da Lei Geral de Proteção de Dados e demais normas de confidencialidade condicionantes nos ' +
        'Códigos de Ética Médica e demais profissões, sendo vedado o acesso não autorizado ou o compartilhamento sem o consentimento expresso ' +
        'do paciente, salvo nos casos previstos na lei.',
        doc.page.margins.left,
        rodapePrestadorY + 38,
        {
          width: usableWidth,
          align: 'justify',
          height: 50,
          lineBreak: false
        }
      );
  }

}