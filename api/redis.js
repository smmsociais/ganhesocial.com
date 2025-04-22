import Redis from 'ioredis';

let redis;

if (!global.redis) {
  global.redis = new Redis(process.env.REDIS_URL);
}

redis = global.redis;

export default redis;
