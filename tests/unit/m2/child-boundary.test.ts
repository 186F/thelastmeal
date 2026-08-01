import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  batchChildEnv,
  browserChildEnv,
  fakeGatewayEnv,
  helperEnv,
  liveGatewayEnv,
  viteChildEnv,
  SECRET_ENV_VARS,
} from '../../../scripts/experiments/m2/childEnv';
import { acquireKeepAwake, type KeepAwakeSpawn } from '../../../scripts/experiments/m2/keepAwake';
import {
  acquireKeepAwakeForPlan,
  type OrchestrateOptions,
} from '../../../scripts/experiments/m2/orchestrate';
import { orchestratorPlanSchema } from '../../../scripts/experiments/m2/planSchema';

/**
 * Process-boundary secret tests (re-audit finding 6): a canary credential
 * exported in the PARENT environment must be invisible INSIDE every
 * non-live-gateway child — proven by spawning a real child that prints
 * what it sees, not merely by inspecting returned env objects. Keep-awake
 * is live-only, acquired only after the acknowledgement gate, and its
 * helper spawn carries the nonsecret environment.
 */

const POISONED: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  PATHEXT: process.env.PATHEXT,
  SYSTEMROOT: process.env.SYSTEMROOT,
  OPENROUTER_API_KEY: 'sk-or-v1-parent-canary',
  OPENAI_API_KEY: 'sk-parent-canary',
  M2_BOUNDARY_CANARY: 'boundary-canary-value',
};

/** Spawns a real Node child with the candidate environment and returns
 * exactly what the CHILD observes. */
function observeInsideChild(env: NodeJS.ProcessEnv): {
  openrouter: string | null;
  openai: string | null;
  canary: string | null;
} {
  const script =
    'process.stdout.write(JSON.stringify({' +
    'openrouter: process.env.OPENROUTER_API_KEY ?? null,' +
    'openai: process.env.OPENAI_API_KEY ?? null,' +
    'canary: process.env.M2_BOUNDARY_CANARY ?? null}))';
  const out = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  return JSON.parse(out) as {
    openrouter: string | null;
    openai: string | null;
    canary: string | null;
  };
}

