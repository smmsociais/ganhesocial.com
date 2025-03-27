import mongoose from 'mongoose';

const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true },
    status: { type: String, enum: ["Pendente", "Aprovada"], default: "Pendente" }
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { 
        type: String, 
        required: [true, "A senha é obrigatória"], 
        select: false  // Impede que a senha seja retornada automaticamente
    },
    contas: [ContaSchema]  // Array de contas
});
