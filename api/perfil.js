import connectDB from "./db.js";
import { User } from "./User.js";
import jwt from "jsonwebtoken";

const handler = async (req, res) => {
    if (req.method === "GET") {
        await connectDB();

        // Captura o token do cabeçalho da requisição
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Não autorizado" });
        }

        const token = authHeader.split(" ")[1];

        try {
            // Procura o usuário no banco usando o token fixo
            const usuario = await User.findOne({ token });

            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado" });
            }

res.json({
    nome_usuario: usuario.nome_usuario,
    email: usuario.email,
    token: usuario.token,
});
        } catch (error) {
            console.error("Erro ao carregar perfil:", error);
            res.status(500).json({ error: "Erro ao carregar perfil" });
        }
    } else if (req.method === "PUT") {
        await connectDB();

        const { nome_usuario, email } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Não autorizado" });
        }

        const token = authHeader.split(" ")[1];

        try {
            // Atualiza os dados do usuário com base no token fixo
const usuario = await User.findOneAndUpdate(
    { token },
    { nome_usuario, email },
    { new: true }
);

            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado" });
            }

            res.json({ message: "Perfil atualizado com sucesso!" });
        } catch (error) {
            console.error("Erro ao salvar perfil:", error);
            res.status(500).json({ error: "Erro ao salvar perfil" });
        }
    } else {
        res.status(405).json({ error: "Método não permitido" });
    }
};

export default handler;
