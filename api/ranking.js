import connectDB from './db.js';
import { User, DailyEarning } from './schema.js';

const formatarValorRanking = (valor) => {
  if (valor < 10) return null;
  if (valor < 50) return "10+";
  if (valor < 100) return "50+";
  if (valor < 500) return "100+";
  if (valor < 1000) return "500+";
  const base = Math.floor(valor / 1000) * 1000;
  return `${base}+`;
};

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

    const ganhosPorUsuario = await DailyEarning.aggregate([
      {
        $group: {
          _id: "$userId",
          totalGanhos: { $sum: "$valor" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "usuario"
        }
      },
      { $unwind: "$usuario" },
      {
        $project: {
          _id: 0,
          username: { $ifNull: ["$usuario.nome", ""] },
          total_balance: "$totalGanhos",
          token: "$usuario.token"
        }
      }
    ]);

    // Cria o ranking formatado
    let ranking = ganhosPorUsuario.map(item => {
      const valorFormatado = formatarValorRanking(item.total_balance);
      if (!valorFormatado && item.token !== user_token) return null;

      return {
        username: item.username,
        total_balance: valorFormatado || "0",
        is_current_user: item.token === user_token
      };
    }).filter(item => item !== null);

    // Garante que o usuário atual está presente mesmo que não esteja no resultado da agregação
    const jaNoRanking = ranking.some(u => u.is_current_user);
    if (!jaNoRanking) {
      // Busca saldo 0 para exibir como "0"
      ranking.push({
        username: usuarioAtual.nome || "",
        total_balance: "0",
        is_current_user: true
      });
    }

    // Ordena com base no número representado (ignora o "+")
    ranking.sort((a, b) => {
      const numA = parseInt(a.total_balance);
      const numB = parseInt(b.total_balance);
      return numB - numA;
    });

    return res.status(200).json({ ranking });

  } catch (error) {
    console.error("❌ Erro ao buscar ranking:", error);
    return res.status(500).json({ error: "Erro interno ao buscar ranking" });
  }
};

export default handler;
