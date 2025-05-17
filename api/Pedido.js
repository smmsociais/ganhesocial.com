import mongoose from "mongoose";

const PedidoSchema = new mongoose.Schema({
  id_pedido: { type: String, required: true, unique: true }, // <- novo campo para vincular pedidos externos
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // <- pode ser nulo para pedidos SMM
  rede: String,
  tipo: String,
  nome: String,
  valor: Number,
  quantidade: { type: Number, required: true },
  quantidadeExecutada: { type: Number, default: 0 },
  link: String,
  status: { type: String, enum: ["pendente", "reservada", "concluida"], default: "pendente" },
  dataCriacao: { type: Date, default: Date.now }
});

export default mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
