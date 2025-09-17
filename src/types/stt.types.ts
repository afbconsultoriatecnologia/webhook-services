export interface STTEnvioControle {
  id: string;
  consultaId: string;
  voucher: string;
  codigoInternoStt?: string | null;
  enviado: boolean;
  dataEnvio?: Date | null;
  tentativas: number;
  ultimaTentativa?: Date | null;
  proximoRetry?: Date | null;
  processandoDesde?: Date | null;
  respostaStatusCode?: number | null;
  respostaBody?: string | null;
  respostaHeaders?: string | null;
  respostaErro?: string | null;
  pacienteNome?: string | null;
  pacienteCpfHash?: string | null;
  profissionalNome?: string | null;
  profissionalRegistro?: string | null;
  dataConsulta?: Date | null;
  dataFinalizacaoEvolucao?: Date | null;
  payloadEnviado?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingConsulta {
  consulta_id: string;
  voucher: string;
  updated_at: Date;
  tentativas: number;
  ultima_tentativa?: Date | null;
  processando_desde?: Date | null;
}

export interface SendResult {
  success: boolean;
  status: 'SENT' | 'BLOCKED' | 'LOCK_FAILED' | 'ERROR' | 'DRY_RUN';
  reason?: string;
  httpStatus?: number;
  response?: any;
}

export interface ProcessOptions {
  days: number;
  limit: number;
  dryRun: boolean;
}

export interface ProcessResult {
  total: number;
  processados: number;
  sucesso: number;
  bloqueados: number;
  erros: number;
  detalhes: Array<{
    voucher: string;
    status: string;
    reason?: string;
    tentativas?: number;
    error?: string;
  }>;
}

export interface STTPayload {
  status: string;
  tipoAtendimentoMedico: string;
  prioridade: string;
  queixaDuracao: string;
  tipoQueixa: string;
  historiaPregressaMolestiaAtual: string;
  antecedentesPessoais: string;
  detalharDiagnostico: string;
  hipoteseDiagnostica: string;
  cids: Array<{
    codigo: string;
    descricao: string;
    principal: boolean;
  }>;
  conduta: string;
  atestado: boolean;
  prescricao: boolean;
  solicitaoExames: boolean;
  desfecho: string;
  casoId: string;
  dataInicioAtendimento: string | null;
  dataFimAtendimento: string;
  pdf: string;
  crm: string;
}

export interface ConsultaCompleta {
  id: string;
  voucher: string;
  status: string;
  dataRealizada?: Date | null;
  evolucao?: {
    status?: string;
    tipoAtendimentoMedico?: string;
    queixaDuracao?: string;
    tipoQueixa?: string;
    historiaProgressa?: string;
    antecedentePessoal?: boolean;
    antecedentePessoalDetalhes?: string;
    diagnosticoDetalhado?: string;
    hipoteseDiagnostica?: string;
    conduta?: string;
    atestado?: boolean;
    prescricao?: boolean;
    solicitacaoExames?: boolean;
    desfecho?: string;
    cids?: Array<{
      codigo: string;
      descricao: string;
      principal: boolean;
    }>;
  } | null;
  agendamentoStt?: {
    codigoInterno: string;
    origem: string;
  } | null;
  consultaTempo?: {
    atendimentoIniciadoEm?: Date | null;
    atendimentoFinalizadoEm?: Date | null;
    profissionalAcessouEm?: Date | null;
  } | null;
  paciente?: {
    nome: string;
    cpf?: string;
  } | null;
  profissional?: {
    registro?: string;
    user?: {
      name: string;
    } | null;
  } | null;
}