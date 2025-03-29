import connectDB from "./db.js";
import { User } from "./User.js";

const handler = async (req, res) => {
    await connectDB();

    if (req.method === "GET") {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Não autorizado" });
        }

        const token = authHeader.split(" ")[1].trim();
        console.log("Token recebido:", token); // Debug

        try {
            // Busca o usuário no banco com base no token armazenado
            const usuario = await User.findOne({ token });

            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado" });
            }

            res.json({
                nome_usuario: usuario.nome_usuario || usuario.nome,
                email: usuario.email,
                token: usuario.token, // Retornando o token salvo no banco
            });
        } catch (error) {
            console.error("Erro ao carregar perfil:", error);
            res.status(500).json({ error: "Erro ao carregar perfil" });
        }
    } 
    else if (req.method === "PUT") {
        const { nome_usuario, email } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Não autorizado" });
        }

        const token = authHeader.split(" ")[1].trim();
        console.log("Token recebido para atualização:", token); // Debug

        try {
            const usuario = await User.findOneAndUpdate(
                { token },
                { nome_usuario, email },
                { new: true }
            );

            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado" });
            }

            res.json({
                message: "Perfil atualizado com sucesso!",
                nome_usuario: usuario.nome_usuario,
                email: usuario.email,
            });
        } catch (error) {
            console.error("Erro ao salvar perfil:", error);
            res.status(500).json({ error: "Erro ao salvar perfil" });
        }
    } 
    else {
        res.status(405).json({ error: "Método não permitido" });
    }
};

export default handler;
