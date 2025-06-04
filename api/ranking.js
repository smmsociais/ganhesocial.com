import connectDB from './db.js';
import mongoose from 'mongoose';
import { User } from './schema.js'; // Ajuste conforme o seu schema real

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { authorization } = req.headers;
    const token = authorization?.split(" ")[1];

    if (!token || token !== process.env.API_SECRET) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    await connectDB();

    const { user_token } = req.body;

    if (!user_token) {
      return res.status(400).json({ error: "Token do usuário não fornecido" });
    }

    // Busca todos os usuários com saldos relevantes
    const usuarios = await Usuario.find({
      $or: [
        { saldo_disponivel: { $gt: 0 } },
        { saldo_pendente: { $gt: 0 } }
      ]
    });

    const usuarioAtual = await User.findOne({ token: user_token });

    if (!usuarioAtual) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Monta lista de ranking
    const ranking = usuarios.map(user => {
      const total_balance = parseFloat(user.saldo_disponivel || 0) + parseFloat(user.saldo_pendente || 0);
      return {
        username: user.username || "Usuário",
        total_balance,
        is_current_user: user.token === user_token
      };
    });

    // Ordena do maior para o menor saldo
    ranking.sort((a, b) => b.total_balance - a.total_balance);

    return res.status(200).json({ ranking });

  } catch (error) {
    console.error("❌ Erro ao buscar ranking:", {
      message: error.message,
      stack: error.stack,
      detalhes: error
    });
    return res.status(500).json({ error: "Erro interno ao buscar ranking" });
  }
};

export default handler;
