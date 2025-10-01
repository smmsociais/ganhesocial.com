// /api/webhook/asaas.js
import connectDB from "./db.js";
import { User } from "./schema.js";

export default async function handler(req, res) {
  try {
    const event = req.body; // O Asaas envia JSON

    if (!event || !event.event) {
      return res.status(400).json({ error: "Evento inválido" });
    }

    await connectDB();

    if (event.event === "TRANSFER_CONFIRMED" || event.event === "TRANSFER_FAILED") {
      const transferId = event.transfer.id;

      // Encontra o usuário pelo saque
      const user = await User.findOne({ "saques.asaasTransferId": transferId });
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      // Atualiza o status do saque
      const saque = user.saques.find(s => s.asaasTransferId === transferId);
      if (saque) {
        saque.status = event.event === "TRANSFER_CONFIRMED" ? "pago" : "falhou";
        await user.save();
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
