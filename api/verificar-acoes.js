import pkg from "mongodb";
const { MongoClient, ObjectId } = pkg;

const MONGODB_URI = process.env.MONGODB_URI;
const API_URL = "https://ganhesocial.com/api";

const client = new MongoClient(MONGODB_URI);
let db = null;

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Método não permitido." });
    }

    console.log("Rota verificar-acoes chamada:", new Date().toISOString());

    if (!db) {
      await client.connect();
      db = client.db("ganhesocial");
    }

    const colecao = db.collection("acoes");
    const agora = new Date();
    const verificacoes = {};

    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 }).limit(10).toArray();

for (const acao of acoes) {
  const { user, nome_usuario, _id } = acao;
  const user_id = user.toString();
  const perfil_unique_id = nome_usuario;

  if (verificacoes[user_id] && agora - verificacoes[user_id] < 60000) continue;

  try {
    const [infoRes, followingRes] = await Promise.all([
      fetch(`${API_URL}/user-info`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id })
      }),
      fetch(`${API_URL}/user-following`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id })
      }),
    ]);

    const info = await infoRes.json();
    const following = await followingRes.json();

    const perfis = following?.following || [];
    const seguiu = perfis.some(p => p.unique_id === perfil_unique_id);

    await colecao.updateOne(
      { _id: new ObjectId(_id) },
      {
        $set: {
          acao_validada: seguiu,
          data_verificacao: new Date()
        }
      }
    );

    verificacoes[user_id] = agora;
  } catch (e) {
    console.error(`Erro ao verificar ação ${_id}:`, e);
  }
}
    res.status(200).json({ status: "ok", processadas: acoes.length });

  } catch (err) {
    console.error("Erro geral:", err);
    res.status(500).json({ error: "Erro interno" });
  }
}
