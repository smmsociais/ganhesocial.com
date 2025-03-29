import mongoose from "mongoose";

const ActionHistorySchema = new mongoose.Schema({
  token: { type: String, required: true },
  nome_usuario: { type: String, required: true },
  id_pedido: { type: String, required: true },
  id_conta: { type: String, required: true },
  url_dir: { type: String, required: true },
  unique_id_verificado: { type: String, required: true },
  acao_validada: { type: Boolean, required: true },
  data: { type: Date, default: Date.now }
});

export default mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);
