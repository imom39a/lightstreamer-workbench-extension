export declare const CHROME_UNATTENDED_FLAGS: readonly string[];
export declare function chromeUnattendedArguments(extra?: readonly string[]): string[];
export declare function createPlaywrightLaunchOptions(executablePath?: string): { args: string[]; executablePath?: string };
