import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const { token, nome_usuario } = req.query;
  if (!token || !nome_usuario) {
    return res.status(400).json({ error: "Os parâmetros 'token' e 'nome_usuario' são obrigatórios." });
  }

  try {
    const usuario = await User.findOne({ token });

    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=a03f2bba-55a0-49c5-b4e1-28a6d1ae0876&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindTkUrl);
    const bindData = bindResponse.data;

    console.log("Resposta da API bind_tk:", bindData);

    if (bindData.error === "TOKEN_INCORRETO") {
      console.error("Erro: Token incorreto ao acessar bind_tk.");
      return res.status(403).json({ error: "Token incorreto ao acessar API externa." });
    }

    // 🔹 Se id_conta estiver ausente, vincular mesmo assim com status "Pendente"
    const contaIndex = usuario.contas.findIndex(c => c.nomeConta === nome_usuario);
    const novaConta = {
      nomeConta: nome_usuario,
      id_conta: bindData.id_conta || null,
      id_tiktok: bindData.id_tiktok || null,
      s: bindData.s || null,
      status: bindData.id_conta ? "Vinculada" : "Pendente",
    };

    if (contaIndex !== -1) {
      // Atualiza a conta existente
      usuario.contas[contaIndex] = { ...usuario.contas[contaIndex], ...novaConta };
    } else {
      // Adiciona nova conta
      usuario.contas.push(novaConta);
    }

    await usuario.save();

    // 🔹 Sempre retorna o bindData completo
    return res.status(200).json(bindData);

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
