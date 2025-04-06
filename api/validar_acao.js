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
        usuario.historico_acoes.push(novaAcao._id);

        if (acao_validada) {
            usuario.saldo += valorFinal;
        }

        // Converter a data atual para o formato ISO com fuso horário de Brasília
        // Usamos "en-CA" para garantir o formato "YYYY-MM-DD"
        const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const hoje = new Date(hojeStr + "T00:00:00"); // Cria um objeto Date com a data correta

        // Procura uma entrada para hoje no array ganhosPorDia
        let entradaHoje = usuario.ganhosPorDia.find(entry => {
            // Converte cada data para o mesmo formato ISO
            const dataEntryStr = new Date(entry.data).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
            return dataEntryStr === hojeStr;
        });

        if (entradaHoje) {
            entradaHoje.valor += valorFinal;
        } else {
            usuario.ganhosPorDia.push({ data: hoje, valor: valorFinal });
        }

        await usuario.save();

        res.status(200).json({ message: "Ação registrada com sucesso", acao: novaAcao });
    } catch (erro) {
        console.error("Erro ao registrar ação:", erro);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
}
