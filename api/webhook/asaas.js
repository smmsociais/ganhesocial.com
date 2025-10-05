import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos
const MAX_AUTOMATIC_UI = parseFloat(process.env.MAX_AUTOMATIC_UI || "0.00"); // valor máximo para autorizar UI sem usuário

function now() { return new Date().toISOString(); }

/**
 * findOrCreateSaqueForUITransfer
 * tenta encontrar usuário/saque por pix+valor e (se não encontrar) cria um saque 'ui_<id>'.
 */
async function findOrCreateSaqueForUITransfer(t) {
  try {
    await connectDB();
    const pixKeyRaw = t.bankAccount?.pixAddressKey || t.pixAddressKey || null;
    const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, '') : null;
    const value = typeof t.value === 'number' ? t.value : Number(t.value);
    if (!pixKey || !value || isNaN(value)) {
      console.log('[ASASS WEBHOOK] findOrCreateSaqueForUITransfer: pixKey ou value inválidos', { pixKey, value });
      return null;
    }

    const rawId = t.id || null;
    const normalizedId = rawId ? String(rawId).split('&')[0] : null;

    const user = await User.findOne({
      $or: [
        { pix_key: pixKey },
        { 'saques.chave_pix': pixKey }
      ]
    });

    if (!user) {
      console.log('[ASASS WEBHOOK] Nenhum usuário para transferência UI (pix):', pixKey);
      return null;
    }

    const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
    const existingSaque = user.saques.find(s =>
      (s.chave_pix && s.chave_pix.replace(/\D/g, '') === pixKey) &&
      Number(s.valor) === Number(value) &&
      new Date(s.data) >= cutoff &&
      s.status === 'PENDING'
    );

    if (existingSaque) {
      if (!existingSaque.id && normalizedId) existingSaque.id = normalizedId;
      if (!existingSaque.externalReference) existingSaque.externalReference = t.externalReference || `ui_${normalizedId}`;
      if (!existingSaque.rawTransfer) existingSaque.rawTransfer = t;
      await user.save();
      console.log('[ASASS WEBHOOK] Saque existente atualizado para transfer UI:', existingSaque.externalReference || existingSaque.id);
      return existingSaque;
    }

    const novoSaque = {
      valor: value,
      chave_pix: pixKey,
      tipo_chave: 'CPF',
      status: 'PENDING',
      data: new Date(),
      id: normalizedId,
      externalReference: t.externalReference || `ui_${normalizedId}`,
      ownerName: t.bankAccount?.ownerName || user.nome || null,
      rawTransfer: t,
      createdBy: 'webhook_ui_auto'
    };

    user.saques.push(novoSaque);
    await user.save();
    console.log('[ASASS WEBHOOK] Saque criado para transferência UI:', novoSaque.externalReference);
    return novoSaque;

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro em findOrCreateSaqueForUITransfer:', err);
    return null;
  }
}

/**
 * handleValidationEvent
 */
