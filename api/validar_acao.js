import connectDB from "./db.js";
import { User, ActionHistory, VerificacaoGlobal } from "./User.js";
import axios from "axios";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Método não permitido" });
    }

    await connectDB();

    const {
        token,
        id_pedido,
        id_conta,
        url_dir,
        valor_confirmacao,
        quantidade_pontos,
        tipo_acao,
        unique_id,     // ID do perfil que o usuário deve seguir
        user_id_tiktok // ID do usuário autenticado (da conta vinculada)
    } = req.body;

    try {
        const usuario = await User.findOne({ token });
        if (!usuario) {
            return res.status(401).json({ message: "Usuário não autenticado" });
        }

        let nome_usuario = req.body.nome_usuario || null;
        if (!nome_usuario && id_conta) {
            const contaEncontrada = usuario.contas.find(conta => String(conta.id_conta) === String(id_conta));
            if (contaEncontrada) {
                nome_usuario = contaEncontrada.nomeConta;
            }
        }

        if (!nome_usuario) {
            return res.status(400).json({ message: "Nome de usuário não encontrado." });
        }

        if (!usuario.nome_usuario) {
            usuario.nome_usuario = nome_usuario;
        }

        let valorFinal = parseFloat(valor_confirmacao);
        if (valorFinal > 0.004) {
            valorFinal = Math.round((valorFinal - 0.001) * 1000) / 1000;
        }

        let acaoExistente = await ActionHistory.findOne({
            user: usuario._id,
            id_pedido,
            id_conta,
            acao_validada: null
        });

        if (!acaoExistente) {
            return res.status(404).json({ message: "Ação pendente não encontrada para validação." });
        }

        // Verificação de tempo global
        let controleGlobal = await VerificacaoGlobal.findOne({ _id: "verificacao_global" });
        const agora = new Date();

        if (!controleGlobal) {
            controleGlobal = new VerificacaoGlobal({ _id: "verificacao_global", ultimaVerificacao: new Date(0) });
        }

        const diffMin = (agora - new Date(controleGlobal.ultimaVerificacao)) / 60000;

        if (diffMin < 1) {
            // Aguardando liberação da próxima verificação global → Marcar como pendente
            acaoExistente.status = "pendente";
            acaoExistente.valor_confirmacao = valorFinal;
            acaoExistente.quantidade_pontos = quantidade_pontos;
            acaoExistente.tipo = tipo_acao || "Seguir";
            await acaoExistente.save();

            return res.status(200).json({ status: "pendente", message: "A verificação está em intervalo global. A ação será validada em breve." });
        }

        // Atualiza o tempo de verificação global
        controleGlobal.ultimaVerificacao = agora;
        await controleGlobal.save();

        // CHAMADAS À API PARA VERIFICAÇÃO
        const followingResponse = await axios.get(`http://localhost:3000/api/user-following?userId=${user_id_tiktok}`);
        const listaSeguindo = followingResponse.data?.user_following || [];

        const seguiu = listaSeguindo.some(user => user?.unique_id?.toLowerCase() === unique_id.toLowerCase());

        // Atualiza ação e saldo se confirmado
        acaoExistente.acao_validada = seguiu;
        acaoExistente.status = seguiu ? "confirmado" : "rejeitado";
        acaoExistente.valor_confirmacao = valorFinal;
        acaoExistente.quantidade_pontos = quantidade_pontos;
        acaoExistente.tipo = tipo_acao || "Seguir";

        await acaoExistente.save();

        if (seguiu) {
            usuario.saldo += valorFinal;
            await usuario.save();
        }

        return res.status(200).json({
            status: seguiu ? "confirmado" : "rejeitado",
            message: seguiu ? "Ação validada com sucesso!" : "A ação não foi validada. O perfil não foi seguido.",
            acao: acaoExistente
        });

    } catch (erro) {
        console.error("Erro ao validar ação:", erro);
        return res.status(500).json({ message: "Erro interno do servidor" });
    }
}
