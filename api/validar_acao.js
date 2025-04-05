import connectDB from "./db.js";
import { User, ActionHistory } from "./User.js";

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
        unique_id_verificado,
        acao_validada,
        valor_confirmacao,
        quantidade_pontos,
        tipo_acao
    } = req.body;

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(401).json({ message: "Usuário não autenticado" });
        }

        // Obter nome_usuario com fallback via id_conta
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

        // ➕ Aplica taxa de 0.001 se necessário
        let valorFinal = parseFloat(valor_confirmacao);
        if (valorFinal > 0.004) {
            valorFinal = Math.round((valorFinal - 0.001) * 1000) / 1000;
        }

        // Cria o registro no histórico
        const novaAcao = new ActionHistory({
            user: usuario._id,
            token,
            nome_usuario,
            id_pedido,
            id_conta,
            url_dir,
            unique_id_verificado,
            acao_validada,
            valor_confirmacao: valorFinal,
            quantidade_pontos,
            tipo_acao
        });

        await novaAcao.save();

        // Adiciona no histórico do usuário
        usuario.historico_acoes.push(novaAcao._id);

        // Atualiza saldo se ação foi validada
        if (acao_validada) {
            usuario.saldo += valorFinal;
        }

        await usuario.save();

        res.status(200).json({ message: "Ação registrada com sucesso", acao: novaAcao });

    } catch (erro) {
        console.error("Erro ao registrar ação:", erro);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
}
