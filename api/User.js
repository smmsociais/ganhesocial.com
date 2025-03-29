import mongoose from "mongoose";

// 🔹 Schema para Contas
const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true, unique: true },
    id_conta: { type: String, required: false },
    id_tiktok: { type: String },
    s: { type: String },
    status: { type: String, default: "Pendente" },
});

// 🔹 Schema para Histórico de Ações
const ActionHistorySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },  // Relacionamento com User
    token: { type: String, required: true },
    nome_usuario: { type: String, required: true },
    id_pedido: { type: String, required: true },
    id_conta: { type: String, required: true },
    url_dir: { type: String, required: true },
    unique_id_verificado: { type: String, required: true },
    acao_validada: { type: Boolean, required: true },
    valor_confirmacao: { type: Number, required: true, default: 0 }, // 🔹 Novo campo
    data: { type: Date, default: Date.now }
});

// 🔹 Schema do Usuário
const UserSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true },
    contas: [ContaSchema],  // Subdocumento de contas
    historico_acoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ActionHistory" }]  // Relacionamento com ActionHistory
}, { collection: 'usuarios' });

// 🔹 Exportação dos modelos
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);

export { User, ActionHistory };
