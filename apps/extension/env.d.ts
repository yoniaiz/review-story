interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_HARNESS_ACCESS_TOKEN?: string;
  readonly VITE_DEMO_OWNER?: string;
  readonly VITE_DEMO_REPO?: string;
  readonly VITE_DEMO_PR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
