import {
  type EventDiagnostic,
  type EventError,
  type EventErrorScope
} from "./event-envelope";

type DiagnosticDefinition = Pick<
  EventDiagnostic,
  "severity" | "title" | "explanation" | "suggestion"
>;

const CLIENT_DIAGNOSTICS: Readonly<Record<number, DiagnosticDefinition>> = {
  1: {
    severity: "warning",
    title: "Credentials were rejected",
    explanation: "The server rejected the user or password supplied for the session.",
    suggestion: "Check the inspected application's authentication inputs and Metadata Adapter authorization."
  },
  2: {
    severity: "warning",
    title: "Adapter Set is unavailable",
    explanation: "The requested Adapter Set is not available on the Lightstreamer Server.",
    suggestion: "Verify the Adapter Set name and the server endpoint used by the application."
  },
  7: {
    severity: "warning",
    title: "Licensed session limit was reached",
    explanation: "The server license does not allow another session for this client.",
    suggestion: "Check the server license and whether an existing session can be closed."
  },
  8: {
    severity: "warning",
    title: "Configured session limit was reached",
    explanation: "The server has reached its configured maximum number of sessions.",
    suggestion: "Check server capacity and configured session limits."
  },
  9: {
    severity: "warning",
    title: "Configured server load limit was reached",
    explanation: "The server refused the session because its configured load limit was reached.",
    suggestion: "Check server load and capacity before attempting another connection."
  },
  10: {
    severity: "warning",
    title: "New sessions are temporarily blocked",
    explanation: "The server is temporarily refusing new sessions.",
    suggestion: "Check server health and retry after the server allows new sessions."
  },
  11: {
    severity: "warning",
    title: "Streaming is not licensed",
    explanation: "The server license does not allow streaming for this client.",
    suggestion: "Check the server license and the transport configured by the application."
  },
  21: {
    severity: "warning",
    title: "Session routing mismatch",
    explanation: "A bind request reached a different Server instance than the one owning the session.",
    suggestion: "Check load-balancer affinity, server-instance handling, and the session routing path."
  },
  60: {
    severity: "warning",
    title: "Client version is not licensed",
    explanation: "The current client version is not allowed by the server license.",
    suggestion: "Check the server license and the Lightstreamer Web Client version."
  },
  61: {
    severity: "warning",
    title: "Server response could not be parsed",
    explanation: "The client could not parse a server response and cannot continue the current session.",
    suggestion: "Inspect the server response path, proxy behavior, and client/server protocol compatibility."
  },
  66: {
    severity: "warning",
    title: "Metadata Adapter authorization failed",
    explanation: "The Metadata Adapter threw while authorizing the client connection.",
    suggestion: "Inspect the server-side Metadata Adapter logs and authorization rules."
  },
  68: {
    severity: "warning",
    title: "Server could not continue the session",
    explanation: "The Server reported an internal error while opening or continuing the session.",
    suggestion: "Inspect server logs and the affected session's routing and adapter configuration."
  },
  70: {
    severity: "warning",
    title: "Server address contains an unusable port",
    explanation: "The configured server address specifies a port that cannot be used.",
    suggestion: "Verify the Lightstreamer server URL and its port configuration."
  },
  71: {
    severity: "warning",
    title: "Client type is not licensed",
    explanation: "The current client type is not allowed by the server license.",
    suggestion: "Check the server license and the client type used by the application."
  }
};

