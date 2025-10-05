import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos

function now() { return new Date().toISOString(); }

/**
 * findOrCreateSaqueForUITransfer
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

    const rawTransferId = t.id || null;
    const transferId = rawTransferId ? String(rawTransferId).split('&')[0] : null;

    console.log('[ASASS WEBHOOK][VALIDATION] QUICK RESPOND status:APPROVED for PIX:', t.bankAccount?.pixAddressKey);
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

        console.log('[ASASS WEBHOOK][VALIDATION][BG] Processando em background PIX:', { pixKey, value });

        if (!pixKey) {
          console.log('[ASASS WEBHOOK][VALIDATION][BG] PIX ausente, não é possível localizar usuário');
          return;
        }

        const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
        let user = await User.findOne({
          $or: [{ pix_key: pixKey }, { 'saques.chave_pix': pixKey }],
          saques: { $elemMatch: { status: 'PENDING', valor: value, data: { $gte: cutoff } } }
        });

        if (!user) {
          const created = await findOrCreateSaqueForUITransfer(t);
          if (created) {
            console.log('[ASASS WEBHOOK][VALIDATION][BG] Criado saque para UI transfer (PIX):', created.externalReference || created.id);
            return;
          }
          console.warn('[ASASS WEBHOOK][VALIDATION][BG] Nenhum usuário encontrado para PIX:', pixKey);
          return;
        }

        const existingSaque = user.saques.find(s =>
          s.chave_pix && s.chave_pix.replace(/\D/g, '') === pixKey && Number(s.valor) === Number(value) && s.status === 'PENDING'
        );

        if (!existingSaque) {
          console.log('[ASASS WEBHOOK][VALIDATION][BG] Saque não localizado para PIX:', pixKey);
          return;
        }

        existingSaque.status = t.status || 'PENDING';
        if (!existingSaque.id) existingSaque.id = transferId;
        existingSaque.bankAccount = t.bankAccount;
        if (t.failReason) existingSaque.failReason = t.failReason;

        if (existingSaque.status.toUpperCase() === 'FAILED' && !existingSaque.refunded) {
          user.saldo = (Number(user.saldo || 0) + Number(existingSaque.valor || 0));
          existingSaque.refunded = true;
          existingSaque.refundAt = new Date();
          console.log('[ASASS WEBHOOK] Reembolsando valor do saque FAILED para PIX:', pixKey);
        }

        await user.save();
        console.log('[ASASS WEBHOOK][VALIDATION][BG] Saque atualizado com PIX:', pixKey, 'status:', existingSaque.status);

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

    if (WEBHOOK_TOKEN) {
      const incomingToken = headers['asaas-access-token'] || headers['Asaas-Access-Token'] || headers['x-asaas-token'];
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

    // Eventos normais de transfer
    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));
    if (isTransferEvent) {
      const t = transfer || body;

      const pixKeyRaw = t.bankAccount?.pixAddressKey || t.pixAddressKey || null;
      const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, '') : null;

      if (!pixKey) {
        console.warn('[ASASS WEBHOOK] PIX ausente, ignorando evento.');
        return res.status(200).json({ success: true });
      }

      await connectDB();

      const value = Number(t.value || 0);
      const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

      let user = await User.findOne({
        $or: [{ pix_key: pixKey }, { 'saques.chave_pix': pixKey }],
        saques: { $elemMatch: { status: 'PENDING', valor: value, data: { $gte: cutoff } } }
      });

      if (!user) {
        await findOrCreateSaqueForUITransfer(t);
        return res.status(200).json({ success: true, message: 'Saque criado via PIX' });
      }

      let saque = user.saques.find(s =>
        s.chave_pix && s.chave_pix.replace(/\D/g, '') === pixKey && Number(s.valor) === value && s.status === 'PENDING'
      );

      if (!saque) {
        console.warn('[ASASS WEBHOOK] Saque não encontrado para PIX:', pixKey);
        return res.status(200).json({ success: true, message: 'Saque não encontrado (PIX)' });
      }

      saque.status = t.status || 'PENDING';
      saque.bankAccount = t.bankAccount;
      saque.id = t.id ? String(t.id).split('&')[0] : null;
      if (t.failReason) saque.failReason = t.failReason;

      if (saque.status.toUpperCase() === 'FAILED' && !saque.refunded) {
        user.saldo = Number(user.saldo || 0) + Number(saque.valor || 0);
        saque.refunded = true;
        saque.refundAt = new Date();
        console.log('[ASASS WEBHOOK] Reembolsando valor do saque FAILED para PIX:', pixKey);
      }

      await user.save();
      console.log('[ASASS WEBHOOK] Saque atualizado via PIX:', pixKey, 'status:', saque.status);

      return res.status(200).json({ success: true });
    }

    console.log('[ASASS WEBHOOK] Evento não tratado. Keys:', Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }
}
