// api/migrar_acao_validada.js

import mongoose from 'mongoose';
import connectDB from './db.js';

const actionHistorySchema = new mongoose.Schema(
  { acao_validada: mongoose.Schema.Types.Mixed },
  { collection: 'actionhistories' }
);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model('ActionHistory', actionHistorySchema);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

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

    await mongoose.disconnect();

    return res.status(200).json({
      message: 'Migração concluída.',
      trueConvertidos: trueResult.modifiedCount,
      falseConvertidos: falseResult.modifiedCount
    });
  } catch (erro) {
    console.error('❌ Erro na migração:', erro);
    return res.status(500).json({ error: 'Erro na migração.' });
  }
}
