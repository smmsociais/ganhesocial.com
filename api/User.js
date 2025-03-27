import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    nome_usuario: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    token: { type: String, required: true }
}, { collection: 'usuarios' });

export default mongoose.models.User || mongoose.model('User', UserSchema);
