import mongoose from "mongoose";

// 🔹 Schema para Contas Vinculadas
const ContaSchema = new mongoose.Schema({
  nomeConta: { type: String, required: true },
  id_tiktok: { type: String },
  id_fake: { type: String },
  status: { type: String, default: "ativa" },
});

// 🔹 Schema para Histórico de Ações (com suporte a comissões de afiliados)
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
  rede_social: { type: String, default: "TikTok" },
  tipo: { type: String, required: true }, // exemplo: "seguimento", "curtida", "comissao"
  afiliado: { type: String },             // 🔹 código do afiliado responsável pela comissão
  valor: { type: Number, default: 0 },    // 🔹 valor da comissão, quando tipo = "comissao"
  data: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

// 🔹 Schema para Histórico de Saques
const WithdrawSchema = new mongoose.Schema({
  valor: { type: Number, required: true },
  chave_pix: { type: String, required: true },
  tipo_chave: { type: String, default: "cpf" }
}, {
  timestamps: { createdAt: "data", updatedAt: "updatedAt" }
});

// 🔹 Schema do Usuário (adicionando campos de afiliado)
const UserSchema = new mongoose.Schema({
  nome: { type: String, required: false },
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  token: { type: String, required: true },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  saldo: { type: Number, default: 0 },
  pix_key: { type: String, default: null },
  pix_key_type: { type: String, default: null },
  contas: [ContaSchema],
  historico_acoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ActionHistory" }],
  saques: [WithdrawSchema],

  // 🔹 Campos de afiliados
  codigo_afiliado: { type: String, default: null },
  indicado_por: { type: String, default: null },

  // 🔹 Campos de status para afiliados
  status: { type: String, default: "ativo" }, // usado para validar indicados ativos
  ativo_ate: { type: Date, default: null },   // indica até quando o usuário é considerado ativo
});

// índice parcial — enforce uniqueness only when codigo_afiliado is a string
UserSchema.index(
  { codigo_afiliado: 1 },
  { unique: true, partialFilterExpression: { codigo_afiliado: { $type: "string" } }, name: "codigo_afiliado_1" }
);

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

/*
  === NOVO: DailyRankingSchema ===
  Persistimos o ranking fixo do dia (10 nomes) para sobreviver a reinícios do container.
  Campo `data` é a string no formato "dd/mm/yyyy" (mesma formatação usada em diaTop3).
*/
const DailyRankingSchema = new mongoose.Schema({
  data: { type: String, required: true }, // exemplo: "11/11/2025"
  ranking: [
    {
      username: { type: String, required: true },
      token: { type: String, default: null },
      real_total: { type: Number, default: 0 },
      is_current_user: { type: Boolean, default: false }
    }
  ],
  criadoEm: { type: Date, default: Date.now }
});

// índice único por data para garantir máximo 1 documento por dia
DailyRankingSchema.index({ data: 1 }, { unique: true });

// 🔹 Modelos
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);
const Pedido = mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
const TemporaryAction = mongoose.models.TemporaryAction || mongoose.model("TemporaryAction", TemporaryActionSchema);
const DailyEarning = mongoose.models.DailyEarning || mongoose.model("DailyEarning", DailyEarningSchema);
const DailyRanking = mongoose.models.DailyRanking || mongoose.model("DailyRanking", DailyRankingSchema);

export { User, ActionHistory, Pedido, TemporaryAction, DailyEarning, DailyRanking };
