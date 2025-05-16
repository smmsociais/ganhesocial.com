import connectDB from './db.js';
import { Action } from './Action.js';

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const response = await fetch('https://smmsociais.com/api/buscar_acao_disponivel', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer 123456'
            }
        });

        if (!response.ok) {
            return res.status(500).json({ error: "Erro ao buscar dados do SMM" });
        }

        const acao = await response.json();

        if (!acao || !acao.link) {
            return res.json({ status: "NAO_ENCONTRADA" });
        }

        return res.json({
            status: "ENCONTRADA",
            nome_usuario: acao.link.split("@")[1] ?? "",
            quantidade_pontos: acao.valor,
            url_dir: acao.link,
            tipo_acao: acao.tipo,
            id_pedido: acao._id
        });

    } catch (error) {
        console.error("Erro ao buscar ação do smmsociais.com:", error);
        return res.status(500).json({ error: "Erro interno" });
    }
};

export default handler;
