const mongoose = require("mongoose");

let isConnected = false; // Evita múltiplas conexões

async function connectDB() {
  if (isConnected) return;
  
  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // Aumenta tempo limite para evitar falhas
      bufferCommands: false, // Evita enfileirar consultas antes da conexão
    });

    isConnected = db.connections[0].readyState === 1; // Verifica se está conectado
    console.log("🔥 Conectado ao MongoDB!");
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error);
    throw new Error("Erro ao conectar ao MongoDB");
  }
}

module.exports = connectDB;
