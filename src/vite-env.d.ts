/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BEEPER_API_BASE?: string;
  readonly VITE_BEEPER_OAUTH_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
