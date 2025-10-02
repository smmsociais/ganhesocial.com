// /api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

export default async function handler(req, res) {
  try {
    const body = req.body;

    // 🔹 Caso 1: Validação de saque (event)
    if (body.event === "WITHDRAW_REQUESTED") {
      console.log("📩 Validação de saque recebida:", body);

      // Exemplo: autoriza sempre
      return res.status(200).json({ authorized: true });
    }

    // 🔹 Caso 2: Eventos de transferência (type === TRANSFER)
    if (body.type === "TRANSFER" && body.transfer) {
      console.log("📩 Webhook TRANSFER recebido:", body);

      await connectDB();

      const transferId = body.transfer.id;
      const status = body.transfer.status;

      const user = await User.findOne({ "saques.asaasId": transferId });
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const saque = user.saques.find(s => s.asaasId === transferId);
      if (saque) {
        saque.status = status === "CONFIRMED" ? "pago" :
                       status === "FAILED" ? "falhou" : "pendente";
        await user.save();
      }

      return res.status(200).json({ success: true });
    }

    // 🔹 Se não for nenhum evento reconhecido
    return res.status(200).json({ success: true, ignored: true });
  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
