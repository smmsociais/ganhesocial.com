import mongoose from 'mongoose';

const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true }
});

const UserSchema = new mongoose.Schema({
    nome_usuario: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true },
    contas: [ContaSchema]  // Array de contas sem o campo "status"
}, { collection: 'usuarios' });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
