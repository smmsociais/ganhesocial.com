import axios from "axios";
import connectDB from "./db.js";
import { User } from "./User.js";
import redis from "./redis.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

 
    
    const { token, id_tiktok } = req.query;

    if (!token || !id_tiktok) {
        console.warn("❌ Parâmetros ausentes:", { token, id_tiktok });
        return res.status(400).json({ error: "Os parâmetros 'token' e 'id_tiktok' são obrigatórios." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            console.warn("❌ Token inválido:", token);
            return res.status(403).json({ error: "Acesso negado. Token inválido." });
        }

        const getActionUrl = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_tiktok}&is_tiktok=1&tipo=1`;
        const actionResponse = await axios.get(getActionUrl);
        const data = actionResponse.data;

        console.log("📦 Resposta da API externa get_action:", data);

        if (data.status === "CONTA_INEXISTENTE") {
            return res.status(200).json({
                status: "fail",
                id_tiktok,
                message: "conta_inexistente"
            });
        }

        if (data.status === "ENCONTRADA") {
            const pontos = parseFloat(data.quantidade_pontos);
            const valorBruto = pontos / 1000;
            const valorDescontado = (valorBruto > 0.004)
                ? valorBruto - 0.001
                : valorBruto;
            const valorFinal = Math.min(Math.max(valorDescontado, 0.004), 0.006).toFixed(3);

            const idPedidoOriginal = String(data.id_pedido).padStart(9, '0');
            const idPedidoModificado = idPedidoOriginal
                .split('')
                .map(d => d === '0' ? 'a' : String(Number(d) - 1))
                .join('');

            try {
                // 🔐 Guardar no Redis por 5 minutos (TTL = 300s)
// em vez de redis.setex(...)
await redis.set(
  `action:${id_tiktok}`,
  JSON.stringify({
    url: data.url_dir,
    nome_usuario: data.nome_usuario,
    tipo_acao: data.tipo_acao,
    valor: valorFinal,
    id_perfil: data.id_alvo,
    id_pedido: data.id_pedido
  }),
  { ex: 300 } // expira em 300 segundos
);


                console.log("📥 Ação salva no Redis com chave:", `action:${id_tiktok}`);

            } catch (error) {
                console.error("💥 Erro ao salvar no Redis:", error);
                return res.status(500).json({ error: "Erro ao salvar dados no Redis." });
            }

            return res.status(200).json({
                status: "sucess",
                id_tiktok,
                id_action: idPedidoModificado,
                url: data.url_dir,
                id_perfil: data.id_alvo,
                nome_usuario: data.nome_usuario,
                tipo_acao: data.tipo_acao,
                valor: valorFinal
            });
        }

console.log("🔑 Redis URL:", process.env.UPSTASH_REDIS_REST_URL);
console.log("🔑 Redis TOKEN:", process.env.UPSTASH_REDIS_REST_TOKEN?.slice(0, 8) + "...");


        console.log("⚠️ Nenhuma ação disponível no momento.");
        return res.status(204).json({ message: "Nenhuma ação disponível no momento." });

    } catch (error) {
        console.error("💥 Erro ao processar requisição:", error);
        return res.status(500).json({ error: "Erro interno ao processar requisição." });
    }
}
