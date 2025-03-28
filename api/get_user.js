import axios from "axios";
import connectDB from "./db.js";
import User from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  // Conectar ao banco de dados
  await connectDB();

  // Obter o token e nome_usuario da query string
  const { token, nome_usuario } = req.query;
  if (!token) {
    return res.status(400).json({ error: "O parâmetro 'token' é obrigatório." });
  }
  if (!nome_usuario) {
    return res.status(400).json({ error: "O parâmetro 'nome_usuario' é obrigatório." });
  }

  try {
    // Buscar usuário pelo token fixo salvo no MongoDB
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(403).json({ error: "Acesso negado. Token inválido." });
    }

    // Chamar a API bind_tk para obter os dados da conta
    const bindTkUrl = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nome_usuario}`;
    const bindResponse = await axios.get(bindTkUrl);
    const bindData = bindResponse.data;

    // Exibe a resposta da API bind_tk para depuração
    console.log("Resposta da API bind_tk:", bindData);

    // Se a resposta for "success", retorna ela para o cliente
    if (
      bindData.status === "success" &&
      bindData.id_conta &&
      bindData.id_tiktok &&
      bindData.s
    ) {
      return res.status(200).json(bindData);
    }

// Se a resposta for "fail" e a mensagem for "WRONG_USER", adiciona a conta no banco
if (bindData.status === "fail" && bindData.message === "WRONG_USER") {
  // Verifica se a conta já existe no banco de dados do usuário
  const contaExistente = usuario.contas.find(
    (conta) => conta.nomeConta === nome_usuario
  );

  // Se não existir, adiciona a nova conta ao banco
  if (!contaExistente) {
    // Certifica-se de que os valores obrigatórios (como id_conta) estão sendo atribuídos
    const novaConta = {
      nomeConta: nome_usuario,
      id_conta: bindData.id_conta,  // Verifica se bindData.id_conta existe e é válido
      id_tiktok: bindData.id_tiktok,
      s: bindData.s,
      status: "Pendente",  // Status padrão como "Pendente"
    };

    // Verifica se todos os campos necessários estão presentes
    if (!novaConta.id_conta || !novaConta.id_tiktok || !novaConta.s) {
      return res.status(400).json({ error: "Campos obrigatórios estão faltando." });
    }

    // Adiciona a conta ao banco de dados
    usuario.contas.push(novaConta);
    await usuario.save();

    return res.status(200).json({
      message: "Conta adicionada com sucesso!",
      id_conta: novaConta.id_conta,
      detalhes: novaConta,
    });
  } else {
    return res.status(400).json({ error: "Conta já existe no banco de dados." });
  }
}
    // Caso contrário, retorna erro
    return res.status(400).json({ error: bindData.message || "Erro ao vincular conta." });
  } catch (error) {
    console.error("Erro ao processar requisição:", error);
    return res.status(500).json({ error: "Erro interno ao processar requisição." });
  }
}
