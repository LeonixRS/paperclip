// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { defaultCreateValues } from "@/components/agent-config-defaults";
import { OpenCodeLocalConfigFields } from "./opencode-local/config-fields";
import { PiLocalConfigFields } from "./pi-local/config-fields";
import type { AdapterConfigFieldsProps } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(Component: typeof OpenCodeLocalConfigFields, props: Partial<AdapterConfigFieldsProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <TooltipProvider>
        <Component
          mode="edit"
          isCreate={false}
          adapterType="opencode_local"
          values={null}
          set={null}
          config={{}}
          eff={(_group, _field, original) => original}
          mark={vi.fn()}
          models={[]}
          {...props}
        />
      </TooltipProvider>,
    );
  });
  return { container, root };
}

/** The switch in the toggle row whose label reads `label`. */
function toggle(container: HTMLElement, label: string): HTMLButtonElement {
  const span = Array.from(container.querySelectorAll("span")).find((el) => el.textContent?.trim() === label);
  const button = span?.parentElement?.parentElement?.querySelector('button[role="switch"]');
  if (!button) throw new Error(`No toggle labelled ${label}`);
  return button as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OpenCode local Ollama fields", () => {
  it("wires a new agent to Ollama and clears the hosted model", () => {
    const set = vi.fn();
    const { container } = render(OpenCodeLocalConfigFields, {
      mode: "create",
      isCreate: true,
      values: { ...defaultCreateValues, adapterType: "opencode_local", model: "openai/gpt-5.5" },
      set,
    });
    act(() => toggle(container, "Run on local Ollama").click());
    expect(set).toHaveBeenCalledWith({
      envBindings: {
        PAPERCLIP_OPENCODE_PROVIDERS: {
          type: "plain",
          value: JSON.stringify({
            ollama: {
              npm: "@ai-sdk/openai-compatible",
              name: "Ollama (local)",
              options: { baseURL: "http://localhost:11434/v1" },
            },
          }),
        },
      },
      envVars: "",
    });
    expect(set).toHaveBeenCalledWith({ model: "" });
  });

  it("switches an existing Ollama agent between read-only and full access", () => {
    const mark = vi.fn();
    const { container } = render(OpenCodeLocalConfigFields, {
      config: { model: "ollama/qwen2.5-coder:14b", readOnly: true, dangerouslySkipPermissions: false },
      mark,
    });
    expect(container.textContent).toContain("Ollama server URL");
    const fullAccess = toggle(container, "Full access");
    expect(fullAccess.getAttribute("aria-checked")).toBe("false");
    act(() => fullAccess.click());
    expect(mark).toHaveBeenCalledWith("adapterConfig", "dangerouslySkipPermissions", true);
    expect(mark).toHaveBeenCalledWith("adapterConfig", "readOnly", undefined);
  });

  it("offers no Ollama option under the managed-sandbox-only policy", () => {
    const { container } = render(OpenCodeLocalConfigFields, { managedSandboxOnly: true });
    expect(container.textContent).not.toContain("Run on local Ollama");
  });
});

describe("Pi full access field", () => {
  it("narrows an existing Pi agent to read-only tools", () => {
    const mark = vi.fn();
    const { container } = render(PiLocalConfigFields, { adapterType: "pi_local", mark });
    act(() => toggle(container, "Full access").click());
    expect(mark).toHaveBeenCalledWith("adapterConfig", "tools", "read,grep,find,ls");
  });
});
