import mongoose from "mongoose";

const actionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  token: { type: String, required: false },
  nome_usuario: { type: String, required: true },
  id_pedido: { type: String, required: false },
  id_conta: { type: String, required: false },
  url_dir: { type: String, required: true },
  tipo_acao: { type: String, required: true },
  quantidade_pontos: { type: Number, required: true },
  quantidade: { type: Number, required: true }, // ✅ Adicionado
  tipo: { type: String, default: "Seguir" },
  rede_social: { type: String, default: "TikTok" },
  valor_confirmacao: { type: String, required: true },
  acao_validada: { type: Boolean, default: null },
  data: { type: Date, default: Date.now }
});

export const ActionHistory =
  mongoose.models.ActionHistory || mongoose.model("ActionHistory", actionHistorySchema);
