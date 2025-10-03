// api/webhook/woovi.js
import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.WOOVI_WEBHOOK_TOKEN || null; // antes AS*AAS token
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos
const MAX_AUTOMATIC_UI = parseFloat(process.env.MAX_AUTOMATIC_UI || "0.00"); // mantido

function now() { return new Date().toISOString(); }

/**
 * helper: extrai campos comuns do payload Woovi/OpenPix (t pode ser body ou body.charge)
 */
function normalizeTransferObject(raw) {
  // aceitar o objeto em várias formas: body, body.charge, body.pix.charge, etc.
  const t = raw || {};
  const charge = t.charge || (t.pix && t.pix.charge) || t;
  const bankAccount = t.bankAccount || charge.bankAccount || t.bank_account || {};
  const customer = charge.customer || {};
  const value = (typeof charge.value === 'number') ? charge.value : (typeof t.value === 'number' ? t.value : Number(charge.value || t.value || 0));
  const correlationID = charge.correlationID || charge.correlationId || t.correlationID || t.correlationId || null;
  const transactionID = charge.transactionID || charge.transactionId || t.transactionID || t.transactionId || null;
  const status = (charge.status || t.status || '').toString();
  const ownerName = bankAccount.ownerName || customer.name || charge.ownerName || null;
  const cpfCnpj = (customer.taxID && customer.taxID.taxID) || bankAccount.cpfCnpj || null;

  // pix key candidate may be in bankAccount.pixAddressKey or in other fields
  const pixKeyRaw = bankAccount.pixAddressKey || t.pixAddressKey || t.pix_key || null;

  return {
    raw: raw,
    charge,
    bankAccount,
    value,
    correlationID,
    transactionID,
    status,
    ownerName,
    cpfCnpj,
    pixKeyRaw
  };
}

/**
 * findOrCreateSaqueForUITransfer
 * tenta encontrar usuário/saque por pix+valor e (se não encontrar) cria um saque 'ui_<id>'.
 * usado para transfers criadas via UI que não enviam correlationID/externalReference.
 */
