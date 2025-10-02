// api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos - ajuste se quiser

function now() {
  return new Date().toISOString();
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    // logs iniciais detalhados
    console.log(`[ASASS WEBHOOK] RECEIVED - ${now()}`);
    console.log("[ASASS WEBHOOK] headers:", headers);
    console.log("[ASASS WEBHOOK] body:", JSON.stringify(body, null, 2));

    // valida token (se configurado no painel Asaas) - loga o token recebido também
    if (WEBHOOK_TOKEN) {
      const incomingToken = headers["asaas-access-token"] || headers["Asaas-Access-Token"] || headers["x-asaas-token"];
      console.log("[ASASS WEBHOOK] incomingToken:", incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn("[ASASS WEBHOOK] Token inválido:", incomingToken);
        return res.status(401).json({ error: "invalid webhook token" });
      }
    }

    // --- AUTORIZAÇÃO IMEDIATA (para evitar recusas por timeout) ---
    // Tratar vários formatos que o Asaas pode enviar quando pede autorização:
    // - body.event === "WITHDRAW_REQUESTED"
    // - body.type === "WITHDRAW_REQUESTED"
    // - body.event === "TRANSFER_PENDING" (variações)
    // - body.type === "TRANSFER" && body.transfer?.status === "PENDING" && body.transfer?.authorized === false
    const event = body?.event;
    const type = body?.type;
    const transfer = body?.transfer;

    const looksLikeValidationEvent =
      event === "WITHDRAW_REQUESTED" ||
      type === "WITHDRAW_REQUESTED" ||
      event === "TRANSFER_PENDING" ||
      (type === "TRANSFER" && transfer && transfer.status === "PENDING" && transfer.authorized === false);

    if (looksLikeValidationEvent) {
      console.log("[ASASS WEBHOOK] Detected validation event - responding authorized:true immediately. event/type:", { event, type });
      // Responder rápido com o formato exato esperado
      return res.status(200).json({ authorized: true });
    }

    // --- 2) Evento de TRANSFER (notificação de status) ---
    if (type === "TRANSFER" && transfer) {
      console.log("[ASASS WEBHOOK] TRANSFER received - processing:", {
        id: transfer.id,
        status: transfer.status,
        externalReference: transfer.externalReference,
        value: transfer.value
      });

      await connectDB();

      const transferId = transfer.id;
      const status = transfer.status; // PENDING | CONFIRMED | FAILED | ...
      const externalReference = transfer.externalReference || null;
      const bank = transfer.bankAccount || {};

      let user = null;
      let saque = null;

      if (externalReference) {
        user = await User.findOne({ "saques.externalReference": externalReference });
      } else {
        // fallback tolerante: tentar casar por chave PIX / cpf/cnpj / ownerName / valor + tempo
        const pixKeyCandidate = bank.pixAddressKey || transfer.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? bank.cpfCnpj.replace(/\D/g, "") : null;
        const ownerNameCandidate = bank.ownerName ? bank.ownerName.trim().toLowerCase() : null;
        const valueCandidate = transfer.value;
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
        // retorna 200 para evitar retries infinitos do Asaas, mas registra para investigação
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // localizar saque exato dentro do user.saques
      const matchPredicate = s => {
        if (externalReference) return s.externalReference === externalReference;
        const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
        const valueMatch = s.valor === transfer.value;
        const pixMatch = bank.pixAddressKey ? (s.chave_pix === bank.pixAddressKey || s.chave_pix.replace(/\D/g, "") === bank.pixAddressKey) : false;
        const cpfMatch = bank.cpfCnpj ? (s.chave_pix.replace(/\D/g, "") === bank.cpfCnpj.replace(/\D/g, "")) : false;
        const ownerMatch = bank.ownerName ? (s.ownerName && s.ownerName.trim().toLowerCase() === bank.ownerName.trim().toLowerCase()) : false;
        return s.status === "pendente" && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
      };

      saque = user.saques.find(matchPredicate);
      if (!saque) {
        console.warn("[ASASS WEBHOOK] Saque não encontrado mesmo após buscar usuário. transferId:", transferId);
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // atualiza status e grava asaasId se necessário
      const newStatus = (status === "CONFIRMED") ? "pago" : (status === "FAILED" ? "falhou" : (status === "PENDING" ? "pendente" : String(status).toLowerCase()));
      saque.status = newStatus;
      if (!saque.asaasId) saque.asaasId = transferId;

      // armazena informações bancárias retornadas (opcional, útil para debug)
      saque.bankAccount = bank;

      await user.save();

      console.log("[ASASS WEBHOOK] Saque atualizado:", { userId: user._id, saqueExternal: saque.externalReference, novoStatus: newStatus });

      return res.status(200).json({ success: true });
    }

    // outros eventos
    console.log("[ASASS WEBHOOK] Evento não tratado. Keys:", Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error("[ASASS WEBHOOK] Erro:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
