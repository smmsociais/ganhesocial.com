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
      console.log("Conectando ao banco de dados...");
      await client.connect();
      db = client.db("ganhesocial");
      console.log("Conexão com o banco de dados estabelecida.");
    }

    const colecao = db.collection("acoes");
    const agora = new Date();
    const verificacoes = {};
    console.log("Buscando ações pendentes...");

    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 }).limit(10).toArray();

    console.log(`Encontradas ${acoes.length} ações pendentes.`);
    
    if (acoes.length === 0) {
      console.log("Nenhuma ação pendente encontrada.");
    }

    for (const acao of acoes) {
      const { user_id, perfil_unique_id, _id } = acao;
      console.log(`Processando ação ${_id} para o usuário ${user_id} (perfil: ${perfil_unique_id})`);

      if (verificacoes[user_id] && agora - verificacoes[user_id] < 60000) {
        console.log(`Usuário ${user_id} já foi verificado recentemente. Pulando ação ${_id}.`);
        continue;
      }

      try {
        console.log(`Verificando dados do usuário ${user_id}...`);
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

        console.log(`Respostas recebidas da API para o usuário ${user_id}.`);

        const info = await infoRes.json();
        const following = await followingRes.json();

        console.log(`Dados do usuário ${user_id}:`, info);
        console.log(`Seguindo dados do usuário ${user_id}:`, following);

        const perfis = following?.following || [];
        const seguiu = perfis.some(p => p.unique_id === perfil_unique_id);

        const novo_status = seguiu ? "valida" : "invalida";
        console.log(`Ação ${_id} do usuário ${user_id} ${novo_status}.`);

        await colecao.updateOne(
          { _id: new ObjectId(_id) },
          {
            $set: {
              acao_validada: seguiu, // true ou false
              data_verificacao: new Date()
            }
          }
        );

        console.log(`Ação ${_id} foi atualizada para o status ${novo_status}.`);

        verificacoes[user_id] = agora;
      } catch (e) {
        console.error(`Erro ao verificar ação ${_id} para o usuário ${user_id}:`, e);
      }
    }

    res.status(200).json({ status: "ok", processadas: acoes.length });
    console.log(`Processamento concluído. ${acoes.length} ações processadas.`);
  } catch (err) {
    console.error("Erro geral na execução de verificar-acoes:", err);
    res.status(500).json({ error: "Erro interno" });
  }
}
