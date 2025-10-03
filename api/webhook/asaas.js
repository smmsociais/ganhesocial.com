// api/webhook/asaas.js
import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos
const MAX_AUTOMATIC_UI = parseFloat(process.env.MAX_AUTOMATIC_UI || "0.00"); // valor máximo para autorizar UI sem usuário

function now() { return new Date().toISOString(); }

/**
 * findOrCreateSaqueForUITransfer
 * tenta encontrar usuário/saque por pix+valor e (se não encontrar) cria um saque 'ui_<id>'.
 * usado para transfers criadas via UI que não enviam externalReference.
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

    // buscar usuário por chave pix ou em saques
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

    // verificar saque recente
    const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
    const existingSaque = user.saques.find(s =>
      (s.chave_pix && s.chave_pix.replace(/\D/g, '') === pixKey) &&
      Number(s.valor) === Number(value) &&
      new Date(s.data) >= cutoff &&
      s.status === 'PENDING'
    );

    if (existingSaque) {
      // atualizar se precisar
      if (!existingSaque.asaasId && t.id) existingSaque.asaasId = t.id;
      if (!existingSaque.externalReference) existingSaque.externalReference = t.externalReference || `ui_${t.id}`;
      if (!existingSaque.rawTransfer) existingSaque.rawTransfer = t;
      await user.save();
      console.log('[ASASS WEBHOOK] Saque existente atualizado para transfer UI:', existingSaque.externalReference || existingSaque.asaasId);
      return existingSaque;
    }

    // criar novo saque para UI transfer
    const novoSaque = {
      valor: value,
      chave_pix: pixKey,
      tipo_chave: 'CPF',
      status: 'PENDING',
      data: new Date(),
      asaasId: t.id || null,
      externalReference: t.externalReference || `ui_${t.id}`,
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
 * Responde IMEDIATAMENTE (authorized: true) para evitar timeouts/autorizações externas.
 * Faz todo o matching/criação/atualização em background (setTimeout).
 */
