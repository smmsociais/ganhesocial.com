const mongoose = require("mongoose");

let isConnected = false; // Evita múltiplas conexões

async function connectDB() {
  if (isConnected) return;
  
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    isConnected = true;
    console.log("🔥 Conectado ao MongoDB!");
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error);
    throw new Error("Erro ao conectar ao MongoDB");
  }
}

module.exports = connectDB;
