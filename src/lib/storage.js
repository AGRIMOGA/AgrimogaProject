// src/lib/storage.js

export function loadJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    // لا شيء: مثلاً مساحة ممتلئة أو وضع خاص
  }
}

export default { loadJSON, saveJSON }
