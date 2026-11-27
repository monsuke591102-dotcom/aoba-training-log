/// <reference types="vite/client" />

declare const __TRAINING_CLOUD_CONFIG__: ReturnType<typeof import('./cloudConfig').cloudConfig>
declare const __LOCAL_MENU_DELETE__: boolean
declare const __LOCAL_MATCH_RECORDS__: boolean
declare const __PAGES_MATCH_RECORDS__: boolean
declare const __STRIKEOUT_CLASSIFICATION__: boolean
declare const __MATCH_TEST_BUILD__: { origin: string; build: string } | null
