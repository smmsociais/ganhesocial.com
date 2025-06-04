import connectDB from './db.js';
import mongoose from 'mongoose';
import { User } from './schema.js';

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

    const usuarioAtual = await User.findOne({ token: user_token });
    if (!usuarioAtual) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const usuarios = await User.find({ saldo: { $gt: 0 } });

    const ranking = usuarios.map(user => {
      return {
        username: user.nome || "Usuário",
        total_balance: user.saldo,
        is_current_user: user.token === user_token
      };
    });

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
