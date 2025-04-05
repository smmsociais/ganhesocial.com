import connectDB from "./db.js";
import { ActionHistory, User } from "./User.js";
import axios from "axios";

function extrairUsername(url) {
    const match = url.match(/@([\w\.\-_]+)/);
    return match ? match[1] : null;
}

async function verificarAcaoValidada(nome_usuario, url_dir, req) {
    const perfilAlvo = extrairUsername(url_dir);
    if (!perfilAlvo || !nome_usuario) return false;

    try {
        const baseUrl = req.headers.host.startsWith("localhost")
            ? `http://${req.headers.host}`
            : `https://${req.headers.host}`;

        // 1. Buscar user_id do usuário (quem executou a ação)
        const infoRes = await axios.get(`${baseUrl}/api/user-info?unique_id=${nome_usuario}`);
        const userId = infoRes.data?.user?.id;
        if (!userId) return false;

        // 2. Buscar lista de seguindo
        const followingRes = await axios.get(`${baseUrl}/api/user-following?userId=${userId}`);
        const followingList = followingRes.data?.followings || [];

        // 3. Verificar se o perfil está na lista de seguindo
        return followingList.some(user => user.unique_id === perfilAlvo);
    } catch (err) {
        console.warn("Erro na validação da ação:", err.message);
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token ausente." });

    try {
        console.log("Dados recebidos:", req.body);

        const user = await User.findOne({ token });
        if (!user) {
            return res.status(403).json({ error: "Token inválido." });
        }

        let { id_pedido, id_conta, url_dir, unique_id_verificado, data, quantidade_pontos, tipo_acao } = req.body;

        if (quantidade_pontos === undefined || tipo_acao === undefined) {
            return res.status(400).json({ error: "Os campos quantidade_pontos e tipo_acao são obrigatórios.", recebido: req.body });
        }

        quantidade_pontos = Number(quantidade_pontos);
        if (isNaN(quantidade_pontos)) {
            return res.status(400).json({ error: "O campo quantidade_pontos deve ser um número válido." });
        }

        // Buscar nome de usuário
        let nome_usuario = req.body.nome_usuario || null;
        if (!nome_usuario && id_conta) {
            const contaEncontrada = user.contas.find(conta => conta.id_conta === id_conta);
            if (contaEncontrada) {
                nome_usuario = contaEncontrada.nomeConta;
            }
        }

        // ✅ Validação automática da ação
        let acao_validada = req.body.acao_validada;

if (acao_validada === undefined || acao_validada === null) {
    // Se não foi enviado pelo frontend, faz a verificação automática
    acao_validada = await verificarAcaoValidada(nome_usuario, url_dir, req);
}

        // Calcular valor de confirmação
let valor_confirmacao = quantidade_pontos / 1000;
if (valor_confirmacao > 0.004) {
    valor_confirmacao -= 0.001;
}

        const novaAcao = new ActionHistory({
            user: user._id,
            token: user.token,
            nome_usuario,
            quantidade_pontos,
            tipo_acao,
            valor_confirmacao,
            data: new Date(data || Date.now()),
            acao_validada
        });

        if (id_pedido) novaAcao.id_pedido = id_pedido;
        if (id_conta) novaAcao.id_conta = id_conta;
        if (url_dir) novaAcao.url_dir = url_dir;
        if (unique_id_verificado) novaAcao.unique_id_verificado = unique_id_verificado;

        await novaAcao.save();

        res.status(200).json({ message: "Ação salva com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar ação:", error);
        res.status(500).json({ error: "Erro ao salvar ação." });
    }
}
