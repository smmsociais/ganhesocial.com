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
    console.log("▶ verificar-acoes chamado em", new Date().toISOString());

    if (!db) {
      await client.connect();
      db = client.db("ganhesocial");
      console.log("✔ Conectado ao MongoDB (ganhesocial)");
    }

    const colecao = db.collection("actionhistories");
    console.log("Buscando ações pendentes em 'actionhistories'...");
    const acoes = await colecao.find({ acao_validada: null })
      .sort({ data: 1 })
      .limit(10)
      .toArray();
    console.log(`✅ Encontradas ${acoes.length} ações pendentes.`);

    for (const acao of acoes) {
      const { _id, nome_usuario } = acao;
      console.log(`— Processando _id=${_id}, nome_usuario='${nome_usuario}'`);

      try {
        // 1) Busca info do usuário no TikTok
        const infoRes = await fetch(
          `${API_URL}/user-info?unique_id=${encodeURIComponent(nome_usuario)}`
        );
        if (!infoRes.ok) throw new Error(`user-info retornou ${infoRes.status}`);
        const infoJson = await infoRes.json();
        const tiktokUserId = infoJson.data.user.id;
        console.log(`   • TikTok user ID: ${tiktokUserId}`);

        // 2) Busca lista de quem segue
        const followRes = await fetch(
          `${API_URL}/user-following?userId=${tiktokUserId}`
        );
        if (!followRes.ok) throw new Error(`user-following retornou ${followRes.status}`);
        const followJson = await followRes.json();
        console.log(`   • Recebeu ${followJson.data.followings.length} itens de seguindo`);

        // 3) Verifica se seguiu
        const seguiu = followJson.data.followings.some(f =>
          f.unique_id.replace(/^@/, "").toLowerCase() === nome_usuario.toLowerCase()
        );
        console.log(`   • Resultado: ${seguiu ? "VALIDA" : "INVALIDA"}`);

        // 4) Atualiza documento
        await colecao.updateOne(
          { _id: new ObjectId(_id) },
          {
            $set: {
              acao_validada: seguiu,
              data_verificacao: new Date()
            }
          }
        );
        console.log(`   ✓ Ação ${_id} atualizada para acao_validada=${seguiu}`);
      } catch (innerErr) {
        console.error(`   ✗ Erro ao processar ação ${_id}:`, innerErr.message);
      }
    }

    console.log(`✔ Fim do processamento: ${acoes.length} ações processadas.`);
    return res.status(200).json({ status: "ok", processadas: acoes.length });
  } catch (err) {
    console.error("✗ Erro geral em verificar-acoes:", err);
    return res.status(500).json({ error: "Erro interno", details: err.message });
  }
}
