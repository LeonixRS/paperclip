import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  ToggleField,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";
import type { AdapterConfigSection } from "../types";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_PROVIDER_ID,
  OPENCODE_PROVIDERS_ENV_KEY,
  isOllamaAgentConfig,
  ollamaProviderEnvBinding,
  readOllamaBaseUrlFromEnv,
} from "../../lib/onboarding-local-models";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

/**
 * Run the agent on a model served by a local Ollama.
 *
 * Wires OpenCode to Ollama through the provider block the adapter injects at
 * run time, and switches the form's model picker to the server's own models
 * (see `readOllamaBaseUrlFromEnv` in AgentConfigForm). Access is a separate,
 * explicit choice: read-only, or full unattended access to files and shell.
 */
function OllamaFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps & { configSection?: AdapterConfigSection }) {
  const env = (isCreate ? values!.envBindings : eff("adapterConfig", "env", config.env)) as
    | Record<string, unknown>
    | undefined;
  const model = isCreate ? values!.model : eff("adapterConfig", "model", String(config.model ?? ""));
  const baseUrl = readOllamaBaseUrlFromEnv(env);
  const enabled = baseUrl !== null || isOllamaAgentConfig(model, null);
  const readOnly = isCreate
    ? values!.adapterSchemaValues?.readOnly === true
    : eff("adapterConfig", "readOnly", config.readOnly === true);
  const skipPermissions = isCreate
    ? values!.dangerouslySkipPermissions
    : eff("adapterConfig", "dangerouslySkipPermissions", config.dangerouslySkipPermissions !== false);
  const fullAccess = !readOnly && skipPermissions;

  const writeEnv = (next: Record<string, unknown>) =>
    isCreate ? set!({ envBindings: next, envVars: "" }) : mark("adapterConfig", "env", next);
  const writeModel = (next: string) =>
    isCreate ? set!({ model: next }) : mark("adapterConfig", "model", next || undefined);

  const setEnabled = (on: boolean) => {
    const next = { ...(env ?? {}) };
    if (on) {
      next[OPENCODE_PROVIDERS_ENV_KEY] = ollamaProviderEnvBinding(baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
      writeEnv(next);
      // A hosted model id means nothing to Ollama; the picker offers its own.
      if (!String(model ?? "").startsWith(`${OLLAMA_PROVIDER_ID}/`)) writeModel("");
    } else {
      delete next[OPENCODE_PROVIDERS_ENV_KEY];
      writeEnv(next);
      if (String(model ?? "").startsWith(`${OLLAMA_PROVIDER_ID}/`)) writeModel("");
    }
  };
  const setFullAccess = (on: boolean) => {
    if (isCreate) {
      set!({
        dangerouslySkipPermissions: on,
        adapterSchemaValues: { ...values!.adapterSchemaValues, readOnly: !on },
      });
    } else {
      mark("adapterConfig", "dangerouslySkipPermissions", on);
      mark("adapterConfig", "readOnly", on ? undefined : true);
    }
  };

  return (
    <div className="space-y-3">
      <ToggleField
        label="Run on local Ollama"
        hint="Use a model served by Ollama on this host. The model list switches to the models Ollama has pulled; pick one that supports tools."
        checked={enabled}
        onChange={setEnabled}
      />
      {enabled && (
        <>
          <Field
            label="Ollama server URL"
            hint="Where Ollama listens. The default for a local install is http://localhost:11434."
          >
            <DraftInput
              value={baseUrl ?? DEFAULT_OLLAMA_BASE_URL}
              onCommit={(v) =>
                writeEnv({
                  ...(env ?? {}),
                  [OPENCODE_PROVIDERS_ENV_KEY]: ollamaProviderEnvBinding(v.trim() || DEFAULT_OLLAMA_BASE_URL),
                })
              }
              className={inputClass}
              placeholder={DEFAULT_OLLAMA_BASE_URL}
            />
          </Field>
          <ToggleField
            label="Full access"
            hint="On: the agent can read, create, edit and delete files and run shell commands without asking, so it can work tasks end to end. Off: read-only — it can read and search the workspace but cannot change files, run commands or update its tasks."
            checked={fullAccess}
            onChange={setFullAccess}
          />
        </>
      )}
    </div>
  );
}

export function OpenCodeLocalConfigFields(props: AdapterConfigFieldsProps) {
  const {
    section,
    isCreate,
    values,
    set,
    config,
    eff,
    mark,
    hideInstructionsFile,
    managedSandboxOnly,
  } = props;
  return configFieldsForSection(section, (
    <>
      {/* A managed sandbox cannot reach an Ollama on the operator's host. */}
      {!managedSandboxOnly && <OllamaFields {...props} configSection="adapter" />}
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      <ToggleField
        label="Skip permissions"
        hint={help.dangerouslySkipPermissions}
        checked={
          isCreate
            ? values!.dangerouslySkipPermissions
            : eff(
                "adapterConfig",
                "dangerouslySkipPermissions",
                config.dangerouslySkipPermissions !== false,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ dangerouslySkipPermissions: v })
            : mark("adapterConfig", "dangerouslySkipPermissions", v)
        }
      />
    </>
  ));
}
