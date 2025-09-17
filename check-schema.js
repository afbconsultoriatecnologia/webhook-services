const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    // Verificar estrutura da tabela consultas
    const consultasColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'projeto_prod' 
      AND table_name = 'consultas'
      ORDER BY ordinal_position;
    `;
    
    console.log('\n=== Colunas da tabela consultas ===');
    console.log(consultasColumns);
    
    // Verificar estrutura da tabela agendamentos_stt
    const agendamentosColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'projeto_prod' 
      AND table_name = 'agendamentos_stt'
      ORDER BY ordinal_position;
    `;
    
    console.log('\n=== Colunas da tabela agendamentos_stt ===');
    console.log(agendamentosColumns);
    
    // Verificar relacionamentos
    const foreignKeys = await prisma.$queryRaw`
      SELECT 
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = 'projeto_prod'
        AND (tc.table_name = 'consultas' OR tc.table_name = 'agendamentos_stt');
    `;
    
    console.log('\n=== Foreign Keys relevantes ===');
    console.log(foreignKeys);
    
    // Verificar como as tabelas estão relacionadas
    const sampleData = await prisma.$queryRaw`
      SELECT 
        c.id as consulta_id,
        c.voucher,
        ast.id as agendamento_id,
        ast."codigoInterno",
        c."createdAt"
      FROM projeto_prod.consultas c
      LEFT JOIN projeto_prod.agendamentos_stt ast 
        ON ast.voucher = c.voucher
      WHERE c.status = 'finalizada'
      ORDER BY c."createdAt" DESC
      LIMIT 5;
    `;
    
    console.log('\n=== Amostra de dados relacionados ===');
    console.log(sampleData);
    
  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();