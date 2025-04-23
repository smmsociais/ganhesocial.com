import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";
import { ActionHistory } from "./User.js";
import redis from "./redis.js";

function reverterIdAction(idAction) {
  return idAction
    .split('')
    .map(c => {
      if (c === 'a') return '0';
      return String(Number(c) + 1);
    })
    .join('');
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const { token, id_action, id_tiktok } = req.body;
  if (!token || !id_action || !id_tiktok) {
    return res.status(400).json({ error: "Parâmetros obrigatórios ausentes." });
  }

  try {
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    const idPedidoOriginal = reverterIdAction(id_action);

    let redisData = null;
    try {
      const cache = await redis.get(`action:${id_tiktok}`);
      console.log("📦 Conteúdo bruto do Redis:", cache);
      redisData = typeof cache === "object" ? cache : JSON.parse(cache);
    } catch (redisErr) {
      console.warn("⚠️ Não foi possível recuperar dados do Redis:", redisErr);
    }

    const payload = {
      token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
      sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
      id_conta: id_tiktok,
      id_pedido: idPedidoOriginal,
      is_tiktok: "1"
    };

    console.log("🛡️ ID recebido (ofuscado):", id_action);
    console.log("🔓 ID revertido (original):", idPedidoOriginal);

    let confirmData = {};
    try {
      const confirmResponse = await axios.post(
        "https://api.ganharnoinsta.com/confirm_action.php",
        payload,
        { timeout: 5000 }
      );
      confirmData = confirmResponse.data || {};
      console.log("📬 Resposta da API confirmar ação:", confirmData);
    } catch (err) {
      console.error("❌ Erro ao confirmar ação (externa):", err.response?.data || err.message);
      return res.status(502).json({ error: "Falha na confirmação externa." });
    }

    const acaoValida = confirmData.status === "success";

    // 🔢 Calcular valor final com base na lógica de desconto
    const valorOriginal = parseFloat(confirmData.valor || redisData?.valor || 0);
    const valorDescontado = valorOriginal > 0.004 ? valorOriginal - 0.001 : valorOriginal;
    const valorFinal = parseFloat(Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3));
    const valorConfirmacao = valorFinal;

    const newAction = new ActionHistory({
      token,
      nome_usuario: usuario.contas.find(c => c.id_tiktok === id_tiktok)?.nomeConta || "desconhecido",
      tipo_acao: confirmData.tipo_acao || redisData?.tipo_acao || 'Seguir',
      quantidade_pontos: valorConfirmacao,
      url_dir: redisData?.url_dir || '',
      id_conta: id_tiktok,
      id_pedido: idPedidoOriginal,
      user: usuario._id,
      acao_validada: null,
      valor_confirmacao: valorConfirmacao,
      data: new Date()
    });

    const saved = await newAction.save();
    usuario.historico_acoes.push(saved._id);
    await usuario.save();

    return res.status(200).json({
      status: "sucesso",
      message: acaoValida
        ? "Ação confirmada e validada!"
        : "Ação confirmada, mas não validada.",
      acaoValida,
      valorConfirmacao,
      dadosExternos: confirmData
    });

  } catch (error) {
    console.error("💥 Erro ao processar requisição:", error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
