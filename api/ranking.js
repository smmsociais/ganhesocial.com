import connectDB from './db.js';
import { User, DailyEarning } from './schema.js';

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

    // Agregação: somar ganhos de hoje (registros existentes são do dia atual por TTL)
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
          as: ""
        }
      },
      { $unwind: "$usuario" },
      {
        $project: {
          _id: 0,
          username: { $ifNull: ["$usuario.nome", "Usuário"] },
          total_balance: "$totalGanhos",
          token: "$usuario.token"
        }
      }
    ]);

    // Marca o usuário atual
    const ranking = ganhosPorUsuario.map(item => ({
      username: item.username,
      total_balance: item.total_balance,
      is_current_user: item.token === user_token
    }));

    // Ordena do maior para o menor
    ranking.sort((a, b) => b.total_balance - a.total_balance);

    return res.status(200).json({ ranking });

  } catch (error) {
    console.error("❌ Erro ao buscar ranking:", error);
    return res.status(500).json({ error: "Erro interno ao buscar ranking" });
  }
};

export default handler;
