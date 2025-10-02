// api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos - ajuste se quiser

export default async function handler(req, res) {
  try {
    const body = req.body || {};

    // valida token (se configurado no painel Asaas)
    if (WEBHOOK_TOKEN) {
      const incomingToken = req.headers["asaas-access-token"] || req.headers["Asaas-Access-Token"] || req.headers["x-asaas-token"];
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn("[ASSS WEBHOOK] Token inválido:", incomingToken);
        return res.status(401).json({ error: "invalid webhook token" });
      }
    }

    // --- 1) Validação de saque (autorizar) ---
    // Trata payloads com event === "WITHDRAW_REQUESTED" ou type === "WITHDRAW_REQUESTED"
    if (body?.event === "WITHDRAW_REQUESTED" || body?.type === "WITHDRAW_REQUESTED") {
      console.log("[ASASS WEBHOOK] WITHDRAW_REQUESTED recebido:", {
        externalReference: body?.transfer?.externalReference ?? body?.externalReference,
        amount: body?.transfer?.value ?? body?.value,
        pix: body?.transfer?.bankAccount?.pixAddressKey ?? body?.transfer?.pixAddressKey
      });

      // regra: autorizar sempre (substitua por regras suas se desejar)
      return res.status(200).json({ authorized: true });
    }

    // --- 2) Evento de TRANSFER (notificação de status) ---
    if (body?.type === "TRANSFER" && body.transfer) {
      console.log("[ASASS WEBHOOK] TRANSFER recebido:", {
        id: body.transfer.id,
        status: body.transfer.status,
        externalReference: body.transfer.externalReference,
        value: body.transfer.value
      });

      await connectDB();

      const transfer = body.transfer;
      const transferId = transfer.id;
      const status = transfer.status; // PENDING | CONFIRMED | FAILED | ...
      const externalReference = transfer.externalReference || null;
      const bank = transfer.bankAccount || {};

      let user = null;
      let saque = null;

      if (externalReference) {
        // busca direta pelo externalReference
        user = await User.findOne({ "saques.externalReference": externalReference });
      } else {
        // fallback tolerante: tentar casar por chave PIX / cpf/cnpj / ownerName / valor + tempo
        const pixKeyCandidate = bank.pixAddressKey || transfer.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? bank.cpfCnpj.replace(/\D/g, "") : null;
        const ownerNameCandidate = bank.ownerName ? bank.ownerName.trim().toLowerCase() : null;
        const valueCandidate = transfer.value;
        const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

        // procura usuário com saque pendente do mesmo valor e data recente (e que contenha alguma pista)
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
                { ownerName: ownerNameCandidate } // se você gravou ownerName no saque
              ]
            }
          }
        });
      }

      if (!user) {
        console.warn("[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:", transferId, "externalReference:", externalReference);
        // Responda 200 para evitar retries infinitos; coloque alerta/monitoramento se quiser.
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // localizar saque exato dentro do user.saques
      const matchPredicate = s => {
        if (externalReference) return s.externalReference === externalReference;
        // fallback: casar por valor + pix key/cpf/owner + pendente + tempo
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

      // também armazena informações bancárias retornadas (opcional)
      saque.bankAccount = bank;

      await user.save();

      console.log("[ASASS WEBHOOK] Saque atualizado:", { userId: user._id, saqueExternal: saque.externalReference, novoStatus: newStatus });

      return res.status(200).json({ success: true });
    }

    // outros eventos
    console.log("[ASASS WEBHOOK] Evento não tratado. Keys:", Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
