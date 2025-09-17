# Webhook Services - STT Integration

Serviço de integração para envio de retornos médicos ao STT (Sistema de Transcrição de Texto).

## Estrutura do Projeto

```
webhook-services/
├── src/
│   ├── config/          # Configurações da aplicação
│   ├── controllers/     # Controladores das rotas
│   ├── services/        # Serviços de negócio
│   └── types/           # Tipos TypeScript
├── public/
│   └── images/          # Imagens (adicionar logo aqui)
├── .env                 # Variáveis de ambiente
└── package.json
```

## Adicionando o Logo

1. Clone este repositório
2. Adicione o arquivo `informar-logo.png` em `public/images/`
3. Faça commit e push das alterações
4. O serviço irá usar o logo automaticamente nos PDFs gerados

## Configuração

O arquivo `.env` contém as configurações necessárias (não está no repositório por segurança).

## Endpoints

- `GET /health` - Status do serviço
- `GET /api/v1/webhooks/stt/payload/:voucher` - Visualiza payload
- `GET /api/v1/webhooks/stt/payload/:voucher?download=true` - Baixa PDF

## Desenvolvimento

```bash
# Instalar dependências
npm install

# Compilar TypeScript
npm run build

# Executar em desenvolvimento
npm run dev

# Executar em produção
npm run start:prod
```

## Deploy

O serviço está rodando com PM2 em produção:
```bash
pm2 status webhook-services
pm2 logs webhook-services
pm2 restart webhook-services
```