async function handleValidationEvent(body, res) {
  try {
    const t = body.transfer || body;

    const rawTransferId = (t && (t.id || t.transferId)) || body?.id || null;
    const transferId = rawTransferId ? String(rawTransferId).split('&')[0] : null;

    console.log('[ASASS WEBHOOK][VALIDATION] QUICK RESPOND status:APPROVED for id:', transferId);
    res.status(200).json({ status: "APPROVED" });

    setTimeout(async () => {
      try {
        await connectDB();

        const value = typeof t.value === 'number' ? t.value : Number(t.value);
        const pixKeyRaw = t.bankAccount?.pixAddressKey || t.pixAddressKey || null;
        const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, '') : null;
        const cpfRaw = t.bankAccount?.cpfCnpj || t.cpfCnpj || null;
        const cpf = cpfRaw ? String(cpfRaw).replace(/[^0-9]/g, '') : null;
        const ownerName = t.bankAccount?.ownerName || t.ownerName || null;

        console.log('[ASASS WEBHOOK][VALIDATION][BG] Processando em background:', { id: transferId, value, pixKey, externalReference: t.externalReference });

        let user = null;
        if (t.externalReference) {
          user = await User.findOne({ 'saques.externalReference': t.externalReference });
        }

        if (!user && pixKey) {
          const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
          user = await User.findOne({
            $or: [{ pix_key: pixKey }, { 'saques.chave_pix': pixKey }],
            saques: {
              $elemMatch: {
                status: 'PENDING',
                valor: value,
                data: { $gte: cutoff }
              }
            }
          });
        }

        if (!user && !t.externalReference) {
          const created = await findOrCreateSaqueForUITransfer(t);
          if (created) {
            console.log('[ASASS WEBHOOK][VALIDATION][BG] created saque for UI transfer in background:', created.externalReference || created.id);
            return;
          }
        }

        if (user) {
          const existingSaque = user.saques.find(s =>
            (t.externalReference && s.externalReference === t.externalReference) ||
            (transferId && s.id === transferId) ||
            (s.chave_pix && pixKey && s.chave_pix.replace(/\D/g, '') === pixKey && Number(s.valor) === Number(value) && s.status === 'PENDING')
          );

          if (existingSaque) {
            if (!existingSaque.id && transferId) existingSaque.id = transferId;
            if (!existingSaque.externalReference && t.externalReference) existingSaque.externalReference = t.externalReference;
            if (!existingSaque.rawTransfer) existingSaque.rawTransfer = t;
            await user.save();
            console.log('[ASASS WEBHOOK][VALIDATION][BG] Existing saque updated for transfer:', existingSaque.externalReference || existingSaque.id);
            return;
          }

          const saldo = Number(user.saldo || 0);
          if (saldo >= value) {
            const novoSaque = {
              valor: value,
              chave_pix: pixKey || (cpf || null),
              tipo_chave: cpf ? 'CPF' : (pixKey ? 'CPF' : 'UNKNOWN'),
              status: 'PENDING',
              data: new Date(),
              id: transferId,
              externalReference: t.externalReference || `ui_${transferId || Date.now()}`,
              ownerName: ownerName || user.nome || null,
              rawTransfer: t,
              createdBy: 'webhook_validation_bg'
            };
            user.saldo = saldo - value;
            user.saques.push(novoSaque);
            await user.save();
            console.log('[ASASS WEBHOOK][VALIDATION][BG] Created new saque and reserved amount:', novoSaque.externalReference);
          } else {
            console.log('[ASASS WEBHOOK][VALIDATION][BG] User found but insufficient balance, skipping create', { userId: user._id, saldo, value });
          }
        } else {
          console.log('[ASASS WEBHOOK][VALIDATION][BG] Nenhum usuário encontrado para transfer (bg):', { pixKey, value, externalReference: t.externalReference });
        }

      } catch (errBg) {
        console.error('[ASASS WEBHOOK][VALIDATION][BG] Erro em background:', errBg);
      }
    }, 100);

    return;
  } catch (err) {
    console.error('[ASASS WEBHOOK][VALIDATION] Erro imediato:', err);
    try { res.status(200).json({ status: "REFUSED", refuseReason: 'internal_error' }); } catch(e){}
    return;
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    console.log(`[ASASS WEBHOOK] RECEIVED - ${now()}`);
    console.log('[ASASS WEBHOOK] headers:', Object.keys(headers));
    console.log('[ASASS WEBHOOK] body event/type:', body.event, body.type);

    if (WEBHOOK_TOKEN) {
      const incomingToken = headers['asaas-access-token'] || headers['Asaas-Access-Token'] || headers['x-asaas-token'];
      console.log('[ASASS WEBHOOK] incomingToken present:', !!incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn('[ASASS WEBHOOK] Token inválido recebido:', incomingToken);
        return res.status(401).json({ error: 'invalid webhook token' });
      }
    }

    const event = body?.event;
    const type = body?.type;
    const transfer = body?.transfer;

    const isValidationEvent =
      event === 'WITHDRAW_REQUESTED' ||
      event === 'TRANSFER_PENDING' ||
      event === 'TRANSFER_REQUESTED' ||
      (type === 'TRANSFER' && transfer && transfer.status === 'PENDING' && transfer.authorized === false);

    if (isValidationEvent) {
      return handleValidationEvent(body, res);
    }

    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));
    if (isTransferEvent) {
      const t = transfer || body;

      const rawTransferId = (t && (t.id || t.transferId)) || body?.id || null;
      const transferId = rawTransferId ? String(rawTransferId).split('&')[0] : null;

      console.log('[ASASS WEBHOOK] Processing transfer event:', { id: transferId, status: t.status, externalReference: t.externalReference });

      if (!t.externalReference && (t.status === 'PENDING' || event === 'TRANSFER_CREATED')) {
        try { await findOrCreateSaqueForUITransfer(t); } catch (errUi) { console.error(errUi); }
      }

      await connectDB();

      const statusRaw = (t.status || event || '').toString();
      const statusNormalized = statusRaw.includes('CONFIRMED') ? 'CONFIRMED'
        : statusRaw.includes('FAILED') ? 'FAILED'
        : statusRaw.includes('DONE') ? 'CONFIRMED'
        : statusRaw.includes('PENDING') ? 'PENDING'
        : statusRaw.toUpperCase();

      const externalReference = t.externalReference || null;
      const bank = t.bankAccount || {};

      let user = null;
      let saque = null;

      user = await User.findOne({ 'saques.id': transferId });
      if (user) saque = user.saques.find(s => s.id === transferId);

      if (!user && externalReference) {
        user = await User.findOne({ 'saques.externalReference': externalReference });
        if (user) saque = user.saques.find(s => s.externalReference === externalReference);
      }

      if (!user) {
        const uiRef = `ui_${transferId}`;
        user = await User.findOne({ 'saques.externalReference': uiRef });
        if (user) saque = user.saques.find(s => s.externalReference === uiRef);
      }

      if (!user) {
        const pixKeyCandidate = bank.pixAddressKey || t.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? String(bank.cpfCnpj).replace(/[^0-9]/g, '') : null;
        const ownerNameCandidate = bank.ownerName ? bank.ownerName.trim().toLowerCase() : null;
        const valueCandidate = t.value;
        const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

        if (valueCandidate != null) {
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
              const pixMatch = pixKeyCandidate ? (s.chave_pix === pixKeyCandidate || s.chave_pix.replace(/\D/g, '') === String(pixKeyCandidate).replace(/\D/g, '')) : false;
              const cpfMatch = cpfCnpjCandidate ? (s.chave_pix.replace(/\D/g, '') === cpfCnpjCandidate) : false;
              const ownerMatch = ownerNameCandidate ? (s.ownerName && s.ownerName.trim().toLowerCase() === ownerNameCandidate) : false;
              return s.status === 'PENDING' && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
            });
          }
        }
      }

      if (!user) {
        console.warn('[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:', transferId, 'externalReference:', externalReference);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      if (!saque) {
        console.warn('[ASASS WEBHOOK] User encontrado mas saque exato não localizado. userId:', user._id);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      const newStatus = (statusNormalized === 'DONE') ? 'DONE'
        : (statusNormalized === 'FAILED') ? 'FAILED'
        : (statusNormalized === 'PENDING') ? 'PENDING'
        : statusNormalized.toLowerCase();

      saque.status = newStatus;
      if (!saque.id) saque.id = transferId;
      saque.bankAccount = bank;
      if (t.failReason) saque.failReason = t.failReason;

      if (newStatus === 'falhou') {
        if (!saque.refunded) {
          const refundAmount = Number(saque.valor || 0);
          user.saldo = Number(user.saldo || 0) + refundAmount;
          saque.refunded = true;
          saque.refundAt = new Date();
          console.log('[ASASS WEBHOOK] Reembolsando valor do saque FAILED em background:', { userId: user._id, refundAmount });
        }
      }

      await user.save();
      console.log('[ASASS WEBHOOK] Saque atualizado:', { userId: String(user._id), saqueExternal: saque.externalReference, novoStatus: newStatus, failReason: t.failReason || null });

      return res.status(200).json({ success: true });
    }

    console.log('[ASASS WEBHOOK] Evento não tratado. Keys:', Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }
}
