import mongoose from 'mongoose';

const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true },
    id_conta: { type: String, required: true },
    id_tiktok: { type: String },
    s: { type: String },
    status: { type: String, default: "Pendente" },  // Incluindo o status
});

const UserSchema = new mongoose.Schema({
    nome_usuario: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true },
    contas: [ContaSchema],  // Agora com os campos adicionais para contas
}, { collection: 'usuarios' });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
