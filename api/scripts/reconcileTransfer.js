// scripts/reconcileTransfer.js
// usage: node reconcileTransfer.js <transferId> <MONGO_URI> <ASAAS_API_KEY>
import fetch from "node-fetch";
import mongoose from "mongoose";
import { User } from "../api/schema.js"; // ajuste o caminho se necessário

const [,, transferId, MONGO_URI, ASAAS_API_KEY] = process.argv;
if (!transferId || !MONGO_URI || !ASAAS_API_KEY) {
  console.error("Usage: node reconcileTransfer.js <transferId> <MONGO_URI> <ASAAS_API_KEY>");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const res = await fetch(`https://www.asaas.com/api/v3/transfers/${transferId}`, {
    headers: { "access_token": ASAAS_API_KEY }
  });
  const t = await res.json();
  console.log("Asaas transfer:", t);

  const externalReference = t.externalReference || null;
  let user = null;
  if (externalReference) {
    user = await User.findOne({ "saques.externalReference": externalReference });
  } else {
    user = await User.findOne({ "saques.asaasId": transferId });
  }

  if (!user) {
    console.error("Usuário não encontrado para transfer:", transferId);
    process.exit(1);
  }

  const saque = user.saques.find(s => (s.externalReference === externalReference) || (s.asaasId === transferId));
  if (!saque) {
    console.error("Saque não encontrado no usuário:", user._id);
    process.exit(1);
  }

  const newStatus = t.status === "CONFIRMED" ? "pago" : (t.status === "FAILED" ? "falhou" : "pendente");
  saque.status = newStatus;
  saque.asaasId = transferId;
  saque.bankAccount = t.bankAccount || saque.bankAccount || null;
  await user.save();
  console.log("Saque atualizado:", { userId: user._id, novoStatus: newStatus });
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
