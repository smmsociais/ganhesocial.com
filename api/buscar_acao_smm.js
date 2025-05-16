import connectDB from './db.js';
import { ActionHistory } from './User.js';

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        await connectDB();

        // Busca uma ação pendente, sem necessidade de id_conta
        const acao = await ActionHistory.findOne({ status: "pendente" }).sort({ data_criacao: 1 });

        if (!acao) {
            return res.json({ status: "NAO_ENCONTRADA" });
        }

        return res.json({
            status: "ENCONTRADA",
            nome_usuario: acao.nome_usuario,
            quantidade_pontos: acao.quantidade_pontos,
            url_dir: acao.url_dir,
            tipo_acao: acao.tipo_acao,
            id_pedido: acao.id_pedido
        });

    } catch (error) {
        console.error("Erro ao buscar ação SMM:", error);
        return res.status(500).json({ error: "Erro interno ao buscar ação SMM" });
    }
};

export default handler;
