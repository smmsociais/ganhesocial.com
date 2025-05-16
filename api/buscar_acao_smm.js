import connectDB from './db.js'; // Pode remover se não for usar Mongo aqui
const SMM_API_KEY = process.env.SMM_API_KEY;

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const response = await fetch('https://smmsociais.com/api/buscar_acao_disponivel', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SMM_API_KEY}`
            }
        });

        if (!response.ok) {
            console.error("Erro na resposta do smmsociais.com:", response.statusText);
            return res.status(500).json({ error: "Erro ao buscar dados do SMM" });
        }

        const acao = await response.json();

        if (!acao || acao.status !== "ENCONTRADA" || !acao.link) {
            return res.json({ status: "NAO_ENCONTRADA" });
        }

        const nomeUsuario = acao.link.includes("@")
            ? acao.link.split("@")[1].split(/[/?#]/)[0] // extrai apenas o username puro
            : "";

        return res.json({
            status: "ENCONTRADA",
            nome_usuario: nomeUsuario,
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
