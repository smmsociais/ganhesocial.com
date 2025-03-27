import connectDB from "./db.js";
import User from "./User.js";

const handler = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token de autenticação ausente ou inválido" });
    }

    const token = authorization.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verifica o token JWT
        const userId = decoded.id;

        // Conectando ao banco de dados MongoDB
        await connectDB();

        // Buscando o usuário no banco de dados
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        // Enviar os dados do usuário (excluindo a senha)
        return res.status(200).json({
            nome_usuario: user.nome_usuario,
            email: user.email,
            token: user.token, // Enviando o token único
        });
    } catch (error) {
        console.error("Erro ao buscar dados do usuário:", error);
        return res.status(500).json({ error: "Erro interno ao recuperar dados do usuário" });
    }
};

export default handler;
