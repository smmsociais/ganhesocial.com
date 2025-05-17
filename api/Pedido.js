import mongoose from "mongoose";

const PedidoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rede: String,
    tipo: String,
    nome: String,
    valor: Number,
    quantidade: { type: Number, required: true },           // Total de vezes que essa ação deve ser executada
    quantidadeExecutada: { type: Number, default: 0 },      // Contador de execuções já feitas
    link: String,
    status: { type: String, enum: ["pendente", "reservada", "concluida"], default: "pendente" },
    dataCriacao: { type: Date, default: Date.now }
});

export default mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
