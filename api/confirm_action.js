import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";
import { ActionHistory } from "./User.js";

function reverterIdAction(idAction) {
  return idAction
    .split('')
    .map(char => {
      if (char === '0') return '0';
      return String(parseInt(char) + 1);
    })
    .join('');
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const { token, id_action, id_tiktok } = req.body;

  if (!token|| !id_action || !id_tiktok) {
    return res.status(400).json({ error: "Parâmetros obrigatórios ausentes." });
  }

  try {
    // 🔹 Buscar usuário pelo token no MongoDB
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // 🔹 Confirmar ação na API externa
    const confirmUrl = "https://api.ganharnoinsta.com/confirm_action.php";
    const idPedidoOriginal = reverterIdAction(id_action);

    const payload = {
      token: "a03f2bba-55a0-49c5-b4e1-28a6d1ae0876",
      sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
      id_conta: id_tiktok,
      id_pedido: idPedidoOriginal,
      is_tiktok: "1"
    };    

    let confirmData = { valor: "0.000" }; // 🔹 Definir um valor padrão
    let valorConfirmacao = 0;

    try {
      const confirmResponse = await axios.post(confirmUrl, payload);
      confirmData = confirmResponse.data || {};
      console.log("Resposta da API confirmar ação:", confirmData);
    } catch (error) {
      console.error("Erro ao confirmar ação:", error.response?.data || error.message);
    }

    // 🔹 Salvar ação no MongoDB
    try {
      const newAction = new ActionHistory({
        token,
        id_action: String(idPedidoOriginal), // salva o original
        valor_confirmacao: valorConfirmacao,
      });      

      const savedAction = await newAction.save();
      usuario.historico_acoes.push(savedAction._id);
      await usuario.save();

      console.log("Histórico de ação salvo no MongoDB!");
    } catch (error) {
      console.error("Erro ao salvar no MongoDB:", error.message);
    }

  } catch (error) {
    console.error("Erro ao processar requisição:", error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
