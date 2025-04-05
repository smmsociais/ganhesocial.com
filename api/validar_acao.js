import connectDB from "./db.js";
import { User } from "./User.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { token, valorGanho = 0.05 } = req.body; // Valor padrão de R$0,05 por ação

    if (!token) {
        return res.status(400).json({ error: "Token obrigatório." });
    }

    try {
        const usuario = await User.findOne({ token });

        if (!usuario) {
            return res.status(403).json({ error: "Usuário não encontrado." });
        }

        // Atualiza o saldo
        usuario.saldo = (usuario.saldo || 0) + parseFloat(valorGanho);

        // Atualiza ou adiciona o histórico do dia
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        if (!usuario.historicoGanhos) {
            usuario.historicoGanhos = [];
        }

        const registroHoje = usuario.historicoGanhos.find(item => {
            const dataItem = new Date(item.data);
            dataItem.setHours(0, 0, 0, 0);
            return dataItem.getTime() === hoje.getTime();
        });

        if (registroHoje) {
            registroHoje.valor += parseFloat(valorGanho);
        } else {
            usuario.historicoGanhos.push({
                data: hoje.toISOString(),
                valor: parseFloat(valorGanho),
            });
        }

        await usuario.save();

        res.status(200).json({
            mensagem: "Ação validada com sucesso!",
            novoSaldo: usuario.saldo.toFixed(2)
        });
    } catch (error) {
        console.error("Erro ao validar ação:", error);
        res.status(500).json({ error: "Erro ao validar ação." });
    }
}
