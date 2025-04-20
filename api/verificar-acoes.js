import dbConnect from "@/lib/dbConnect";
import { ActionHistory, User } from "@/models/User";
import axios from "axios";
import { z } from "zod";

const ActionSchema = z.object({
  _id: z.any(),
  nome_usuario: z.string().min(3),
  token: z.string().min(10),
  user: z.any(),
  id_pedido: z.string().min(3),
  url_dir: z.string().url(),
  tipo_acao: z.string(),
  quantidade_pontos: z.number(),
  id_conta: z.string().min(3)
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido. Use GET." });
  }

  await dbConnect();
  console.log("🔌 Conexão com o banco de dados estabelecida.");
  console.log("🔎 Buscando ações pendentes...");

  const acoes = await ActionHistory.find({ acao_validada: null });

  console.log(`📦 Encontradas ${acoes.length} ações pendentes.`);
  if (acoes.length === 0) {
    console.log("🚫 Nenhuma ação pendente encontrada.");
    return res.status(200).json({ message: "Nenhuma ação pendente." });
  }

  let processadas = 0;

  for (const acao of acoes) {
    console.log("\n🧪 Validando ação:", acao._id);
    try {
      const validada = ActionSchema.parse(acao.toObject());

      console.log("✅ Ação válida:", {
        nome_usuario: validada.nome_usuario,
        id_pedido: validada.id_pedido,
        id_conta: validada.id_conta
      });

      const confirmResponse = await axios.post("https://api.ganharnoinsta.com/confirm_action.php", {
        token: "afc012ec-a318-433d-b3c0-5bf07cd29430",
        sha1: "e5990261605cd152f26c7919192d4cd6f6e22227",
        id_conta: validada.id_conta,
        id_pedido: validada.id_pedido,
        is_tiktok: "1"
      }, {
        headers: { "Content-Type": "application/json" }
      });

      const resposta = confirmResponse.data;
      console.log("📨 Resposta da API:", resposta);

      if (resposta.status === "success") {
        // Marcar como confirmada
        acao.acao_validada = true;
        acao.valor_confirmacao = resposta.valor;
        await acao.save();

        // Atualiza o saldo do usuário
        await User.findByIdAndUpdate(validada.user, {
          $inc: {
            saldo: resposta.valor,
            "ganhosPorDia.$[filtro].valor": resposta.valor
          }
        }, {
          arrayFilters: [{ "filtro.data": new Date().toISOString().split("T")[0] }]
        });

        console.log("💰 Ação confirmada e saldo atualizado.");
      } else {
        acao.acao_validada = false;
        await acao.save();
        console.warn("⚠️ Ação marcada como inválida:", resposta);
      }

      processadas++;

    } catch (error) {
      console.error("❌ Falha ao processar ação:", error.errors || error.message || error);
      continue;
    }
  }

  console.log(`✅ Processamento concluído. ${processadas} ações processadas.`);
  return res.status(200).json({ status: "ok", processadas });
}
