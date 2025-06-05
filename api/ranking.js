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

    // Aplica a formatação
    const ranking = ganhosPorUsuario.map(item => {
      const valorFormatado = formatarValorRanking(item.total_balance);
      if (!valorFormatado) return null;

      return {
        username: item.username,
        total_balance: valorFormatado,
        is_current_user: item.token === user_token
      };
    }).filter(item => item !== null);

    // Ordena do maior para o menor (reverter ordenação usando o valor numérico real)
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
