import pkg from "mongodb";
import { z } from "zod";

const { MongoClient, ObjectId } = pkg;
const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido' });
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  try {
    const acoesPendentes = await db.collection('acoes_realizadas').find({
      user_id: userId,
      status: 'pendente'
    }).toArray();

    const resultados = [];

    for (const acao of acoesPendentes) {
      const { nome_usuario, url_dir, id_pedido, id_conta, quantidade_pontos, valor_confirmacao, tipo_acao } = acao;

      // 1. Obtemos o ID do usuário no TikTok
      let tiktokUserId;
      try {
        const userInfoRes = await axios.get(`${process.env.BASE_URL}/api/user-info?unique_id=${nome_usuario.replace(/^@/, '')}`);
        const userInfo = userInfoRes.data;

        if (!userInfo || userInfo.code !== 0 || !userInfo.data?.user?.id) {
          throw new Error('TikTok user info inválido');
        }

        tiktokUserId = userInfo.data.user.id;
      } catch (e) {
        resultados.push({ id_pedido, status: 'erro_user_info' });
        continue;
      }

      // 2. Buscamos os usuários que ele está seguindo
      let accountFound = false;
      try {
        const followingRes = await axios.get(`${process.env.BASE_URL}/api/user-following?userId=${tiktokUserId}`);
        const followingData = followingRes.data;

        if (followingData.code === 0 && followingData.data?.followings?.length > 0) {
          const followings = followingData.data.followings;
          const targetUsername = url_dir.replace(/^@/, '').toLowerCase();

          accountFound = followings.some(f => {
            const followingUsername = f.unique_id?.replace(/^@/, '').toLowerCase();
            return followingUsername === targetUsername;
          });
        }
      } catch (e) {
        resultados.push({ id_pedido, status: 'erro_following' });
        continue;
      }

      const statusAcao = accountFound ? 'confirmada' : 'falhou';

      await db.collection('acoes_realizadas').updateOne(
        { _id: acao._id },
        { $set: { status: statusAcao, verificada_em: new Date() } }
      );

      // Se confirmada, atualiza saldo do usuário
      if (accountFound) {
        const valor = parseFloat(valor_confirmacao);
        await db.collection('usuarios').updateOne(
          { _id: new ObjectId(userId) },
          { $inc: { saldo: valor } }
        );
      }

      resultados.push({ id_pedido, status: statusAcao });
    }

    res.status(200).json({ status: 'ok', resultados });

  } catch (err) {
    console.error("Erro ao verificar ações pendentes:", err);
    res.status(500).json({ status: 'erro', message: 'Erro ao verificar ações pendentes' });
  } finally {
    await client.close();
  }
}
