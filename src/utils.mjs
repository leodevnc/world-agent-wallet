import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export class WalletError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function requireThat(condition, code, message, status = 400) {
  if (!condition) throw new WalletError(code, message, status);
}
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function sameSecret(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)))
  );
}
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}
export const digest = (value) => hash(canonical(value));
export function money(value) {
  requireThat(
    typeof value === "string" && /^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(value),
    "INVALID_AMOUNT",
    "USDC amounts must be positive decimal strings with at most 6 decimal places.",
  );
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
}
export const formatMoney = (micros) =>
  (micros / 1_000_000).toFixed(6).replace(/\.?0+$/, "") || "0";
export function dayKey(now, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}
export const iso = (value) => new Date(value).toISOString();
export const json = (value) => JSON.stringify(value);
