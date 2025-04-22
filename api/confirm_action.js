import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";
import { ActionHistory } from "./User.js";

function reverterIdAction(idAction) {
  return idAction
    .split('')
    .map(c => {
      if (c === 'a') return '0';                // volta o zero original
      return String(Number(c) + 1);             // soma 1 nos dígitos 0–8
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

    // 🔹 Preparar payload para API externa
    const idPedidoOriginal = reverterIdAction(id_action);
    const payload = {
      token: "a03f2bba-55a0-49c5-b4e1-28a6d1ae0876",
      sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
      id_conta: id_tiktok,
      id_pedido: idPedidoOriginal,
      is_tiktok: "1"
    };

    console.log("🛡️ ID recebido (ofuscado):", id_action);
    console.log("🔓 ID revertido (original):", idPedidoOriginal);


    // 🔹 Chamar API externa com timeout de 5s
    let confirmData = {};
    try {
      const confirmResponse = await axios.post(
        "https://api.ganharnoinsta.com/confirm_action.php",
        payload,
        { timeout: 5000 }
      );
      confirmData = confirmResponse.data || {};
      console.log("Resposta da API confirmar ação:", confirmData);
    } catch (err) {
      console.error("Erro ao confirmar ação (externa):", err.response?.data || err.message);
      // Podemos escolher falhar logo aqui ou prosseguir com dados vazios
      return res.status(502).json({ error: "Falha na confirmação externa." });
    }

    // 🔹 Salvar histórico
    const acaoValida = confirmData.status === "success";
    const valorConfirmacao = parseFloat(confirmData.valor || 0);

    const newAction = new ActionHistory({
      token,
      nome_usuario: usuario.nome_usuario,
      tipo_acao: confirmData.tipo_acao || 'Seguir', // exemplo
      quantidade_pontos: parseFloat(confirmData.valor || 0), // ou ajuste conforme lógica do seu sistema
      url_dir: confirmData.url || '', // se vier da API externa
      id_conta: id_tiktok,
      id_pedido: idPedidoOriginal,
      user: usuario._id,
      acao_validada: confirmData.status === 'success',
      valor_confirmacao: parseFloat(confirmData.valor || 0),
      data: new Date()
    });
    
    const saved = await newAction.save();
    usuario.historico_acoes.push(saved._id);
    await usuario.save();

    // 🔹 **Resposta final para o cliente**!
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
    console.error("Erro ao processar requisição:", error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
