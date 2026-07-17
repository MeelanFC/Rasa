import { clearAllRatings, getRatingCount } from "./db.js";

const before = getRatingCount();
const removed = clearAllRatings();
const after = getRatingCount();

console.log(`Cleared ${removed} rating(s). Before: ${before}, after: ${after}.`);
