const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

// Carregar variáveis do .env
dotenv.config();

module.exports = (req, res, next) => {
    const token = req.headers.authorization;
    console.log("Token recebido:", token); // <-- Adicione esta linha

    if (!token) {
        return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    try {
        const tokenSemBearer = token.split(" ")[1]; // Remover "Bearer "
        console.log("Token processado:", tokenSemBearer); // <-- Adicione esta linha

        const decoded = jwt.verify(tokenSemBearer, process.env.JWT_SECRET);
        console.log("Token decodificado:", decoded); // <-- Adicione esta linha

        req.user = decoded;
        next();
    } catch (error) {
        console.error("Erro ao verificar token:", error); // <-- Adicione esta linha
        return res.status(400).json({ error: "Token inválido." });
    }
};
