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

function now() { return new Date().toISOString(); }

// Helper: tentativa de criar/conferir um saque local sem bloquear a resposta
async function createLocalSaqueIfNeeded(payload) {
  try {
    await connectDB();

    const t = payload.transfer || payload;
    const pixKeyRaw = (t.bankAccount && t.bankAccount.pixAddressKey) || t.pixAddressKey || null;
    const pixKey = pixKeyRaw ? String(pixKeyRaw).replace(/\D/g, "") : null;
    const ownerName = (t.bankAccount && t.bankAccount.ownerName) || null;
    const externalReference = t.externalReference || null;
    const asaasId = t.id || null;
    const value = t.value;

    if (!pixKey || typeof value !== 'number' || value <= 0) {
      console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: falta pixKey ou value inválido, abortando.');
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
      const sPix = (s.chave_pix || '').replace(/\D/g, '');
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
      bankAccount: t.bankAccount || null
    };

    user.saques.push(novoSaque);
    await user.save();
    console.log('[ASASS WEBHOOK] createLocalSaqueIfNeeded: novo saque criado localmente para transfer UI:', novoSaque.externalReference);

  } catch (err) {
    console.error('[ASASS WEBHOOK] Erro em createLocalSaqueIfNeeded:', err);
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const headers = req.headers || {};

    console.log(`[ASASS WEBHOOK] RECEIVED - ${now()}`);
    console.log('[ASASS WEBHOOK] headers:', headers);
    console.log('[ASASS WEBHOOK] body:', JSON.stringify(body, null, 2));

    // valida token (opcional)
    if (WEBHOOK_TOKEN) {
      const incomingToken = headers['asaas-access-token'] || headers['Asaas-Access-Token'] || headers['x-asaas-token'];
      console.log('[ASASS WEBHOOK] incomingToken:', incomingToken);
      if (!incomingToken || incomingToken !== WEBHOOK_TOKEN) {
        console.warn('[ASASS WEBHOOK] Token inválido:', incomingToken);
        return res.status(401).json({ error: 'invalid webhook token' });
      }
    }

    // Detectar eventos de validação que exigem resposta rápida do seu servidor.
    // Possíveis formatos: body.event === 'WITHDRAW_REQUESTED', 'TRANSFER_PENDING', 'TRANSFER_REQUESTED'
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
      console.log('[ASASS WEBHOOK] Validation event detected. Will respond authorized:true immediately. event/type:', { event, type });

      // Fire-and-forget: tentar criar um saque local para transferências iniciadas pela interface
      // mas NÃO bloqueie a resposta — assim evitamos timeouts e recusas.
      // Observação: em ambientes serverless, tarefas em background podem ser interrompidas após resposta.
      createLocalSaqueIfNeeded(body).catch(err => {
        console.error('[ASASS WEBHOOK] Erro em background createLocalSaqueIfNeeded:', err);
      });

      // Responder rapidamente autorizando. Ajuste lógica se quiser validar por regras.
      return res.status(200).json({ authorized: true });
    }

    // Tratar notificações de transferências: tanto em body.type === 'TRANSFER' quanto em event === 'TRANSFER_*'
    const isTransferEvent = (type === 'TRANSFER' && transfer) || (typeof event === 'string' && event.startsWith('TRANSFER'));

    if (isTransferEvent) {
      // Normalizar o objeto de transferência
      const t = transfer || body;
      console.log('[ASASS WEBHOOK] Processing transfer event:', { id: t.id, status: t.status || event, externalReference: t.externalReference, value: t.value });

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
        // fallback: procurar por saque pendente com mesma chave/valor/tempo
        const pixKeyCandidate = bank.pixAddressKey || t.pixAddressKey || null;
        const cpfCnpjCandidate = bank.cpfCnpj ? String(bank.cpfCnpj).replace(/\D/g, '') : null;
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
        // Responda 200 para evitar retries infinitos do Asaas; registre para investigação.
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      // localizar o saque exato
      saque = user.saques.find(s => {
        if (externalReference) return s.externalReference === externalReference;
        const recent = (new Date(s.data)).getTime() >= (Date.now() - MATCH_WINDOW_MS);
        const valueMatch = Number(s.valor) === Number(t.value);
        const pixMatch = bank.pixAddressKey ? (s.chave_pix === bank.pixAddressKey || s.chave_pix.replace(/\D/g, '') === bank.pixAddressKey) : false;
        const cpfMatch = bank.cpfCnpj ? (s.chave_pix.replace(/\D/g, '') === String(bank.cpfCnpj).replace(/\D/g, '')) : false;
        const ownerMatch = bank.ownerName ? (s.ownerName && s.ownerName.trim().toLowerCase() === bank.ownerName.trim().toLowerCase()) : false;
        return s.status === 'pendente' && recent && valueMatch && (pixMatch || cpfMatch || ownerMatch);
      });

      if (!saque) {
        console.warn('[ASASS WEBHOOK] Saque não encontrado mesmo após buscar usuário. transferId:', transferId);
        return res.status(200).json({ success: true, message: 'saque not found (ignored)' });
      }

      // atualizar status, asaasId, bankAccount e failReason
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
