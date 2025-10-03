// api/webhook/asaas.js
// Webhook robusto para Asaas
// - autoriza rapidamente eventos de validação (WITHDRAW_REQUESTED / TRANSFER_PENDING)
// - quando possível, cria um saque local para transferências iniciadas via painel (sem externalReference)
// - atualiza saques para CONFIRMED / FAILED / PENDING
// - grava failReason no saque

import connectDB from "../db.js";
import { User } from "../schema.js";

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const MATCH_WINDOW_MS = 1000 * 60 * 30; // 30 minutos
const MAX_AUTOMATIC_UI = parseFloat(process.env.MAX_AUTOMATIC_UI || "0.00"); // valor máximo para autorizar UI sem usuário

function now() { return new Date().toISOString(); }

// Helper: tentativa de criar/conferir um saque local sem bloquear a resposta
async function createLocalSaqueIfNeeded(payload) {
  try {
    await connectDB();

    const t = payload.transfer || payload;
    const pixKeyRaw = (t.bankAccount && t.bankAccount.pixAddressKey) || t.pixAddressKey || null;
    const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, "") : null;
    const ownerName = (t.bankAccount && t.bankAccount.ownerName) || null;
    const externalReference = t.externalReference || null;
    const asaasId = t.id || null;
    const value = typeof t.value === 'number' ? t.value : Number(t.value);

    if (!pixKey || isNaN(value) || value <= 0) {
      console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: falta pixKey ou value inválido, abortando.', { pixKey, value });
      return;
    }

    // procura usuário por pix_key ou por saques com mesma chave
    const user = await User.findOne({
      $or: [ { pix_key: pixKey }, { 'saques.chave_pix': pixKey } ]
    });

    if (!user) {
      console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: nenhum usuário encontrado para pixKey', pixKey);
      return;
    }

    const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

    const existing = user.saques.find(s => {
      // considera matches por externalReference / asaasId / mesma chave+valor+tempo
      if (s.externalReference && externalReference && s.externalReference === externalReference) return true;
      if (s.asaasId && asaasId && s.asaasId === asaasId) return true;
      const sPix = (s.chave_pix || '').replace(/[^0-9]/g, '');
      const samePix = sPix === pixKey;
      const sameValue = Number(s.valor) === Number(value);
      const recent = new Date(s.data).getTime() >= cutoff.getTime();
      return s.status === 'PENDING' && samePix && sameValue && recent;
    });

    if (existing) {
      console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: saque já existe, não criando.');
      return;
    }

    // criar novo saque local
    const novoSaque = {
      valor: value,
      chave_pix: pixKey,
      tipo_chave: 'CPF', // ajuste se precisar inferir dinamicamente
      status: 'PENDING',
      data: new Date(),
      asaasId: asaasId || null,
      externalReference: externalReference || `ui_${asaasId || Date.now()}`,
      ownerName: ownerName || user.nome || null,
      bankAccount: t.bankAccount || null,
      rawTransfer: t,                 // salva o JSON do transfer para suporte/auditoria
      createdBy: 'webhook_ui_auto'    // meta para rastrear criação automática
    };

    user.saques.push(novoSaque);
    await user.save();
    console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: novo saque criado localmente para transfer UI:', novoSaque.externalReference);

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro em createLocalSaqueIfNeeded:', err);
  }
}

