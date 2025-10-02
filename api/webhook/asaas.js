// /api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

export default async function handler(req, res) {
  try {
    const event = req.body; // O Asaas envia JSON

    if (!event || !event.event) {
      return res.status(400).json({ error: "Evento inválido" }); // ✅ return
    }

    // 🔹 Caso 1: Validação de saque (Asaas pergunta se deve autorizar)
    if (event.event === "WITHDRAW_REQUESTED") {
      // Aqui você pode aplicar regras próprias, por exemplo:
      // - Checar valor máximo
      // - Checar se o usuário existe
      // - Validar limites de segurança
      //
      // Exemplo simples: autorizar sempre
      return res.status(200).json({ authorized: true }); // ✅ return
    }

    await connectDB();

    // 🔹 Caso 2: Transferência concluída ou falhou (notificação normal)
    if (event.event === "TRANSFER_CONFIRMED" || event.event === "TRANSFER_FAILED") {
      const transferId = event.transfer.id;

      // Encontra o usuário pelo saque
      const user = await User.findOne({ "saques.asaasTransferId": transferId });
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" }); // ✅ return
      }

      // Atualiza o status do saque
      const saque = user.saques.find(s => s.asaasTransferId === transferId);
      if (saque) {
        saque.status = event.event === "TRANSFER_CONFIRMED" ? "pago" : "falhou";
        await user.save();
      }

      return res.status(200).json({ success: true }); // ✅ return
    }

    // 🔹 Se o evento não for nenhum dos tratados
    return res.status(200).json({ success: true, ignored: true }); // ✅ return
  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" }); // ✅ return
  }
}