async function findOrCreateSaqueForUITransfer(tRaw) {
  try {
    await connectDB();
    const t = normalizeTransferObject(tRaw);

    const pixKey = t.pixKeyRaw ? String(t.pixKeyRaw).replace(/[^0-9]/g, '') : null;
    const value = Number(t.value);
    if ((!pixKey && !t.cpfCnpj) || !value || isNaN(value)) {
      console.log('[WOOVI WEBHOOK] findOrCreateSaqueForUITransfer: pixKey/cpf ou value inválidos', { pixKey, cpf: t.cpfCnpj, value });
      return null;
    }

    // buscar usuário por chave pix ou em saques
    const user = await User.findOne({
      $or: [
        { pix_key: pixKey },
        { 'saques.chave_pix': pixKey },
        { 'saques.chave_pix': t.cpfCnpj ? String(t.cpfCnpj).replace(/[^0-9]/g, '') : null }
      ]
    });

    if (!user) {
      console.log('[WOOVI WEBHOOK] Nenhum usuário para transferência UI (pix/cpf):', pixKey || t.cpfCnpj);
      return null;
    }

    // verificar saque recente (janela MATCH_WINDOW_MS)
    const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
    const existingSaque = user.saques.find(s =>
      (s.chave_pix && (s.chave_pix.replace(/\D/g, '') === (pixKey || (t.cpfCnpj ? String(t.cpfCnpj).replace(/\D/g, '') : '')))) &&
      Number(s.valor) === Number(value) &&
      new Date(s.data) >= cutoff &&
      s.status === 'PENDING'
    );

    if (existingSaque) {
      // atualizar se precisar (compatibilizar campos antigos asaasId)
      if (!existingSaque.wooviId && t.transactionID) existingSaque.wooviId = t.transactionID;
      if (!existingSaque.externalReference && t.correlationID) existingSaque.externalReference = t.correlationID;
      if (!existingSaque.rawTransfer) existingSaque.rawTransfer = t.raw;
      await user.save();
      console.log('[WOOVI WEBHOOK] Saque existente atualizado para transfer UI:', existingSaque.externalReference || existingSaque.wooviId);
      return existingSaque;
    }

    // criar novo saque para UI transfer (reserva)
    const novoSaque = {
      valor: value,
      chave_pix: pixKey || (t.cpfCnpj ? String(t.cpfCnpj).replace(/\D/g, '') : null),
      tipo_chave: t.cpfCnpj ? 'CPF' : (pixKey ? 'PIX' : 'UNKNOWN'),
      status: 'PENDING',
      data: new Date(),
      wooviId: t.transactionID || null,
      externalReference: t.correlationID || `ui_${t.transactionID || Date.now()}`,
      ownerName: t.ownerName || user.nome || null,
      rawTransfer: t.raw,
      createdBy: 'webhook_ui_auto'
    };

    // reservar valor (somente se houver saldo)
    const saldo = Number(user.saldo || 0);
    if (saldo >= Number(value)) {
      user.saldo = saldo - Number(value);
      user.saques.push(novoSaque);
      await user.save();
      console.log('[WOOVI WEBHOOK] Saque criado para transferência UI:', novoSaque.externalReference);
      return novoSaque;
    } else {
      console.log('[WOOVI WEBHOOK] Saldo insuficiente para criar saque UI:', { userId: user._id, saldo, value });
      return null;
    }
  } catch (err) {
    console.error('[WOOVI WEBHOOK] Erro em findOrCreateSaqueForUITransfer:', err);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    console.log(`[WOOVI WEBHOOK] RECEIVED - ${now()}`);
    console.log('[WOOVI WEBHOOK] headers keys:', Object.keys(headers));
    console.log('[WOOVI WEBHOOK] body keys:', Object.keys(body || {}));

    // Validação do token/authorization (campo "authorization" que você configurou ao criar o webhook)
    if (WEBHOOK_TOKEN) {
      const incomingToken = headers['authorization'] || headers['Authorization'] || headers['x-woovi-token'] || headers['x-openpix-token'];
      console.log('[WOOVI WEBHOOK] incomingToken present:', !!incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn('[WOOVI WEBHOOK] Token inválido recebido:', incomingToken);
        return res.status(401).json({ error: 'invalid webhook token' });
      }
    }

    // Normalizar objeto de transferência (aceita body, body.charge, body.pix.charge)
    const t = normalizeTransferObject(body);

    // Se payload não trouxer nada reconhecível, ignorar
    if (!t || (!t.transactionID && !t.correlationID && !t.pixKeyRaw && !t.value)) {
      console.log('[WOOVI WEBHOOK] Payload sem campos relevantes. Ignorando.', { transactionID: t.transactionID, correlationID: t.correlationID });
      return res.status(200).json({ success: true, ignored: true });
    }

    // Para transfers criadas pela UI sem correlationID, tente criar/atualizar um saque pendente
    if (!t.correlationID && (t.status === 'PENDING' || t.status === '' || t.status.toUpperCase() === 'PENDING')) {
      try {
        await findOrCreateSaqueForUITransfer(body);
      } catch (errUi) {
        console.error('[WOOVI WEBHOOK] findOrCreateSaqueForUITransfer error:', errUi);
      }
    }

    // Conecta DB e faz matching/atualização de status
    await connectDB();

    // Procura usuário/saque por wooviId (transactionID) -> externalReference (correlationID) -> ui_<id> -> fallback por pix+valor+janela
    const transferId = t.transactionID;
    const externalReference = t.correlationID || null;
    const bank = t.bankAccount || {};
    const valueCandidate = t.value;
    const pixKeyCandidate = t.pixKeyRaw ? String(t.pixKeyRaw).replace(/\D/g, '') : null;
    const cpfCnpjCandidate = t.cpfCnpj ? String(t.cpfCnpj).replace(/\D/g, '') : null;

    let user = null;
    let saque = null;

    // 1) procurar por saques já atrelados ao wooviId
    if (transferId) {
      user = await User.findOne({ $or: [{ 'saques.wooviId': transferId }, { 'saques.asaasId': transferId }] });
      if (user) saque = user.saques.find(s => (s.wooviId === transferId || s.asaasId === transferId));
    }

    // 2) procurar por externalReference (correlationID)
    if (!user && externalReference) {
      user = await User.findOne({ 'saques.externalReference': externalReference });
      if (user) saque = user.saques.find(s => s.externalReference === externalReference);
    }

    // 3) procurar por ui_<transferId>
    if (!user && transferId) {
      const uiRef = `ui_${transferId}`;
      user = await User.findOne({ 'saques.externalReference': uiRef });
      if (user) saque = user.saques.find(s => s.externalReference === uiRef);
    }

    // 4) fallback por pixKey + valor + janela
    if (!user && valueCandidate != null) {
      const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
      // procurar usuários que tenham saques PENDING com mesmo valor dentro da janela
      user = await User.findOne({
        saques: {
          $elemMatch: {
            status: 'PENDING',
            valor: valueCandidate,
            data: { $gte: cutoff }
          }
        }
      });

      if (user) {
        saque = user.saques.find(s => {
          const recent = (new Date(s.data)).getTime() >= cutoff.getTime();
          const valueMatch = Number(s.valor) === Number(valueCandidate);
          const pixMatch = pixKeyCandidate ? (s.chave_pix === pixKeyCandidate || s.chave_pix.replace(/\D/g, '') === pixKeyCandidate) : false;
          const cpfMatch = cpfCnpjCandidate ? (s.chave_pix.replace(/\D/g, '') === cpfCnpjCandidate) : false;
          const ownerMatch = (bank.ownerName && s.ownerName) ? (s.ownerName && s.ownerName.trim().toLowerCase() === bank.ownerName.trim().toLowerCase()) : false;
          return s.status === 'PENDING' && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
        });
      }
    }

    if (!user) {
      console.warn('[WOOVI WEBHOOK] Usuário/saque não encontrado para transfer:', { transferId, externalReference });
      // responder 200 para evitar retries infinitos
      return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
    }

    if (!saque) {
      console.warn('[WOOVI WEBHOOK] User encontrado mas saque exato não localizado. userId:', user._id);
      return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
    }

    // Normalizar status: OpenPix/ Woovi usa COMPLETED / PENDING / FAILED etc.
    const rawStatus = (t.status || '').toString().toUpperCase();
    const mappedStatus = rawStatus.includes('COMPLETED') || rawStatus.includes('CONFIRMED') ? 'COMPLETED'
      : rawStatus.includes('FAILED') || rawStatus.includes('CANCELLED') ? 'FAILED'
      : rawStatus.includes('PENDING') ? 'PENDING'
      : rawStatus;

    // Atualiza saque com status e ids
    saque.status = mappedStatus;
    if (!saque.wooviId && transferId) saque.wooviId = transferId;
    saque.bankAccount = bank;
    saque.rawTransfer = t.raw;

    // Se falhou, reembolsa se ainda não reembolsado
    if (mappedStatus === 'FAILED' && !saque.refunded) {
      const refundAmount = Number(saque.valor || 0);
      user.saldo = Number(user.saldo || 0) + refundAmount;
      saque.refunded = true;
      saque.refundAt = new Date();
      console.log('[WOOVI WEBHOOK] Reembolsando valor do saque FAILED:', { userId: user._id, refundAmount });
    }

    await user.save();
    console.log('[WOOVI WEBHOOK] Saque atualizado:', { userId: String(user._id), saqueExternal: saque.externalReference, novoStatus: saque.status });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[WOOVI WEBHOOK] Erro:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }
}