// Handler auxiliar para eventos de validação — agora responde rápido e faz gravações em background
async function handleValidationEvent(body, res) {
  try {
    const t = body.transfer || body;
    const value = typeof t.value === 'number' ? t.value : Number(t.value);
    const bank = t.bankAccount || {};
    const pixKeyRaw = bank.pixAddressKey || t.pixAddressKey || null;
    const cpfRaw = bank.cpfCnpj || t.cpfCnpj || null;
    const ownerNameRaw = bank.ownerName || t.ownerName || null;

    const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/[^0-9]/g, '') : null;
    const cpf = cpfRaw ? String(cpfRaw).replace(/[^0-9]/g, '') : null;
    const ownerName = ownerNameRaw ? String(ownerNameRaw).trim() : null;

    console.log('[ASASS WEBHOOK][VALIDATION] (fast) dados:', { id: t.id, value, pixKey, cpf, ownerName });

    // validação rápida: valor inválido -> negar rápido
    if (!value || isNaN(value) || value <= 0) {
      console.log('[ASASS WEBHOOK][VALIDATION] invalid value -> deny');
      console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'invalid_value' });
      return res.status(200).json({ authorized: false, reason: 'invalid_value' });
    }

    // tenta achar user/saque rapidamente (conexão DB pode demorar; minimizamos queries)
    try {
      await connectDB();
    } catch (errConn) {
      console.error('[ASASS WEBHOOK][VALIDATION] connectDB error (will deny):', errConn);
      console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'db_connect_error' });
      return res.status(200).json({ authorized: false, reason: 'db_connect_error' });
    }

    // busca rápida por externalReference direto
    let user = null;
    let matchingSaque = null;

    if (t.externalReference) {
      user = await User.findOne({ 'saques.externalReference': t.externalReference }, { 'saques.$': 1, saldo: 1 });
      if (user && user.saques && user.saques.length) matchingSaque = user.saques[0];
    }

    // fallback por pixKey + valor recente (uma única query)
    if (!user && pixKey) {
      const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
      user = await User.findOne({
        saques: {
          $elemMatch: {
            status: 'PENDING',
            valor: value,
            data: { $gte: cutoff },
            chave_pix: pixKey
          }
        }
      }, { saques: 1, saldo: 1 });
      if (user && user.saques) {
        matchingSaque = user.saques.find(s => (s.chave_pix && s.chave_pix.replace(/\D/g,'') === pixKey && Number(s.valor) === Number(value)));
      }
    }

    // RULE 1: user + matchingSaque -> authorize quickly and background-save details
    if (user && matchingSaque) {
      console.log('[ASASS WEBHOOK][VALIDATION] Found user+saque -> quick authorize', { userId: user._id, saqueExt: matchingSaque.externalReference });
      console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: true });

      // respondemos IMEDIATAMENTE
      res.status(200).json({ authorized: true });

      // EM BACKGROUND: atualiza matchingSaque com asaasId/rawTransfer se necessário
      (async () => {
        try {
          // Re-fetch full user doc to modify array element safely
          const fullUser = await User.findOne({ _id: user._id });
          if (!fullUser) {
            console.warn('[ASASS WEBHOOK][VALIDATION][BG] fullUser not found for background update', user._id);
            return;
          }
          const s = fullUser.saques.find(x => {
            if (t.externalReference && x.externalReference) return x.externalReference === t.externalReference;
            if (x.asaasId && t.id) return x.asaasId === t.id;
            return x.chave_pix && x.chave_pix.replace(/\D/g,'') === (pixKey || '') && Number(x.valor) === Number(value);
          });
          if (s) {
            if (!s.asaasId && t.id) s.asaasId = t.id;
            if (!s.externalReference && t.externalReference) s.externalReference = t.externalReference;
            if (!s.rawTransfer) s.rawTransfer = t;
            await fullUser.save();
            console.log('[ASASS WEBHOOK][VALIDATION][BG] backfill saved for saque:', s.externalReference || t.id);
          } else {
            console.log('[ASASS WEBHOOK][VALIDATION][BG] saque não encontrado no fullUser para backfill', { userId: user._id, tId: t.id });
          }
        } catch (errBg) {
          console.error('[ASASS WEBHOOK][VALIDATION][BG] background save error:', errBg);
        }
      })();

      return; // já respondemos, não executar mais
    }

    // RULE 2: user found but no matchingSaque -> check balance and quick authorize/deny
    if (user && !matchingSaque) {
      const saldo = Number(user.saldo || 0);
      if (saldo < value) {
        console.log('[ASASS WEBHOOK][VALIDATION] user found but insufficient balance -> deny', { userId: user._id, saldo, value });
        console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'insufficient_balance' });
        return res.status(200).json({ authorized: false, reason: 'insufficient_balance' });
      }

      // autorizar rápido e criar a reserva em background
      console.log('[ASASS WEBHOOK][VALIDATION] user found and sufficient balance -> quick authorize & create in background', { userId: user._id, value });
      console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: true });
      res.status(200).json({ authorized: true });

      (async () => {
        try {
          const fullUser = await User.findOne({ _id: user._id });
          if (!fullUser) {
            console.warn('[ASASS WEBHOOK][VALIDATION][BG] fullUser not found for reserve creation', user._id);
            return;
          }

          const newSaque = {
            valor: value,
            chave_pix: pixKey || (cpf || null),
            tipo_chave: cpf ? 'CPF' : (pixKey ? 'CPF' : 'UNKNOWN'),
            status: 'PENDING',
            data: new Date(),
            asaasId: t.id || null,
            externalReference: t.externalReference || `ui_${t.id || Date.now()}`,
            ownerName: ownerName || fullUser.nome || null,
            bankAccount: bank || null,
            rawTransfer: t,
            createdBy: 'webhook_validation'
          };

          fullUser.saldo = Number(fullUser.saldo || 0) - Number(value);
          fullUser.saques.push(newSaque);
          await fullUser.save();
          console.log('[ASASS WEBHOOK][VALIDATION][BG] created reserva and saved:', newSaque.externalReference);
        } catch (errBgCreate) {
          console.error('[ASASS WEBHOOK][VALIDATION][BG] erro ao criar saque em background:', errBgCreate);
        }
      })();

      return;
    }

    // RULE 3: no user -> policy: allow small amounts if configured, otherwise deny
    if (!user) {
      if (value <= MAX_AUTOMATIC_UI && MAX_AUTOMATIC_UI > 0) {
        console.log('[ASASS WEBHOOK][VALIDATION] no user but small value -> auto allow', { value });
        console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: true, note: 'auto_allowed_small_ui' });
        return res.status(200).json({ authorized: true, note: 'auto_allowed_small_ui' });
      }

      console.log('[ASASS WEBHOOK][VALIDATION] no user found -> deny', { value });
      console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'no_user_match' });
      return res.status(200).json({ authorized: false, reason: 'no_user_match' });
    }

    // fallback deny (shouldn't reach)
    console.log('[ASASS WEBHOOK][VALIDATION] fallback deny');
    console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'fallback_deny' });
    return res.status(200).json({ authorized: false, reason: 'fallback_deny' });

  } catch (err) {
    console.error('[ASASS WEBHOOK][VALIDATION] unexpected error:', err);
    console.log('[ASASS WEBHOOK][VALIDATION] RESPONDING:', { authorized: false, reason: 'internal_error' });
    return res.status(200).json({ authorized: false, reason: 'internal_error' });
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    console.log(`[ASASS WEBHOOK] RECEIVED - ${now()}`);
    console.log('[ASASS WEBHOOK] headers:', headers);
    console.log('[ASASS WEBHOOK] body:', JSON.stringify(body, null, 2));

    if (WEBHOOK_TOKEN) {
      const incomingToken = headers['asaas-access-token'] || headers['Asaas-Access-Token'] || headers['x-asaas-token'];
      console.log('[ASASS WEBHOOK] incomingToken:', incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn('[ASASS WEBHOOK] Token inválido:', incomingToken);
        return res.status(401).json({ error: 'invalid webhook token' });
      }
    }

    const event = body?.event;
    const type = body?.type;
    const transfer = body?.transfer;

    const looksLikeValidationEvent =
      event === 'WITHDRAW_REQUESTED' ||
      type === 'WITHDRAW_REQUESTED' ||
      event === 'TRANSFER_PENDING' ||
      event === 'TRANSFER_REQUESTED' ||
      (type === 'TRANSFER' && transfer && transfer.status === 'PENDING' && transfer.authorized === false);

    if (looksLikeValidationEvent) {
      // use o handler que aplica regras (autoriza por dados bancários/pix/valor)
      return handleValidationEvent(body, res);
    }

    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));

    if (isTransferEvent) {
      const t = transfer || body;
      console.log('[ASASS WEBHOOK] Processing transfer event:', { id: t.id, status: t.status || event, externalReference: t.externalReference, value: t.value });

      // === Novo: se for TRANSFER CREATED / PENDING sem externalReference, tente criar saque local primeiro ===
      try {
        if ((t.status === 'PENDING' || t.status === 'CREATED' || (event === 'TRANSFER_CREATED')) && !t.externalReference) {
          console.log('[ASASS WEBHOOK] Transfer PENDING sem externalReference detectado — tentando criar saque local para UI (para permitir matching futuro).');
          await createLocalSaqueIfNeeded(body);
        }
      } catch (e) {
        console.error('[ASASS WEBHOOK] Erro ao tentar createLocalSaqueIfNeeded previamente:', e);
      }
      // =================================================================================================

      await connectDB();

      const transferId = t.id;
      const statusRaw = (t.status || event || '').toString();
      const statusNormalized = statusRaw.includes('CONFIRMED') ? 'CONFIRMED'
        : statusRaw.includes('FAILED') ? 'FAILED'
        : statusRaw.includes('DONE') ? 'CONFIRMED' // alguns eventos usam DONE
        : statusRaw.includes('PENDING') ? 'PENDING'
        : statusRaw.toUpperCase();

      const externalReference = t.externalReference || null;
      const bank = t.bankAccount || {};

      let user = null;
      let saque = null;

      // 1) procurar por saques já atrelados ao asaasId
      user = await User.findOne({ 'saques.asaasId': transferId });
      if (user) {
        saque = user.saques.find(s => s.asaasId === transferId);
        console.log('[ASASS WEBHOOK] Encontrado por asaasId.');
      }

      // 2) se não, procurar por externalReference se existir
      if (!user && externalReference) {
        user = await User.findOne({ 'saques.externalReference': externalReference });
        if (user) saque = user.saques.find(s => s.externalReference === externalReference);
        console.log('[ASASS WEBHOOK] Procurou por externalReference:', externalReference, 'achou:', !!saque);
      }

      // 3) se não, procurar por externalReference ui_<transferId> (criados por fallback)
      if (!user) {
        const uiRef = `ui_${transferId}`;
        user = await User.findOne({ 'saques.externalReference': uiRef });
        if (user) saque = user.saques.find(s => s.externalReference === uiRef);
        if (saque) console.log('[ASASS WEBHOOK] Encontrado por uiRef:', uiRef);
      }

      // 4) fallback tolerante: pixKey + valor + janela de tempo
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
              const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
              const valueMatch = Number(s.valor) === Number(valueCandidate);
              const pixMatch = pixKeyCandidate ? (s.chave_pix === pixKeyCandidate || s.chave_pix.replace(/\D/g, '') === String(pixKeyCandidate).replace(/\D/g, '')) : false;
              const cpfMatch = cpfCnpjCandidate ? (s.chave_pix.replace(/\D/g, '') === cpfCnpjCandidate) : false;
              const ownerMatch = ownerNameCandidate ? (s.ownerName && s.ownerName.trim().toLowerCase() === ownerNameCandidate) : false;
              return s.status === 'PENDING' && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
            });

            if (saque) console.log('[ASASS WEBHOOK] Encontrado por fallback (pix+valor+tempo).');
          }
        }
      }

      // 5) Se nada encontrado e status PENDING => tentar criar saque local (salva asaasId e ui_<id>)
      if (!user && statusNormalized === 'PENDING') {
        try {
          console.log('[ASASS WEBHOOK] Nenhum user encontrado e transfer PENDING -> tentando createLocalSaqueIfNeeded agora.');
          await createLocalSaqueIfNeeded({ transfer: t });
          // tentar buscar novamente por ui_<id> ou asaasId
          const uiRef = `ui_${transferId}`;
          user = await User.findOne({ 'saques.externalReference': uiRef });
          if (user) saque = user.saques.find(s => s.externalReference === uiRef || s.asaasId === transferId);
          if (!user) {
            // tentar por pix_key
            const pixKeyCandidate = bank.pixAddressKey ? String(bank.pixAddressKey).replace(/[^0-9]/g, '') : null;
            if (pixKeyCandidate) {
              user = await User.findOne({ $or: [ { pix_key: pixKeyCandidate }, { 'saques.chave_pix': pixKeyCandidate } ] });
              if (user) {
                saque = user.saques.find(s => (s.asaasId === transferId) || (s.externalReference === `ui_${transferId}`) || (s.valor === t.value && s.chave_pix && s.chave_pix.replace(/\D/g,'') === pixKeyCandidate));
              }
            }
          }
        } catch (errCreate) {
          console.error('[ASASS WEBHOOK] Erro ao createLocalSaqueIfNeeded no fluxo PENDING:', errCreate);
        }
      }

      if (!user) {
        console.warn('[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:', transferId, 'externalReference:', externalReference);
        // opcional: salvar em coleção unmatched_transfers para investigação manual
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      if (!saque) {
        console.warn('[ASASS WEBHOOK] User encontrado mas saque exato não localizado. userId:', user._id);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      // atualizar status previsível
      const newStatus = (statusNormalized === 'CONFIRMED') ? 'pago'
        : (statusNormalized === 'FAILED') ? 'falhou'
        : (statusNormalized === 'PENDING') ? 'pendente'
        : statusNormalized.toLowerCase();

      saque.status = newStatus;
      if (!saque.asaasId) saque.asaasId = transferId;
      saque.bankAccount = bank;
      if (t.failReason) saque.failReason = t.failReason;

      // se falhou, opcionalmente faça reembolso automático (atenção à sua política)
      if (newStatus === 'falhou') {
        if (!saque.refunded) {
          const refundAmount = Number(saque.valor || 0);
          user.saldo = Number(user.saldo || 0) + refundAmount;
          saque.refunded = true;
          saque.refundAt = new Date();
          console.log('[ASASS WEBHOOK] Reembolsando valor do saque FAILED em background:', { userId: user._id, refundAmount });
        } else {
          console.log('[ASASS WEBHOOK] Saque já marcado como reembolsado:', saque.externalReference);
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
