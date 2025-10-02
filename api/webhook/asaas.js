// api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos

function now() { return new Date().toISOString(); }

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    console.log(`[ASASS WEBHOOK] RECEIVED - ${now()}`);
    console.log("[ASASS WEBHOOK] headers:", headers);
    console.log("[ASASS WEBHOOK] body:", JSON.stringify(body, null, 2));

    // token validation (optional)
    if (WEBHOOK_TOKEN) {
      const incomingToken = headers["asaas-access-token"] || headers["Asaas-Access-Token"] || headers["x-asaas-token"];
      console.log("[ASASS WEBHOOK] incomingToken:", incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn("[ASASS WEBHOOK] Token inválido:", incomingToken);
        return res.status(401).json({ error: "invalid webhook token" });
      }
    }

    // quick-detect validation events and authorize immediately
    const event = body?.event;
    const type = body?.type;
    const transfer = body?.transfer;

    const looksLikeValidationEvent =
      event === "WITHDRAW_REQUESTED" ||
      type === "WITHDRAW_REQUESTED" ||
      event === "TRANSFER_PENDING" ||
      event === "TRANSFER_REQUESTED" ||
      (type === "TRANSFER" && transfer && transfer.status === "PENDING" && transfer.authorized === false);

    if (looksLikeValidationEvent) {
      console.log("[ASASS WEBHOOK] Validation event detected, replying authorized:true");
      return res.status(200).json({ authorized: true });
    }

    // handle transfer notifications coming as either:
    // - body.type === "TRANSFER" && body.transfer
    // - body.event === "TRANSFER_CONFIRMED" | "TRANSFER_FAILED" | "TRANSFER_PENDING"
    const isTransferEvent =
      (type === "TRANSFER" && transfer) ||
      (typeof event === "string" && event.startsWith("TRANSFER"));

    if (isTransferEvent) {
      // normalize transfer object
      const t = transfer || body;
      console.log("[ASASS WEBHOOK] Processing transfer event:", { id: t.id, status: t.status || event });

      await connectDB();

      const transferId = t.id;
      const statusRaw = (t.status || event || "").toString();
      // normalize status to CONFIRMED / FAILED / PENDING if possible
      const statusNormalized = statusRaw.includes("CONFIRMED") ? "CONFIRMED"
        : statusRaw.includes("FAILED") ? "FAILED"
        : statusRaw.includes("PENDING") ? "PENDING"
        : statusRaw.toUpperCase();

      const externalReference = t.externalReference || null;
      const bank = t.bankAccount || {};

      let user = null;
      let saque = null;

      if (externalReference) {
        user = await User.findOne({ "saques.externalReference": externalReference });
      } else {
        // fallback matching by pixKey/cpf/ownerName/valor+recent
        const pixKeyCandidate = bank.pixAddressKey || t.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? bank.cpfCnpj.replace(/\D/g, "") : null;
        const ownerNameCandidate = bank.ownerName ? bank.ownerName.trim().toLowerCase() : null;
        const valueCandidate = t.value;
        const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

        user = await User.findOne({
          saques: {
            $elemMatch: {
              status: "pendente",
              valor: valueCandidate,
              data: { $gte: cutoff },
              $or: [
                { chave_pix: pixKeyCandidate },
                { chave_pix: { $regex: pixKeyCandidate || "" } },
                { chave_pix: cpfCnpjCandidate },
                { ownerName: ownerNameCandidate }
              ]
            }
          }
        });
      }

      if (!user) {
        console.warn("[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:", transferId, "externalReference:", externalReference);
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // find the exact saque
      saque = user.saques.find(s => {
        if (externalReference) return s.externalReference === externalReference;
        const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
        const valueMatch = s.valor === t.value;
        const pixMatch = bank.pixAddressKey ? (s.chave_pix === bank.pixAddressKey || s.chave_pix.replace(/\D/g, "") === bank.pixAddressKey) : false;
        const cpfMatch = bank.cpfCnpj ? (s.chave_pix.replace(/\D/g, "") === bank.cpfCnpj.replace(/\D/g, "")) : false;
        const ownerMatch = bank.ownerName ? (s.ownerName && s.ownerName.trim().toLowerCase() === bank.ownerName.trim().toLowerCase()) : false;
        return s.status === "pendente" && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
      });

      if (!saque) {
        console.warn("[ASASS WEBHOOK] Saque não encontrado mesmo após buscar usuário. transferId:", transferId);
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // map status
      const newStatus = (statusNormalized === "CONFIRMED") ? "pago"
        : (statusNormalized === "FAILED") ? "falhou"
        : (statusNormalized === "PENDING") ? "pendente"
        : statusNormalized.toLowerCase();

      saque.status = newStatus;
      if (!saque.asaasId) saque.asaasId = transferId;
      saque.bankAccount = bank;

      await user.save();

      console.log("[ASASS WEBHOOK] Saque atualizado:", { userId: user._id, saqueExternal: saque.externalReference, novoStatus: newStatus, failReason: t.failReason || null });

      return res.status(200).json({ success: true });
    }

    console.log("[ASASS WEBHOOK] Evento não tratado. Keys:", Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error("[ASASS WEBHOOK] Erro:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
