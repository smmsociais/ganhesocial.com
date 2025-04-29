// api/db.js (só conexão)
import mongoose from "mongoose";
const URI = process.env.MONGODB_URI;
if (!URI) throw new Error("MONGODB_URI não definida!");

let isConnected = false;
export default async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  isConnected = true;
  console.log("🟢 Conectado ao MongoDB via Mongoose");
}
