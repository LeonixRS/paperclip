import { describe, expect, it } from "vitest";
import { PI_FULL_ACCESS_TOOLS, PI_READ_ONLY_TOOLS, resolvePiTools } from "./index.js";

describe("resolvePiTools", () => {
  it("keeps the full tool set when unset", () => {
    expect(resolvePiTools(undefined)).toBe(PI_FULL_ACCESS_TOOLS);
    expect(resolvePiTools("  , ")).toBe(PI_FULL_ACCESS_TOOLS);
  });

  it("passes a configured tool list through, trimmed and de-duplicated", () => {
    expect(resolvePiTools(PI_READ_ONLY_TOOLS)).toBe("read,grep,find,ls");
    expect(resolvePiTools(" read, ls ,read ")).toBe("read,ls");
  });
});
