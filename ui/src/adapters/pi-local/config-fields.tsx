import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  ToggleField,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";
import { PI_FULL_ACCESS_TOOLS, PI_READ_ONLY_TOOLS, resolvePiTools } from "@paperclipai/adapter-pi-local";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function PiLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  const tools = isCreate
    ? values!.adapterSchemaValues?.tools
    : eff("adapterConfig", "tools", config.tools);
  // Unset is the full tool set: that is what every pi_local agent ran with
  // before the field existed.
  const fullAccess = resolvePiTools(tools) === PI_FULL_ACCESS_TOOLS;
  const setFullAccess = (on: boolean) => {
    const next = on ? PI_FULL_ACCESS_TOOLS : PI_READ_ONLY_TOOLS;
    if (isCreate) set!({ adapterSchemaValues: { ...values!.adapterSchemaValues, tools: next } });
    else mark("adapterConfig", "tools", next);
  };
  return configFieldsForSection(section, (
    <>
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
        label="Full access"
        hint="On: Pi gets every tool — read, write, edit, bash, grep, find, ls — so it can change files and run commands without asking. Off: read-only tools (read, grep, find, ls)."
        checked={fullAccess}
        onChange={setFullAccess}
      />
    </>
  ));
}
