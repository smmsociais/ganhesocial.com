import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido." });
  }

  const token = authHeader.replace("Bearer ", "");
  const usuario = await User.findOne({ token });
  if (!usuario) {
    return res.status(401).json({ error: "Token inválido." });
  }

  const { id_acao, acao_validada, valor_confirmacao } = req.body;

  if (typeof id_acao !== "string" || typeof acao_validada !== "boolean") {
    return res.status(400).json({ error: "Parâmetros inválidos." });
  }

  try {
    const acao = await ActionHistory.findOne({
      _id: id_acao,
      user: usuario._id
    });

    if (!acao) {
      return res.status(404).json({ error: "Ação não encontrada." });
    }

    acao.acao_validada = acao_validada;
    acao.data = new Date();

    if (acao_validada && typeof valor_confirmacao === "number") {
      acao.valor_confirmacao = valor_confirmacao;

      // Atualiza saldo do usuário
      usuario.saldo = (usuario.saldo || 0) + valor_confirmacao;
      await usuario.save();
    }

    await acao.save();

    res.status(200).json({
      status: "success",
      message: "Ação atualizada com sucesso."
    });
  } catch (error) {
    console.error("Erro ao atualizar ação:", error);
    res.status(500).json({ error: "Erro ao atualizar ação." });
  }
}
