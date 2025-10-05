import mongoose from "mongoose";

// 🔹 Schema para Contas Vinculadas
const ContaSchema = new mongoose.Schema({
  nomeConta: { type: String, required: true },
  id_tiktok: { type: String },
  id_fake: { type: String },
  status: { type: String, default: "ativa" },
});

// 🔹 Schema para Histórico de Ações
const ActionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  token: { type: String },
  nome_usuario: { type: String },
  id_action: { type: String, required: true },
  id_pedido: { type: String, required: true },
  id_conta: { type: String, required: true },
  id_acao_smm: { type: String, required: false },
  unique_id: { type: String },
  url_dir: { type: String, required: true },
  acao_validada: { type: String, enum: ['valida', 'pendente', 'pulada', 'invalida'], default: 'pendente' },
  valor_confirmacao: { type: Number, default: 0 },
  quantidade_pontos: { type: Number, required: true },
  tipo_acao: { type: String, required: true },
  data: { type: Date, default: Date.now },
  rede_social: { type: String, default: "TikTok" },
  tipo: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

// 🔹 Schema para Histórico de Saques
// 🔹 Schema para Histórico de Saques (compatível com Asaas)
const WithdrawSchema = new mongoose.Schema({
  valor: { type: Number, required: true },

  // sempre grave chave em formato "apenas dígitos" para CPF/CNPJ ou texto para EMAIL/PHONE
  chave_pix: {
    type: String,
    required: true,
    set: v => v ? String(v).replace(/[^0-9]/g, '') : v // remove formatação automaticamente
  },

  tipo_chave: {
    type: String,
    enum: ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'UNKNOWN'],
    default: 'CPF'
  },

  status: {
    type: String,
    enum: ['PENDING', 'DONE', 'FAILED', 'CANCELLED'], // usa exatamente os do Asaas
    default: 'PENDING'
  },


});


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
});

const PedidoSchema = new mongoose.Schema({
  _id: { type: Number },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rede: String,
  tipo: String,
  nome: String,
  valor: Number,
  quantidade: { type: Number, required: true },
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
    default: () => new Date(Date.now() + 5 * 60 * 1000)
  }
});

const DailyEarningSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  valor: {
    type: Number,
    required: true
  },
  data: {
    type: Date,
    required: true,
    default: () => new Date()
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

DailyEarningSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
TemporaryActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);
const Pedido = mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
const TemporaryAction = mongoose.models.TemporaryAction || mongoose.model("TemporaryAction", TemporaryActionSchema);
const DailyEarning = mongoose.models.DailyEarning || mongoose.model("DailyEarning", DailyEarningSchema);

export { User, ActionHistory, Pedido, TemporaryAction, DailyEarning };
