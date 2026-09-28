import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@paperclipai/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  /** Defaults to the agent-wide default; local-model agents pass a lower cap. */
  maxConcurrentRuns?: number;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      skipTimerWhenNoActionableWork: true,
      cooldownSec: 10,
      maxConcurrentRuns: input?.maxConcurrentRuns ?? AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    },
  };

  return config;
}
