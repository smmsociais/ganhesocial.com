// /api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

/**
 * Webhook handler robusto para Asaas
 * - trata WITHDRAW_REQUESTED (autoriza)
 * - trata TRANSFER (atualiza status)
 * - tenta casar por externalReference; se null, tenta casar por pixKey+amount+recentTimestamp
 */

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN; // opcional — configure no painel Asaas

// tempo de busca por coincidência quando externalReference for null (ms)
const MATCH_WINDOW_MS = 1000 * 60 * 10; // 10 minutos

export default async function handler(req, res) {
  try {
    const body = req.body || {};

    // Validar token de webhook (se tiver configurado no painel)
    if (WEBHOOK_TOKEN) {
      const incomingToken = req.headers["asaas-access-token"] || req.headers["Asaas-Access-Token"] || req.headers["x-asaas-token"];
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn("Webhook: token inválido", incomingToken);
        return res.status(401).json({ error: "invalid webhook token" });
      }
    }

    // --- 1) Validação de saque (Asaas pergunta se autoriza) ---
    // Pode vir com body.event === "WITHDRAW_REQUESTED" ou formato diferente; cheque com optional chaining
    if (body?.event === "WITHDRAW_REQUESTED" || (body?.type === "WITHDRAW_REQUESTED")) {
      // Se quiser, você pode inspecionar body.transfer (valor, externalReference, pixKey) antes de autorizar
      console.log("[ASASS WEBHOOK] WITHDRAW_REQUESTED recebido:", {
        externalReference: body?.transfer?.externalReference ?? body?.externalReference,
        amount: body?.transfer?.value ?? body?.value,
        pix: body?.transfer?.pixAddressKey ?? body?.transfer?.bankAccount?.pixAddressKey
      });

      // Regra de exemplo: autorizar sempre. Substitua por regras suas se desejar.
      return res.status(200).json({ authorized: true });
    }

    // --- 2) Evento de TRANSFER (notificação de status) ---
    if (body?.type === "TRANSFER" && body.transfer) {
      console.log("[ASASS WEBHOOK] TRANSFER recebido:", {
        id: body.transfer.id,
        status: body.transfer.status,
        externalReference: body.transfer.externalReference,
        value: body.transfer.value,
      });

      await connectDB();

      const transfer = body.transfer;
      const transferId = transfer.id;
      const status = transfer.status; // PENDING | CONFIRMED | FAILED | etc.
      const externalReference = transfer.externalReference || null;

      let user = null;
      let saque = null;

      if (externalReference) {
        // Busca direta por externalReference
        user = await User.findOne({ "saques.externalReference": externalReference });
      } else {
        // Quando externalReference for nulo (ex.: criação via painel),
        // tente casar por chave PIX + valor + janela de tempo (últimos MATCH_WINDOW_MS)
        const pixKeyCandidate = transfer.bankAccount?.pixAddressKey || transfer.pixAddressKey || null;
        const valueCandidate = transfer.value;

        if (pixKeyCandidate && valueCandidate != null) {
          // procura usuário que tenha um saque pendente com mesma chave, mesmo valor e data recente
          const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

          user = await User.findOne({
            saques: {
              $elemMatch: {
                chave_pix: { $in: [pixKeyCandidate, pixKeyCandidate.replace(/\D/g, "")] },
                valor: valueCandidate,
                status: "pendente",
                data: { $gte: cutoff }
              }
            }
          });
        }
      }

      if (!user) {
        console.warn("[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:", transferId, "externalReference:", externalReference);
        // Responda 200 para não ficar re-enviando (ou 404 se preferir). Retornar 200 evita retries contínuos.
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // localiza o saque correspondente
      const matchPredicate = s => {
        if (externalReference) return s.externalReference === externalReference;
        // se externalReference nulo usamos o casamento por chave+valor
        const pixMatch = (transfer.bankAccount?.pixAddressKey && (s.chave_pix === transfer.bankAccount.pixAddressKey || s.chave_pix === transfer.bankAccount.pixAddressKey.replace(/\D/g, "")));
        const valueMatch = (s.valor === transfer.value);
        const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
        return pixMatch && valueMatch && s.status === "pendente" && recent;
      };

      saque = user.saques.find(matchPredicate);
      if (!saque) {
        console.warn("[ASASS WEBHOOK] Saque não encontrado mesmo após buscar usuário. transferId:", transferId);
        return res.status(200).json({ success: true, message: "saque not found (ignored)" });
      }

      // atualiza status previsível
      const newStatus = (status === "CONFIRMED") ? "pago" : (status === "FAILED" ? "falhou" : (status === "PENDING" ? "pendente" : status.toLowerCase()));
      saque.status = newStatus;

      // se ainda não tem asaasId, grava
      if (!saque.asaasId) saque.asaasId = transfer.id;

      // grava mudanças
      await user.save();

      console.log("[ASASS WEBHOOK] Saque atualizado:", { userId: user._id, saqueExternal: saque.externalReference, novoStatus: newStatus });

      return res.status(200).json({ success: true });
    }

    // --- Outros eventos ou formatos não tratados ---
    console.log("[ASASS WEBHOOK] Evento não tratado. Body keys:", Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error("Erro webhook Asaas:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
}
