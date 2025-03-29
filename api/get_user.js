import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

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

    // 🔹 Chamar API bind_tk
    const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=${token}&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindTkUrl);
    const bindData = bindResponse.data;

    console.log("Resposta da API bind_tk:", bindData);

    if (bindData.status === "success" && bindData.id_conta) {
      // 🔹 Atualiza ou adiciona a conta no banco de dados
      const contaIndex = usuario.contas.findIndex(c => c.nomeConta === nome_usuario);

      if (contaIndex !== -1) {
        // Atualiza conta existente
        usuario.contas[contaIndex].id_conta = bindData.id_conta;
        usuario.contas[contaIndex].id_tiktok = bindData.id_tiktok || null;
        usuario.contas[contaIndex].s = bindData.s || null;
        usuario.contas[contaIndex].status = "Vinculada";
      } else {
        // Adiciona nova conta
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
    }

    if (bindData.status === "fail" && bindData.message === "WRONG_USER") {
      console.log(`Erro ao vincular conta: ${bindData.message}`);

      const contaExistente = usuario.contas.find(c => c.nomeConta === nome_usuario);
      if (!contaExistente) {
        usuario.contas.push({
          nomeConta: nome_usuario,
          id_conta: null,
          id_tiktok: null,
          s: null,
          status: "Pendente",
        });

        await usuario.save();
        return res.status(200).json({
          message: "Conta adicionada como 'Pendente'.",
          detalhes: { nomeConta: nome_usuario, status: "Pendente" },
        });
      } else {
        return res.status(400).json({ error: "Conta já existente no banco de dados." });
      }
    }

    return res.status(400).json({ error: bindData.message || "Erro ao vincular conta." });

  } catch (error) {
    console.error("Erro ao processar requisição:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
