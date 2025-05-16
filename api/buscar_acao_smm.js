import connectDB from './db.js';
import { Action } from './Action.js';

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();

        // Busca uma ação disponível do tipo seguidores TikTok
        const acao = await Action.findOne({ status: "disponível", rede: "tiktok", tipo: "seguidores" }).sort({ dataCriacao: 1 });

        if (!acao) {
            return res.json({ status: "NAO_ENCONTRADA" });
        }

        return res.json({
            status: "ENCONTRADA",
            nome_usuario: acao.link.split("@")[1] ?? "",  // extrai o nome de usuário do link
            quantidade_pontos: acao.valor,
            url_dir: acao.link,
            tipo_acao: acao.tipo,
            id_pedido: acao._id.toString()
        });

    } catch (error) {
        console.error("Erro ao buscar ação SMM:", error);
        return res.status(500).json({ error: "Erro interno ao buscar ação SMM" });
    }
};

export default handler;