describe('child process boundary (spawned observation)', () => {
  it('helper, vite, batch, fake-gateway, AND Chromium children observe NO credentials', () => {
    // The helper list is not exhaustive by assumption: Chromium is
    // enumerated explicitly (focused re-audit finding 2 §5.4).
    for (const [name, env] of [
      ['helper', helperEnv(POISONED)],
      ['vite', viteChildEnv(POISONED, 'http://localhost:8799')],
      ['batch', batchChildEnv(POISONED)],
      ['fake-gateway', fakeGatewayEnv(POISONED)],
      ['chromium-headless', browserChildEnv(POISONED, false)],
      ['chromium-headed', browserChildEnv(POISONED, true)],
    ] as const) {
      const seen = observeInsideChild(env);
      expect(seen.openrouter, name).toBeNull();
      expect(seen.openai, name).toBeNull();
      expect(seen.canary, name).toBeNull();
    }
  });

  it('ONLY the live gateway child observes the credentials (the authorized reader)', () => {
    const seen = observeInsideChild(liveGatewayEnv(POISONED));
    expect(seen.openrouter).toBe('sk-or-v1-parent-canary');
    expect(seen.openai).toBe('sk-parent-canary');
  });

  it('the secret variable list stays structurally excluded from the helper allowlist', () => {
    const env = helperEnv(POISONED);
    for (const name of SECRET_ENV_VARS) {
      expect(env[name], name).toBeUndefined();
    }
  });

  it('headed Chromium restores ONLY the display/session variables, never the parent spread', () => {
    const parent: NodeJS.ProcessEnv = {
      ...POISONED,
      DISPLAY: ':1',
      XAUTHORITY: '/home/op/.Xauthority',
      WAYLAND_DISPLAY: 'wayland-0',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    };
    const headed = browserChildEnv(parent, true);
    expect(headed.DISPLAY).toBe(':1');
    expect(headed.XAUTHORITY).toBe('/home/op/.Xauthority');
    expect(headed.WAYLAND_DISPLAY).toBe('wayland-0');
    expect(headed.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus');
    for (const name of SECRET_ENV_VARS) {
      expect(headed[name], name).toBeUndefined();
    }
    expect(headed.M2_BOUNDARY_CANARY).toBeUndefined();
    // Headless operation gets no display variables at all.
    const headless = browserChildEnv(parent, false);
    expect(headless.DISPLAY).toBeUndefined();
    expect(headless.WAYLAND_DISPLAY).toBeUndefined();
  });
});

describe('archive and git helpers run under the helper environment', () => {
  it('packageEvidence and orchestrate spawn helpers with helperEnv, never process.env', () => {
    // The spawn sites are code, not configuration: assert the source binds
    // every helper spawn to helperEnv so a future edit cannot silently
    // reintroduce inheritance.
    const packageSource = readFileSync(
      join('scripts', 'experiments', 'm2', 'packageEvidence.ts'),
      'utf8',
    );
    expect(packageSource).toContain('env: helperEnv(process.env)');
    const orchestrateSource = readFileSync(
      join('scripts', 'experiments', 'm2', 'orchestrate.ts'),
      'utf8',
    );
    expect(orchestrateSource.match(/execFileSync\('git'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(orchestrateSource).toContain('env: helperEnv(process.env)');
    // The Chromium launch is bound to the reduced browser environment
    // (focused re-audit finding 2): the browser must never inherit the
    // orchestrator's parent environment.
    expect(orchestrateSource).toContain('env: browserChildEnv(process.env, options.headed)');
    expect(orchestrateSource).not.toMatch(/chromium\.launch\(\{ headless: [^}]*\}\)/);
    const processManagerSource = readFileSync(
      join('scripts', 'experiments', 'm2', 'processManager.ts'),
      'utf8',
    );
    expect(processManagerSource).toContain("spawn('taskkill'");
    expect(processManagerSource).toContain('env: helperEnv(process.env)');
    const keepAwakeSource = readFileSync(
      join('scripts', 'experiments', 'm2', 'keepAwake.ts'),
      'utf8',
    );
    expect(keepAwakeSource).toContain('helperEnv(process.env)');
  });
});

describe('keep-awake governance (re-audit finding 6, §10.4)', () => {
  function fakeChild(): ChildProcess {
    return {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      on: () => undefined,
      kill: () => true,
    } as unknown as ChildProcess;
  }

  function planFromRehearsal(mutate?: (plan: Record<string, unknown>) => void) {
    const raw = JSON.parse(
      readFileSync(join('experiments', 'm2', 'plans', 'rehearsal.json'), 'utf8'),
    ) as Record<string, unknown>;
    mutate?.(raw);
    return orchestratorPlanSchema.parse(raw);
  }

  const baseOptions: OrchestrateOptions = {
    planPath: 'x',
    resume: false,
    acknowledgeLiveCost: false,
    allowSleepRisk: false,
    headed: false,
    repoRoot: process.cwd(),
  };

  it('non-live plans NEVER acquire a keep-awake lease', async () => {
    let acquireCalls = 0;
    const lease = await acquireKeepAwakeForPlan(planFromRehearsal(), baseOptions, async () => {
      acquireCalls += 1;
      return null;
    });
    expect(lease).toBeNull();
    expect(acquireCalls).toBe(0);
  });

  /** A live plan OBJECT for the keep-awake gates. Since the final
   * targeted remediation, a live plan cannot even PARSE without a
   * closed-registry registration — the schema wall refuses first — so
   * this fixture is built at the object level to exercise the
   * downstream acknowledgement/lease gates as defense in depth. */
  function livePlanObject() {
    const plan = planFromRehearsal();
    return {
      ...plan,
      attempts: plan.attempts.map((attempt, index) =>
        index === 1
          ? { ...attempt, gatewayMode: 'live' as const, maxCallsPerRun: 10, maxTotalCalls: 10 }
          : attempt,
      ),
      liveCallBudget: 100,
    };
  }

  it('a refused live launch never spawns the helper (acknowledgement gate runs first)', async () => {
    const livePlan = livePlanObject();
    let acquireCalls = 0;
    const previous = process.env.M2_LIVE_RUNS;
    delete process.env.M2_LIVE_RUNS;
    try {
      await expect(
        acquireKeepAwakeForPlan(livePlan, baseOptions, async () => {
          acquireCalls += 1;
          return null;
        }),
      ).rejects.toThrow(/live-plan-not-acknowledged/);
    } finally {
      if (previous !== undefined) process.env.M2_LIVE_RUNS = previous;
    }
    expect(acquireCalls).toBe(0);
  });

  it('an acknowledged live plan without a lease refuses unless --allow-sleep-risk', async () => {
    const livePlan = livePlanObject();
    const previous = process.env.M2_LIVE_RUNS;
    process.env.M2_LIVE_RUNS = '1';
    try {
      const acknowledged = { ...baseOptions, acknowledgeLiveCost: true };
      await expect(
        acquireKeepAwakeForPlan(livePlan, acknowledged, async () => null),
      ).rejects.toThrow(/keep-awake-unavailable/);
      const tolerated = await acquireKeepAwakeForPlan(
        livePlan,
        { ...acknowledged, allowSleepRisk: true },
        async () => null,
      );
      expect(tolerated).toBeNull();
    } finally {
      if (previous !== undefined) process.env.M2_LIVE_RUNS = previous;
      else delete process.env.M2_LIVE_RUNS;
    }
  });

  it('the keep-awake helper spawn itself receives the nonsecret environment', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-keepawake-canary';
    try {
      let observedEnv: NodeJS.ProcessEnv | undefined;
      const spawnImpl: KeepAwakeSpawn = ((
        _command: string,
        _args: string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        observedEnv = options.env;
        return fakeChild();
      }) as unknown as KeepAwakeSpawn;
      const lease = await acquireKeepAwake(spawnImpl);
      expect(lease).not.toBeNull();
      expect(lease!.pid).toBe(4242);
      expect(observedEnv).toBeDefined();
      expect(observedEnv!.OPENROUTER_API_KEY).toBeUndefined();
      lease!.release();
    } finally {
      if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });
});