const SUBSCRIPTION_DIAGNOSTICS: Readonly<Record<number, DiagnosticDefinition>> = {
  14: {
    severity: "warning",
    title: "Second-level key is invalid",
    explanation: "The second-level key is not a valid item name.",
    suggestion: "Check the key value and the second-level item naming contract."
  },
  15: {
    severity: "warning",
    title: "COMMAND key field is missing",
    explanation: "The COMMAND schema does not specify the required key field.",
    suggestion: "Add a key field to the COMMAND subscription schema."
  },
  16: {
    severity: "warning",
    title: "COMMAND command field is missing",
    explanation: "The COMMAND schema does not specify the required command field.",
    suggestion: "Add a command field to the COMMAND subscription schema."
  },
  17: {
    severity: "warning",
    title: "Data Adapter is unavailable",
    explanation: "The requested Data Adapter is invalid or no default Data Adapter is configured.",
    suggestion: "Verify the Data Adapter name and the Adapter Set configuration."
  },
  21: {
    severity: "warning",
    title: "Item Group is invalid",
    explanation: "The server rejected the requested Item Group.",
    suggestion: "Check the item group name and the Adapter Set's available item groups."
  },
  22: {
    severity: "warning",
    title: "Item Group does not match the schema",
    explanation: "The requested Item Group is not valid for the supplied schema.",
    suggestion: "Check the item group and field schema as a pair."
  },
  23: {
    severity: "warning",
    title: "Field Schema is invalid",
    explanation: "The server rejected the requested field schema.",
    suggestion: "Verify the schema name and its Adapter Set configuration."
  },
  24: {
    severity: "warning",
    title: "Subscription mode is not allowed",
    explanation: "The requested mode is not allowed for one or more items.",
    suggestion: "Check the item capabilities and choose an allowed subscription mode."
  },
  25: {
    severity: "warning",
    title: "Selector is invalid",
    explanation: "The server rejected the requested Selector.",
    suggestion: "Verify the selector name and its server-side authorization."
  },
  26: {
    severity: "warning",
    title: "Unfiltered dispatch exceeds a frequency limit",
    explanation: "The item has a server-side frequency limit that prevents unfiltered dispatching.",
    suggestion: "Use filtered dispatching or request a frequency compatible with the item."
  },
  27: {
    severity: "warning",
    title: "Unfiltered dispatch is prefiltered",
    explanation: "Server prefiltering prevents unfiltered dispatching for the item.",
    suggestion: "Use filtered dispatching for this item."
  },
  28: {
    severity: "warning",
    title: "Unfiltered dispatch is not licensed",
    explanation: "The current server license does not allow unfiltered dispatching.",
    suggestion: "Check the server license or use filtered dispatching."
  },
  29: {
    severity: "warning",
    title: "RAW mode is not licensed",
    explanation: "The current server license does not allow RAW subscriptions.",
    suggestion: "Check the server license or choose an allowed subscription mode."
  },
  30: {
    severity: "warning",
    title: "Subscriptions are not licensed",
    explanation: "The current server license does not allow subscriptions.",
    suggestion: "Check the server license and deployment configuration."
  },
  66: {
    severity: "warning",
    title: "Metadata Adapter authorization failed",
    explanation: "The Metadata Adapter threw while authorizing the subscription request.",
    suggestion: "Inspect the server-side Metadata Adapter logs and authorization rules."
  },
  68: {
    severity: "warning",
    title: "Server could not fulfill the subscription request",
    explanation: "The Server reported an internal error while handling the subscription request.",
    suggestion: "Inspect server logs and the subscription's adapter, schema, and item configuration."
  }
};

const SECOND_LEVEL_DIAGNOSTIC_CODES = new Set([14, 17, 21, 22, 23, 24, 26, 27, 28, 66, 68]);

export function describeLightstreamerError(
  scope: EventErrorScope,
  code: number | null | undefined,
  message: string | null | undefined
): EventDiagnostic {
  const prefix = scope === "client" ? "CLIENT" : scope === "subscription" ? "SUBSCRIPTION" : "SECOND-LEVEL";
  const codeLabel = code === null || code === undefined ? "unknown" : String(code);
  const definition = definitionFor(scope, code);
  return {
    code: `LS-${prefix}-${codeLabel}`,
    scope,
    ...definition,
    ...(message !== undefined ? { serverMessage: message } : {})
  };
}

export function diagnosticsForEvent(
  error: EventError | undefined
): EventDiagnostic[] {
  return error ? [describeLightstreamerError(error.scope, error.code, error.message)] : [];
}

function definitionFor(
  scope: EventErrorScope,
  code: number | null | undefined
): DiagnosticDefinition {
  if (code !== null && code !== undefined) {
    if (scope === "client" && code >= 30 && code <= 41) {
      return {
        severity: "warning",
        title: "Session was closed externally",
        explanation: `The server or an external agent closed the session with code ${code}.`,
        suggestion: "Inspect server-side session lifecycle, administrator actions, and Metadata Adapter limits."
      };
    }
    if (
      (scope === "subscription" && code === 14) ||
      (scope === "second-level" && !SECOND_LEVEL_DIAGNOSTIC_CODES.has(code))
    ) {
      return fallbackDefinition(scope, code);
    }
    const definitions = scope === "client" ? CLIENT_DIAGNOSTICS : SUBSCRIPTION_DIAGNOSTICS;
    const known = definitions[code];
    if (known) {
      return known;
    }
  }
  return fallbackDefinition(scope, code);
}

function fallbackDefinition(
  scope: EventErrorScope,
  code: number | null | undefined
): DiagnosticDefinition {
  const subject = scope === "client" ? "client" : scope === "subscription" ? "subscription" : "second-level subscription";
  if (typeof code === "number" && code <= 0) {
    return {
      severity: "warning",
      title: "Metadata Adapter refused the request",
      explanation: `The Metadata Adapter supplied application-defined error code ${code} for the ${subject} request.`,
      suggestion: "Inspect the Metadata Adapter's authorization or validation rules for this application-defined code."
    };
  }
  return {
    severity: "warning",
    title: `Unknown Lightstreamer ${subject} error`,
    explanation:
      typeof code === "number"
        ? `The server supplied error code ${code}, which Workbench does not map to a standard explanation.`
        : "The callback did not provide a numeric Lightstreamer error code.",
    suggestion: "Use the original server message and inspect the server or Metadata Adapter logs."
  };
}
