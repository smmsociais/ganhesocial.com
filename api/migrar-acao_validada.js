import mongoose from 'mongoose';
import connectDB from "./db.js";

// Schema mínimo apenas para a migração
const actionHistorySchema = new mongoose.Schema(
  {
    acao_validada: mongoose.Schema.Types.Mixed,
  },
  { collection: 'actionhistories' }
);

const ActionHistory = mongoose.models.ActionHistory || mongoose.model('ActionHistory', actionHistorySchema);

async function migrarAcaoValidada() {
  try {
    await connectDB();
    console.log('🔌 Conectado ao MongoDB.');

    const trueResult = await ActionHistory.updateMany(
      { acao_validada: 'true' },
      { $set: { acao_validada: true } }
    );

    const falseResult = await ActionHistory.updateMany(
      { acao_validada: 'false' },
      { $set: { acao_validada: false } }
    );

    console.log(`✅ Convertidos "true" ➜ true: ${trueResult.modifiedCount}`);
    console.log(`✅ Convertidos "false" ➜ false: ${falseResult.modifiedCount}`);
  } catch (erro) {
    console.error('❌ Erro na migração:', erro);
  } finally {
    await mongoose.disconnect();
    console.log('🔒 Conexão encerrada.');
  }
}

migrarAcaoValidada();
