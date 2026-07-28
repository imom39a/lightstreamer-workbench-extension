/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LSEW_GA_MEASUREMENT_ID?: string;
  readonly VITE_LSEW_GA_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
