// /api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

export default async function handler(req, res) {
  try {
const body = req.body;

// 🔹 Validação de saque (WITHDRAW_REQUESTED)
if (body?.event === "WITHDRAW_REQUESTED") {
  console.log("📩 Validação de saque recebida:", body);
  return res.status(200).json({ authorized: true });
}

// 🔹 Transferência (TRANSFER)
if (body?.type === "TRANSFER" && body.transfer) {
  console.log("📩 Webhook TRANSFER recebido:", body);

  await connectDB();

  const transferId = body.transfer.id;
  const status = body.transfer.status;
  const externalReference = body.transfer.externalReference;

  const user = await User.findOne({ "saques.externalReference": externalReference });
  if (!user) {
    console.warn("⚠️ Usuário não encontrado para transferId:", transferId, "externalReference:", externalReference);
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  const saque = user.saques.find(s => s.externalReference === externalReference);
  if (saque) {
    saque.status = status === "CONFIRMED" ? "pago" :
                   status === "FAILED" ? "falhou" : "pendente";
    await user.save();
  }

  return res.status(200).json({ success: true });
}

// 🔹 Outros eventos
return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
