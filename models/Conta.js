const mongoose = require("mongoose");

const ContaSchema = new mongoose.Schema({
    userId: { type: String, required: true }, // ID do usuário que criou a conta
    nomeConta: { type: String, required: true }, // Nome da conta
    saldo: { type: Number, required: true, default: 0 }, // Saldo inicial
    historico: { type: Array, default: [] } // Histórico de transações
});

const Conta = mongoose.model("Conta", ContaSchema);
module.exports = Conta;
