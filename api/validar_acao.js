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

        // 📌 Obter nome_usuario com fallback via id_conta
let nome_usuario = req.body.nome_usuario || null;

if (!nome_usuario && id_conta) {
    const contaEncontrada = usuario.contas.find(conta => conta.id_conta === id_conta);

    if (contaEncontrada) {
        console.log("Conta encontrada:", contaEncontrada);
        nome_usuario = contaEncontrada.nomeConta;
    } else {
        console.warn(`Nenhuma conta encontrada com id_conta = ${id_conta}`);
    }
}

if (!nome_usuario) {
    console.error("Falha ao obter nome_usuario. Dados recebidos:", {
        nome_usuario: req.body.nome_usuario,
        id_conta,
        contas_usuario: usuario.contas
    });
    return res.status(400).json({ message: "Nome de usuário não encontrado." });
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
            valor_confirmacao,
            quantidade_pontos,
            tipo_acao
        });

        await novaAcao.save();

        // Adiciona no histórico do usuário (referência)
        usuario.historico_acoes.push(novaAcao._id);

        // Se a ação foi validada, atualiza o saldo
        if (acao_validada) {
            usuario.saldo += valor_confirmacao;
        }

        await usuario.save();

        res.status(200).json({ message: "Ação registrada com sucesso", acao: novaAcao });

    } catch (erro) {
        console.error("Erro ao registrar ação:", erro);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
}
