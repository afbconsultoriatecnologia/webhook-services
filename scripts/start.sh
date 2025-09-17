#!/bin/bash

# Script para iniciar o Webhook Services

echo "🚀 Iniciando Webhook Services..."

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Erro: Execute este script no diretório raiz do projeto"
    exit 1
fi

# Verificar se .env existe
if [ ! -f ".env" ]; then
    echo "📋 Criando arquivo .env a partir do exemplo..."
    cp .env.example .env
    echo "⚠️  Por favor, configure o arquivo .env com as credenciais corretas"
    exit 1
fi

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Build do projeto
echo "🔨 Compilando TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Erro na compilação"
    exit 1
fi

# Criar diretórios de logs
echo "📁 Criando diretórios de logs..."
mkdir -p logs/{webhooks,integrations/stt,pm2}

# Iniciar com PM2
echo "🎯 Iniciando com PM2..."
pm2 start ecosystem.config.js --env production

# Mostrar status
echo ""
echo "✅ Webhook Services iniciado!"
echo ""
pm2 status webhook-services

echo ""
echo "📊 Para ver os logs:"
echo "   pm2 logs webhook-services"
echo ""
echo "🔍 Para monitorar:"
echo "   pm2 monit"
echo ""
echo "🛑 Para parar:"
echo "   pm2 stop webhook-services"