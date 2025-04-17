import mongoose from "mongoose";

// 🔹 Schema para Contas
const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true },
    id_conta: { type: String, required: false },
    id_tiktok: { type: String },
    s: { type: String },
});

// 🔹 Schema para Histórico de Saques (MOVER PARA CIMA)
const WithdrawSchema = new mongoose.Schema({
    valor: { type: Number, required: true },
    chave_pix: { type: String, required: true },
    tipo_chave: { type: String, default: "cpf" },
}, {
    timestamps: { createdAt: "data", updatedAt: "updatedAt" }
});

// 🔹 Schema para Histórico de Ações
const ActionHistorySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true },
    nome_usuario: { type: String, required: true },
    id_pedido: { type: String, required: true },
    id_conta: { type: String, required: true },
    url_dir: { type: String, required: true },
    unique_id_verificado: { type: String, required: true },
    acao_validada: { type: Boolean, required: true },
    valor_confirmacao: { type: Number, required: true },
    quantidade_pontos: { type: Number, required: true },
    tipo_acao: { type: String, required: true },
    data: { type: Date, default: Date.now }
});

// 🔹 Schema do Usuário
const UserSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    nome_usuario: { type: String, required: false },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    pix_key:      { type: String, default: null },
    pix_key_type: { type: String, default: null },
    contas: [ContaSchema],
    historico_acoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ActionHistory" }],
    saques: [WithdrawSchema],
    ganhosPorDia: [
        {
            data: { type: String },
            valor: { type: Number, default: 0 }
        }
    ]
});

// 🔹 Exportação dos modelos
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const ActionHistory = mongoose.models.ActionHistory || mongoose.model("ActionHistory", ActionHistorySchema);

export { User, ActionHistory };
