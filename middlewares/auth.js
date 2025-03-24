import { jwtVerify } from "jose";
import dotenv from "dotenv";

// Carregar variáveis do .env
dotenv.config();

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET);

export default async (req, res, next) => {
    const token = req.headers.authorization;
    console.log("Token recebido:", token);

    if (!token) {
        return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    try {
        const tokenSemBearer = token.split(" ")[1];
        console.log("Token processado:", tokenSemBearer);

        const { payload } = await jwtVerify(tokenSemBearer, secretKey);
        console.log("Token decodificado:", payload);

        req.user = payload;
        next();
    } catch (error) {
        console.error("Erro ao verificar token:", error);
        return res.status(400).json({ error: "Token inválido." });
    }
};