async function handleValidationEvent(body, res) {
  try {
    const t = body.transfer || body;

    // RESPONDE IMEDIATAMENTE COM authorized: true
    // (se preferir restringir, altere aqui)
    console.log('[ASASS WEBHOOK][VALIDATION] QUICK RESPOND authorized:true for id:', t?.id);
    res.status(200).json({ authorized: true });

    // PROCESSAMENTO EM BACKGROUND (não bloqueia resposta)
    setTimeout(async () => {
      try {
        await connectDB();

        const value = typeof t.value === 'number' ? t.value : Number(t.value);
        const pixKeyRaw = t.bankAccount?.pixAddressKey || t.pixAddressKey || null;
        const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, '') : null;
        const cpfRaw = t.bankAccount?.cpfCnpj || t.cpfCnpj || null;
        const cpf = cpfRaw ? String(cpfRaw).replace(/[^0-9]/g, '') : null;
        const ownerName = t.bankAccount?.ownerName || t.ownerName || null;

        console.log('[ASASS WEBHOOK][VALIDATION][BG] Processando em background:', { id: t.id, value, pixKey, externalReference: t.externalReference });

        // tentar achar user por externalReference
        let user = null;
        if (t.externalReference) {
          user = await User.findOne({ 'saques.externalReference': t.externalReference });
        }

        // se não, fallback por pixKey + valor
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
          // possibilidade: transfer criada pela UI sem externalReference — tente criar/atualizar
          const created = await findOrCreateSaqueForUITransfer(t);
          if (created) {
            console.log('[ASASS WEBHOOK][VALIDATION][BG] created saque for UI transfer in background:', created.externalReference || created.asaasId);
            return;
          }
        }

        if (user) {
          // verificar se já existe saque correspondente
          const existingSaque = user.saques.find(s =>
            (t.externalReference && s.externalReference === t.externalReference) ||
            (t.id && s.asaasId === t.id) ||
            (s.chave_pix && pixKey && s.chave_pix.replace(/\D/g, '') === pixKey && Number(s.valor) === Number(value) && s.status === 'PENDING')
          );

          if (existingSaque) {
            // atualizar campos se necessário
            if (!existingSaque.asaasId && t.id) existingSaque.asaasId = t.id;
            if (!existingSaque.externalReference && t.externalReference) existingSaque.externalReference = t.externalReference;
            if (!existingSaque.rawTransfer) existingSaque.rawTransfer = t;
            await user.save();
            console.log('[ASASS WEBHOOK][VALIDATION][BG] Existing saque updated for transfer:', existingSaque.externalReference || existingSaque.asaasId);
            return;
          }

          // se não existir, criar saque pendente (reserva) e decrementar saldo
          // validamos saldo antes de criar
          const saldo = Number(user.saldo || 0);
          if (saldo >= value) {
            const novoSaque = {
              valor: value,
              chave_pix: pixKey || (cpf || null),
              tipo_chave: cpf ? 'CPF' : (pixKey ? 'CPF' : 'UNKNOWN'),
              status: 'PENDING',
              data: new Date(),
              asaasId: t.id || null,
              externalReference: t.externalReference || `ui_${t.id || Date.now()}`,
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

    // importante: já respondemos ao Asaas acima
    return;
  } catch (err) {
    console.error('[ASASS WEBHOOK][VALIDATION] Erro imediato:', err);
    // se algo grave ocorreu antes de responder, garantimos enviar algo (deny)
    try { res.status(200).json({ authorized: false, reason: 'internal_error' }); } catch(e){}
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

    // Token de validação do webhook (se configurado)
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

    // EVENTOS DE VALIDAÇÃO — responder rápido sempre
    const isValidationEvent =
      event === 'WITHDRAW_REQUESTED' ||
      event === 'TRANSFER_PENDING' ||
      event === 'TRANSFER_REQUESTED' ||
      (type === 'TRANSFER' && transfer && transfer.status === 'PENDING' && transfer.authorized === false);

    if (isValidationEvent) {
      return handleValidationEvent(body, res);
    }

    // EVENTOS DE TRANSFERÊNCIA (status updates) — processar normalmente
    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));
    if (isTransferEvent) {
      const t = transfer || body;
      console.log('[ASASS WEBHOOK] Processing transfer event:', { id: t.id, status: t.status, externalReference: t.externalReference });

      // para transfers UI sem externalReference, tente criar saque antes do matching
      if (!t.externalReference && (t.status === 'PENDING' || event === 'TRANSFER_CREATED')) {
        try {
          await findOrCreateSaqueForUITransfer(t);
        } catch (errUi) {
          console.error('[ASASS WEBHOOK] findOrCreateSaqueForUITransfer error:', errUi);
        }
      }

      // Conecta DB e faz matching/atualização de status
      await connectDB();

      const transferId = t.id;
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

      // 1) procurar por saques já atrelados ao asaasId
      user = await User.findOne({ 'saques.asaasId': transferId });
      if (user) saque = user.saques.find(s => s.asaasId === transferId);

      // 2) procurar por externalReference
      if (!user && externalReference) {
        user = await User.findOne({ 'saques.externalReference': externalReference });
        if (user) saque = user.saques.find(s => s.externalReference === externalReference);
      }

      // 3) procurar por ui_<transferId>
      if (!user) {
        const uiRef = `ui_${transferId}`;
        user = await User.findOne({ 'saques.externalReference': uiRef });
        if (user) saque = user.saques.find(s => s.externalReference === uiRef);
      }

      // 4) fallback por pixKey + valor + janela
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

      // atualizar status previsível
      const newStatus = (statusNormalized === 'DONE') ? 'DONE'
        : (statusNormalized === 'FAILED') ? 'FAILED'
        : (statusNormalized === 'PENDING') ? 'PENDING'
        : statusNormalized.toLowerCase();

      saque.status = newStatus;
      if (!saque.asaasId) saque.asaasId = transferId;
      saque.bankAccount = bank;
      if (t.failReason) saque.failReason = t.failReason;

      // se falhou, opcionalmente reembolsa
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
