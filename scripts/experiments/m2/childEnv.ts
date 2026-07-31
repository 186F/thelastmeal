/**
 * Allowlisted child environments (Phase 3 audit finding 9; re-audit
 * finding 6).
 *
 * The governing boundary: ONLY the authorized live gateway process
 * receives the key. A blanket `{ ...process.env }` would copy an operator
 * shell's OPENROUTER_API_KEY / OPENAI_API_KEY into every child — so every
 * non-live child, HELPERS INCLUDED (keep-awake, zip/unzip/tar, git,
 * taskkill), is built from an explicit allowlist of platform variables
 * plus the specific settings that child needs, and the credential
 * variables are structurally absent. Only `liveGatewayEnv` passes the full
 * parent environment through, because the live gateway is the one
 * authorized credential reader (§19.15).
 */

/** Platform variables required for child processes to function at all
 * (PATH resolution, temp dirs, Windows system roots, HTTPS proxies are
 * deliberately excluded). */
const PLATFORM_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'LANG',
  'LC_ALL',
  'SHELL',
  'USER',
  'USERNAME',
  'NODE_OPTIONS',
] as const;

export const SECRET_ENV_VARS = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY'] as const;

function platformBase(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of PLATFORM_ALLOWLIST) {
    if (parent[name] !== undefined) env[name] = parent[name];
  }
  return env;
}

/** Every non-live-gateway HELPER process (keep-awake, archive utilities,
 * git, taskkill, and any future spawn): platform base only (re-audit
 * finding 6). */
export function helperEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return platformBase(parent);
}

/** Vite dev server: platform base + the gateway URL the app must bake in. */
export function viteChildEnv(parent: NodeJS.ProcessEnv, gatewayUrl: string): NodeJS.ProcessEnv {
  return { ...platformBase(parent), VITE_MODEL_GATEWAY_URL: gatewayUrl };
}

/** Post-sequence batch runner: platform base only. */
export function batchChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return platformBase(parent);
}

/** Keyless fake gateway: platform base only — gateway settings are added
 * explicitly by the gateway driver, credentials are structurally absent, and
 * the fake-mode config loader independently refuses `.env.gateway` and
 * blanks credential fields (defense in depth). */
export function fakeGatewayEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return platformBase(parent);
}

/** Live gateway: the one authorized credential reader. It receives the full
 * parent environment (so an operator-exported key or `.env.gateway` file
 * works exactly as it does when a human starts the gateway). */
export function liveGatewayEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...parent };
}
