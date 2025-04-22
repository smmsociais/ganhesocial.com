// lib/actionCache.js (novo arquivo para manter o cache simples)

const actionCache = {};

export function setActionForUser(userId, actionData) {
  actionCache[userId] = actionData;
}

export function getActionForUser(userId) {
  return actionCache[userId];
}

export function clearActionForUser(userId) {
  delete actionCache[userId];
}
