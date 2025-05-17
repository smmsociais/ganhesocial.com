import mongoose from "mongoose";

const actionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true },
  nome_usuario: { type: String, required: true },
  id_pedido: { type: String, required: true }, // ALTERADO para string
  id_conta: { type: String, required: true },
  url_dir: { type: String, required: true },
  tipo_acao: { type: String, required: true },
  quantidade_pontos: { type: Number, required: true },
  tipo: { type: String, default: "Seguir" },
  rede_social: { type: String, default: "TikTok" },
  valor_confirmacao: { type: String, required: true },
  acao_validada: { type: Boolean, default: null },
  data: { type: Date, default: Date.now }
});

export const ActionHistory =
  mongoose.models.ActionHistory || mongoose.model("ActionHistory", actionHistorySchema);
