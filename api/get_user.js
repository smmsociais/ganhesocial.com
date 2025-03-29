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

    // 🔹 Chamar API bind_tk com o token correto
    const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindTkUrl);
    const bindData = bindResponse.data;

    console.log("Resposta da API bind_tk:", bindData);

    // 🔹 Se o token estiver incorreto, logar erro e retornar resposta clara
    if (bindData.error === "TOKEN_INCORRETO") {
      console.error("Erro: Token incorreto ao acessar bind_tk.");
      return res.status(403).json({ error: "Token incorreto ao acessar API externa." });
    }

    if (bindData.status !== "success" || !bindData.id_conta) {
      console.error("Erro: id_conta não encontrado na resposta de bind_tk.", bindData);
      return res.status(400).json({ error: "id_conta não encontrado na resposta da API." });
    }

    // 🔹 Atualizar banco de dados com id_conta
    const contaIndex = usuario.contas.findIndex(c => c.nomeConta === nome_usuario);
    if (contaIndex !== -1) {
      usuario.contas[contaIndex].id_conta = bindData.id_conta;
      usuario.contas[contaIndex].id_tiktok = bindData.id_tiktok || null;
      usuario.contas[contaIndex].s = bindData.s || null;
      usuario.contas[contaIndex].status = "Vinculada";
    } else {
      usuario.contas.push({
        nomeConta: nome_usuario,
        id_conta: bindData.id_conta,
        id_tiktok: bindData.id_tiktok || null,
        s: bindData.s || null,
        status: "Vinculada",
      });
    }

    await usuario.save();
    return res.status(200).json(bindData);

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
