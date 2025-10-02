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
      return s.status === 'pendente' && samePix && sameValue && recent;
    });

    if (existing) {
      console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: saque já existe, não criando.');
      return;
    }

    // criar novo saque local
    const novoSaque = {
      valor: value,
      chave_pix: pixKey,
      tipo_chave: 'CPF', // ajuste se precisar inferir
      status: 'pendente',
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

// Handler auxiliar para eventos de validação — usa regras em vez de depender do ID
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

    console.log('[ASASS WEBHOOK][VALIDATION] dados:', { value, pixKey, cpf, ownerName });

    // Tenta criar um saque local para o caso de saques iniciados pela interface (UI)
    try {
      await createLocalSaqueIfNeeded(body);
    } catch (err) {
      console.error('[ASASS WEBHOOK][VALIDATION] erro no createLocalSaqueIfNeeded:', err);
      // não interrompe o fluxo principal; continuamos com a validação normal
    }

    if (!value || isNaN(value) || value <= 0) {
      console.log('[ASASS WEBHOOK][VALIDATION] Rejeitado: valor inválido.' );
      return res.status(200).json({ authorized: false, reason: 'invalid_value' });
    }

    await connectDB();

    // 1) procurar usuário por pix_key
    let user = null;
    if (pixKey) {
      user = await User.findOne({ $or: [ { pix_key: pixKey }, { 'saques.chave_pix': pixKey } ] });
    }

    // 2) fallback por cpf
    if (!user && cpf) {
      user = await User.findOne({ $or: [ { pix_key: cpf }, { 'saques.chave_pix': cpf } ] });
    }

    const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);
    let matchingSaque = null;
    if (user) {
      matchingSaque = user.saques.find(s => {
        const sameValue = Number(s.valor) === Number(value);
        const recent = new Date(s.data).getTime() >= cutoff.getTime();
        const pixMatch = pixKey ? (s.chave_pix.replace(/[^0-9]/g, '') === pixKey) : false;
        const cpfMatch = cpf ? (s.chave_pix.replace(/[^0-9]/g, '') === cpf) : false;
        const ownerMatch = ownerName ? (s.ownerName && s.ownerName.trim().toLowerCase() === ownerName.trim().toLowerCase()) : false;
        return s.status === 'pendente' && recent && sameValue && (pixMatch || cpfMatch || ownerMatch);
      });
    }

    // Regra 1: user + matchingSaque
    if (user && matchingSaque) {
      console.log('[ASASS WEBHOOK][VALIDATION] Encontrado user + saque pendente. Autorizando.', { userId: user._id, saqueExt: matchingSaque.externalReference });
      if (!matchingSaque.asaasId && t.id) matchingSaque.asaasId = t.id;
      if (!matchingSaque.externalReference && t.externalReference) matchingSaque.externalReference = t.externalReference;
      // se não houver rawTransfer, salvar para auditoria
      if (!matchingSaque.rawTransfer) matchingSaque.rawTransfer = t;
      await user.save();
      return res.status(200).json({ authorized: true });
    }

    // Regra 2: user encontrado mas sem matchingSaque -> reservar e criar saque
    if (user && (!matchingSaque)) {
      const saldo = Number(user.saldo || 0);
      if (saldo < value) {
        console.log('[ASASS WEBHOOK][VALIDATION] Rejeitado: saldo insuficiente no user:', { userId: user._id, saldo, value });
        return res.status(200).json({ authorized: false, reason: 'insufficient_balance' });
      }

      const newSaque = {
        valor: value,
        chave_pix: pixKey || (cpf || null),
        tipo_chave: cpf ? 'CPF' : (pixKey ? 'CPF' : 'UNKNOWN'),
        status: 'pendente',
        data: new Date(),
        asaasId: t.id || null,
        externalReference: t.externalReference || `ui_${t.id || Date.now()}`,
        ownerName: ownerName || user.nome || null,
        bankAccount: bank || null,
        rawTransfer: t,                 // <<-- salva o JSON para suporte
        createdBy: 'webhook_validation' // marca que foi criado durante validação
      };

      user.saldo = saldo - value; // reserva o valor
      user.saques.push(newSaque);
      await user.save();
      console.log('[ASASS WEBHOOK][VALIDATION] User encontrado, saque criado e autorizado:', newSaque.externalReference);
      return res.status(200).json({ authorized: true });
    }

    // Regra 3: sem usuário -> política para UI
    if (!user) {
      if (value <= MAX_AUTOMATIC_UI && MAX_AUTOMATIC_UI > 0) {
        console.log('[ASASS WEBHOOK][VALIDATION] Nenhum user encontrado, valor <= MAX_AUTOMATIC_UI; autorizando:', value);
        return res.status(200).json({ authorized: true, note: 'auto_allowed_small_ui' });
      }

      console.log('[ASASS WEBHOOK][VALIDATION] Nenhum usuário encontrado e valor acima do limiar. Rejeitando.');
      return res.status(200).json({ authorized: false, reason: 'no_user_match' });
    }

    console.log('[ASASS WEBHOOK][VALIDATION] Fallback: rejeitando por segurança.');
    return res.status(200).json({ authorized: false, reason: 'fallback_deny' });

  } catch (err) {
    console.error('[ASASS WEBHOOK][VALIDATION] erro interno:', err);
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
      event === 'WITHDRAW_REQUESTED' ||
      (type === 'TRANSFER' && transfer && transfer.status === 'PENDING' && transfer.authorized === false);

    if (looksLikeValidationEvent) {
      // use o handler que aplica regras (autoriza por dados bancários/pix/valor)
      return handleValidationEvent(body, res);
    }

    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));

    if (isTransferEvent) {
// dentro do branch isTransferEvent, imediatamente após: const t = transfer || body;
const t = transfer || body;
console.log('[ASASS WEBHOOK] Processing transfer event:', { id: t.id, status: t.status || event, externalReference: t.externalReference, value: t.value });

// === Novo: se for TRANSFER CREATED / PENDING sem externalReference, tente criar saque local primeiro ===
try {
  if ((t.status === 'PENDING' || t.status === 'CREATED' || (event === 'TRANSFER_CREATED')) && !t.externalReference) {
    console.log('[ASASS WEBHOOK] Transfer PENDING sem externalReference detectado — tentando criar saque local para UI (para permitir matching futuro).');
    // aguardamos para garantir que o saque foi criado antes do matching
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
        : statusRaw.includes('PENDING') ? 'PENDING'
        : statusRaw.toUpperCase();

      const externalReference = t.externalReference || null;
      const bank = t.bankAccount || {};

      let user = null;
      let saque = null;

      if (externalReference) {
        user = await User.findOne({ 'saques.externalReference': externalReference });
      } else {
        const pixKeyCandidate = bank.pixAddressKey || t.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? String(bank.cpfCnpj).replace(/[^0-9]/g, '') : null;
        const ownerNameCandidate = bank.ownerName ? bank.ownerName.trim().toLowerCase() : null;
        const valueCandidate = t.value;
        const cutoff = new Date(Date.now() - MATCH_WINDOW_MS);

        user = await User.findOne({
          saques: {
            $elemMatch: {
              status: 'pendente',
              valor: valueCandidate,
              data: { $gte: cutoff },
              $or: [
                { chave_pix: pixKeyCandidate },
                { chave_pix: { $regex: pixKeyCandidate || '' } },
                { chave_pix: cpfCnpjCandidate },
                { ownerName: ownerNameCandidate }
              ]
            }
          }
        });
      }

      if (!user) {
        console.warn('[ASASS WEBHOOK] Usuário/saque não encontrado para transferId:', transferId, 'externalReference:', externalReference);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      saque = user.saques.find(s => {
        if (externalReference) return s.externalReference === externalReference;
        const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
        const valueMatch = Number(s.valor) === Number(t.value);
        const pixMatch = bank.pixAddressKey ? (s.chave_pix === bank.pixAddressKey || s.chave_pix.replace(/[^0-9]/g, '') === bank.pixAddressKey) : false;
        const cpfMatch = bank.cpfCnpj ? (s.chave_pix.replace(/[^0-9]/g, '') === String(bank.cpfCnpj).replace(/[^0-9]/g, '')) : false;
        const ownerMatch = bank.ownerName ? (s.ownerName && s.ownerName.trim().toLowerCase() === bank.ownerName.trim().toLowerCase()) : false;
        return s.status === 'pendente' && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
      });

      if (!saque) {
        console.warn('[ASASS WEBHOOK] Saque não encontrado mesmo após buscar usuário. transferId:', transferId);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      const newStatus = (statusNormalized === 'CONFIRMED') ? 'pago'
        : (statusNormalized === 'FAILED') ? 'falhou'
        : (statusNormalized === 'PENDING') ? 'pendente'
        : statusNormalized.toLowerCase();

      saque.status = newStatus;
      if (!saque.asaasId) saque.asaasId = transferId;
      saque.bankAccount = bank;
      if (t.failReason) saque.failReason = t.failReason;

      await user.save();

      console.log('[ASASS WEBHOOK] Saque atualizado:', { userId: user._id, saqueExternal: saque.externalReference, novoStatus: newStatus, failReason: t.failReason || null });

      return res.status(200).json({ success: true });
    }

    console.log('[ASASS WEBHOOK] Evento não tratado. Keys:', Object.keys(body || {}));
    return res.status(200).json({ success: true, ignored: true });

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }
}
