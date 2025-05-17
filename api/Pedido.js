// Exemplo de schema Pedido.js
import mongoose from "mongoose";

const PedidoSchema = new mongoose.Schema({
  id_pedido: { type: String, required: true, unique: true }, // <- importante!
  rede: String,
  tipo: String,
  nome: String,
  valor: Number,
  quantidade: Number,
  quantidadeExecutada: Number,
  link: String,
  status: String,
  dataCriacao: Date,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
});

export default mongoose.models.Pedido || mongoose.model("Pedido", PedidoSchema);
