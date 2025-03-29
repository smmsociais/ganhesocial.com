import mongoose from 'mongoose';

// Definição do schema para contas
const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true, unique: true },
    id_conta: { type: String, required: false },
    id_tiktok: { type: String },
    s: { type: String },
    status: { type: String, default: "Pendente" },
});

// Definição do schema para o usuário
const UserSchema = new mongoose.Schema({
    nome_usuario: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true },
    contas: [ContaSchema],  // Subdocumento de contas
    historico_acoes: [{ type: mongoose.Schema.Types.ObjectId, ref: "ActionHistory" }]  // Relacionamento com ActionHistory
}, { collection: 'usuarios' });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
