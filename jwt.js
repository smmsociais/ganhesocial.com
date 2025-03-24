const jwt = require("jsonwebtoken");

// Chave secreta
const secret = "supersecreto";

// 1️⃣ Gerar um novo token
const token = jwt.sign({ id: "123456789" }, secret, { expiresIn: "1h" });

console.log("Token JWT gerado:", token);

// 2️⃣ Verificar o token gerado
try {
    const decoded = jwt.verify(token, secret);
    console.log("Token válido! Dados:", decoded);
} catch (error) {
    console.error("Erro ao verificar token:", error.message);
}




