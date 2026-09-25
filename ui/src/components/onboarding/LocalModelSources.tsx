import type { ComponentType } from "react";
import { Server, Terminal } from "lucide-react";

import { cn } from "../../lib/utils";
import { OpenCodeLogoIcon } from "../OpenCodeLogoIcon";
import { OnboardingCardField, OnboardingLoginCard } from "../AdapterLoginChrome";
import { ToggleSwitch } from "../ui/toggle-switch";
import {
  getLocalModelSource,
  rankLocalModelSuggestions,
  type LocalModelSource,
  type LocalModelSourceId,
} from "../../lib/onboarding-local-models";

const LOCAL_SOURCE_ICONS: Record<LocalModelSourceId, ComponentType<{ className?: string }>> = {
  ollama: Server,
  opencode: OpenCodeLogoIcon,
  pi: Terminal,
};

/**
 * The connect step's second question: run the agent on a model that lives on
 * this machine instead of a hosted subscription or key.
 *
 * Presentational — the wizard owns which source is picked and the values of
 * its fields, because the hire reads them.
 */
/**
 * Whether the agent may change the workspace.
 *
 * Off by default: a local agent starts read-only and the operator opts in to
 * unattended writes. On, it gets the same reach as the Claude CLI — create,
 * edit and delete files and run shell commands without asking — which is what
 * it needs to work Paperclip tasks end to end.
 */
function FullAccessToggle({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-1">
      <ToggleSwitch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label="Allow full access"
        aria-describedby="local-model-full-access-hint"
      />
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">Allow full access</p>
        <p id="local-model-full-access-hint" className="text-xs text-muted-foreground">
          {checked
            ? "The agent can read, create, edit and delete files and run shell commands in its workspace without asking, so it can work tasks end to end."
            : "Read-only: the agent can read and search its workspace but cannot change files, run commands or update its tasks."}
        </p>
      </div>
    </div>
  );
}

export function LocalModelSourceRow({
  sources,
  selectedId,
  onSelect,
  disabled = false,
}: {
  /** Only sources whose adapter this instance offers. */
  sources: readonly LocalModelSource[];
  selectedId: LocalModelSourceId | null;
  onSelect: (id: LocalModelSourceId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-muted-foreground">Or run a local model</p>
      <div role="radiogroup" aria-label="Local model source" className="flex items-start gap-3">
        {sources.map((source) => {
          const Icon = LOCAL_SOURCE_ICONS[source.id];
          const selected = source.id === selectedId;
          return (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(source.id)}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2",
                "transition-(--tp-border-color-background-color) ease-(--motion-ease-standard) duration-(--motion-duration-fast)",
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3)",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-foreground/40 bg-accent"
                  : "border-border bg-card hover:bg-accent/40",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="text-(length:--text-compact) font-medium text-foreground">
                {source.label}
              </span>
              <span className="text-(length:--text-micro) text-muted-foreground">Local</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The fields a picked local source needs before it can be tested and hired. */
export function LocalModelSourceCard({
  sourceId,
  model,
  onModelChange,
  ollamaBaseUrl,
  onOllamaBaseUrlChange,
  ollamaModel,
  onOllamaModelChange,
  discoveredModelIds,
  discoveringModels,
  fullAccess,
  onFullAccessChange,
  disabled,
  onSubmit,
}: {
  sourceId: LocalModelSourceId;
  model: string;
  onModelChange: (value: string) => void;
  ollamaBaseUrl: string;
  onOllamaBaseUrlChange: (value: string) => void;
  ollamaModel: string;
  onOllamaModelChange: (value: string) => void;
  discoveredModelIds: string[];
  discoveringModels: boolean;
  fullAccess: boolean;
  onFullAccessChange: (value: boolean) => void;
  disabled?: boolean;
  onSubmit: () => void;
}) {
  const source = getLocalModelSource(sourceId);

  if (sourceId === "ollama") {
    return (
      <OnboardingLoginCard
        instruction={
          <>
            {source.description} Pull the model first with{" "}
            <span className="font-mono">ollama pull {ollamaModel.trim() || source.modelPlaceholder}</span>{" "}
            and pick one that supports tool calling. OpenCode must be installed on this host.
          </>
        }
      >
        <div className="space-y-2">
          <OnboardingCardField
            label="Ollama server URL"
            placeholder="http://localhost:11434"
            value={ollamaBaseUrl}
            onChange={onOllamaBaseUrlChange}
            onSubmit={onSubmit}
            disabled={disabled}
          />
          <OnboardingCardField
            label="Ollama model"
            placeholder={source.modelPlaceholder}
            value={ollamaModel}
            onChange={onOllamaModelChange}
            onSubmit={onSubmit}
            disabled={disabled}
            autoFocus
          />
          <FullAccessToggle checked={fullAccess} onCheckedChange={onFullAccessChange} disabled={disabled} />
        </div>
      </OnboardingLoginCard>
    );
  }

  const suggestions = rankLocalModelSuggestions(discoveredModelIds);
  // Shown for every local source: the agent is hired with full, unattended
  // tool access so it can work Paperclip tasks without approval prompts.
  const cli = sourceId === "pi" ? "pi --list-models" : "opencode models";
  return (
    <OnboardingLoginCard
      instruction={
        <>
          {source.description} Enter a model in <span className="font-mono">provider/model</span>{" "}
          format (see <span className="font-mono">{cli}</span>).
        </>
      }
    >
      <div className="space-y-2">
        <OnboardingCardField
          label={`${source.label} model`}
          placeholder={source.modelPlaceholder}
          value={model}
          onChange={onModelChange}
          onSubmit={onSubmit}
          disabled={disabled}
          autoFocus
        />
        {discoveringModels ? (
          <p className="px-1 text-xs text-muted-foreground">Looking for installed models…</p>
        ) : suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Discovered models">
            {suggestions.map((id) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => onModelChange(id)}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-0.5 font-mono text-(length:--text-micro)",
                  "outline-none focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3)",
                  id === model.trim()
                    ? "border-foreground/40 bg-accent text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent/40",
                )}
              >
                {id}
              </button>
            ))}
          </div>
        ) : null}
        <FullAccessToggle checked={fullAccess} onCheckedChange={onFullAccessChange} disabled={disabled} />
      </div>
    </OnboardingLoginCard>
  );
}
