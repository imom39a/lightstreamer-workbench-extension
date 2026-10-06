import { AGENT_PROTOCOL_VERSION, AGENT_READ_CONTRACT } from "./protocol";
import { FIREFOX_EXTENSION_ID } from "./browser-identity";

/** Public compatibility metadata only; this never carries a panel grant or inspected data. */
export type CompanionIdentity = Readonly<{
  identityVersion: 1;
  extensionId: string;
  firefoxExtensionId?: string;
  companionVersion: string;
  protocolVersion: number;
  readContractVersion: number;
}>;

export function assertCompanionIdentity(value: unknown, extensionId: string): CompanionIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COMPANION_INCOMPATIBLE: Companion identity is incompatible. Stop Workbench MCP servers and start the matching companion package.");
  }
  const identity = value as Record<string, unknown>;
  if (identity.identityVersion !== 1 || identity.protocolVersion !== AGENT_PROTOCOL_VERSION || identity.readContractVersion !== AGENT_READ_CONTRACT.version
    || typeof identity.extensionId !== "string" || !/^[a-p]{32}$/.test(identity.extensionId)
    || typeof identity.companionVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(identity.companionVersion) || identity.companionVersion.length > 64) {
    throw new Error("COMPANION_INCOMPATIBLE: The running companion uses an incompatible protocol or read contract. Stop existing Workbench MCP servers and start the matching companion package.");
  }
  if (extensionId === FIREFOX_EXTENSION_ID ? identity.firefoxExtensionId !== FIREFOX_EXTENSION_ID : identity.extensionId !== extensionId) {
    if (extensionId === FIREFOX_EXTENSION_ID) throw new Error("COMPANION_INCOMPATIBLE: The running companion does not support this Firefox add-on. Stop Workbench MCP servers and run setup with the matching companion package.");
    throw new Error(`COMPANION_INCOMPATIBLE: Companion extension ${identity.extensionId} differs from required ${extensionId}. Stop Workbench MCP servers; run setup --extension-id ${extensionId} with the matching package.`);
  }
  return Object.freeze({ identityVersion: 1, extensionId: identity.extensionId, companionVersion: identity.companionVersion,
    ...(identity.firefoxExtensionId === FIREFOX_EXTENSION_ID ? { firefoxExtensionId: FIREFOX_EXTENSION_ID } : {}),
    protocolVersion: identity.protocolVersion as number, readContractVersion: identity.readContractVersion as number });
}
