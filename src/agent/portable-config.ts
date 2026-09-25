import { parsePairingCode } from "./pairing";

// A credential string preserves existing authenticated configurations. Auth off
// is explicit on the wire; neither side negotiates a downgrade after failure.
export type PortableConfig = string | Readonly<{ auth: "off"; port: number }>;
export type CompanionAuth = "off" | "required";

export function companionPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Companion port must be an integer from 1024 to 65535.");
  return port;
}

export function portableConfig(value: PortableConfig) {
  if (typeof value === "string") return { auth: "required" as const, ...parsePairingCode(value) };
  if (!value || value.auth !== "off") throw new Error("Invalid companion authentication configuration.");
  return { auth: "off" as const, port: companionPort(value.port), secret: undefined };
}
