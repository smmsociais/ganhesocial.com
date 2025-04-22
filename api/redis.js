
import { Redis } from "@upstash/redis";

// Ele lê automaticamente estas duas variáveis de ambiente:
const redis = Redis.fromEnv();

export default redis;
