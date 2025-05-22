import mongoose from "mongoose";

// 🔹 Schema para Contas Vinculadas
const ContaSchema = new mongoose.Schema({
  nomeConta: { type: String, required: true },
  id_tiktok: { type: String },
});

// 🔹 Schema para Histórico de Ações
const ActionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, 
  token: { type: String },                                    
  nome_usuario: { type: String },                            
  id_action: { type: String },                                 
  id_conta: { type: String },                                 
  url_dir: { type: String },                       
  acao_validada: { type: Boolean, default: null },
  valor_confirmacao: { type: Number, default: 0 },
  quantidade_pontos: { type: Number },
  tipo_acao: { type: String },
  data: { type: Date, default: Date.now },
  rede_social: { type: String, default: "TikTok" },
  tipo: { type: String, default: "Seguir" }
});

// 🔹 Schema para Histórico de Saques
const WithdrawSchema = new mongoose.Schema({
  valor: { type: Number, required: true },
  chave_pix: { type: String, required: true },
  tipo_chave: { type: String, default: "cpf" }
}, {
  timestamps: { createdAt: "data", updatedAt: "updatedAt" }
});

// 🔹 Schema de Ganhos por Dia
const GanhosPorDiaSchema = new mongoose.Schema({
  data: { type: String }, // tipo string ok se formato for "YYYY-MM-DD"
  valor: { type: Number, default: 0 }
}, { _id: false }); // evita criar _id interno para cada entrada do array

// 🔹 Schema do Usuário
const UserSchema = new mongoose.Schema({
  nome: { type: String, required: false },
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  token: { type: String, required: true },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  saldo: { type: Number, default: 0 },
  pix_key:      { type: String, default: null },
  pix_key_type: { type: String, default: null },
  contas: [ContaSchema],
  historico_acoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ActionHistory" }],
  saques: [WithdrawSchema],
  ganhosPorDia: [GanhosPorDiaSchema]
});

const PedidoSchema = new mongoose.Schema({
  _id: { type: Number }, // <- IMPORTANTE
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rede: String,
  tipo: String,
  nome: String,
  valor: Number,
  quantidade: { type: Number, required: true },
  quantidadeExecutada: { type: Number, default: 0 },
  link: String,
  status: { type: String, enum: ["pendente", "reservada", "concluida"], default: "pendente" },
  dataCriacao: { type: Date, default: Date.now }
});

const TemporaryActionSchema = new mongoose.Schema({
  id_tiktok: String,
  url_dir: String,
  nome_usuario: String,
  tipo_acao: String,
  valor: String,
  id_action: String,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 1 * 60 * 1000)
  }
});

// ✅ Índice TTL para exclusão automática após a data de expiresAt
TemporaryActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);
const Pedido = mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
const TemporaryAction = mongoose.models.TemporaryAction || mongoose.model("TemporaryAction", TemporaryActionSchema);

export { User, ActionHistory, Pedido, TemporaryAction };
