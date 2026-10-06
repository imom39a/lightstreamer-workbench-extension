import type { BrowserContext } from "@playwright/test";

export type BrowserFailureDiagnostics = {
  connect(endpoint: string): Promise<void>;
  observeContext(context: BrowserContext): Promise<void>;
  observeCdp(label: string, cdp: {
    request(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(method: string, listener: (params: unknown) => void): () => void;
  }): Promise<void>;
  browserLog(text: string): void;
  step(name: string): Promise<void>;
  captureFailure(error: unknown, details?: unknown): Promise<string | undefined>;
  dispose(): Promise<void>;
};

export function createBrowserFailureDiagnostics(options: {
  outputDir?: string;
  rootDir?: string;
  journey: string;
  attempt?: number;
  redactValues?: readonly string[];
  operationTimeoutMs?: number;
}): BrowserFailureDiagnostics;
