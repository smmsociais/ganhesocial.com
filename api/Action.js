import mongoose from "mongoose";

const actionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rede: String,
    tipo: String,
    nome: String,
    valor: Number,
    quantidade: Number,
    link: String,
    status: { type: String, default: "disponível" },
    dataCriacao: { type: Date, default: Date.now }
});

export const Action = mongoose.models.Action || mongoose.model("Action", actionSchema);
