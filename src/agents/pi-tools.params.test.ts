import { describe, expect, it, vi } from "vitest";
import {
  assertRequiredParams,
  REQUIRED_PARAM_GROUPS,
  getToolParamsRecord,
  normalizeToolParams,
  wrapToolParamValidation,
} from "./pi-tools.params.js";

describe("assertRequiredParams", () => {
  it("returns object params unchanged", () => {
    const params = { path: "test.txt" };
    expect(getToolParamsRecord(params)).toBe(params);
  });

  it("includes received keys in error when some params are present but content is missing", () => {
    expect(() =>
      assertRequiredParams(
        { path: "test.txt" },
        [
          { keys: ["path"], label: "path" },
          { keys: ["content"], label: "content" },
        ],
        "write",
      ),
    ).toThrow(/\(received: path\)/);
  });

  it("normalizes path aliases before validation and execution", async () => {
    const execute = vi.fn();
    const tool = wrapToolParamValidation(
      {
        name: "write",
        label: "write",
        description: "write a file",
        parameters: {},
        execute,
      },
      REQUIRED_PARAM_GROUPS.write,
    );
    await tool.execute(
      "id",
      { file_path: "test.txt", content: "hello" },
      new AbortController().signal,
      vi.fn(),
    );
    expect(execute).toHaveBeenCalledWith(
      "id",
      { path: "test.txt", content: "hello" },
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("synthesizes edit replacements from top-level alias parameters", () => {
    expect(
      normalizeToolParams({
        filePath: "notes.txt",
        old_text: "old",
        newString: "new",
      }),
    ).toEqual({
      path: "notes.txt",
      oldText: "old",
      newText: "new",
      edits: [{ oldText: "old", newText: "new" }],
    });
  });

  it("prefers non-empty aliases when canonical params are empty strings", () => {
    expect(
      normalizeToolParams({
        path: "   ",
        file_path: "notes.txt",
        oldText: "   ",
        old_text: "old",
        newText: "",
        new_text: "new",
      }),
    ).toEqual({
      path: "notes.txt",
      oldText: "old",
      newText: "new",
      edits: [{ oldText: "old", newText: "new" }],
    });
  });

  it("prefers valid aliases when canonical params are the wrong type", () => {
    expect(
      normalizeToolParams({
        path: {},
        file_path: "notes.txt",
        oldText: { bad: true },
        old_text: "old",
        newText: ["bad"],
        new_text: "",
      }),
    ).toEqual({
      path: "notes.txt",
      oldText: "old",
      newText: "",
      edits: [{ oldText: "old", newText: "" }],
    });
  });

  it("excludes null and undefined values from received hint", () => {
    expect(() =>
      assertRequiredParams(
        { path: "test.txt", content: null },
        [
          { keys: ["path"], label: "path" },
          { keys: ["content"], label: "content" },
        ],
        "write",
      ),
    ).toThrow(/\(received: path\)[^,]/);
  });

  it("shows empty-string values for present params that still fail validation", () => {
    expect(() =>
      assertRequiredParams(
        { path: "/tmp/a.txt", content: "   " },
        [
          { keys: ["path"], label: "path" },
          { keys: ["content"], label: "content" },
        ],
        "write",
      ),
    ).toThrow(/\(received: path, content=<empty-string>\)/);
  });

  it("shows wrong-type values for present params that still fail validation", async () => {
    const tool = wrapToolParamValidation(
      {
        name: "write",
        label: "write",
        description: "write a file",
        parameters: {},
        execute: vi.fn(),
      },
      REQUIRED_PARAM_GROUPS.write,
    );
    await expect(
      tool.execute(
        "id",
        { path: "test.txt", content: { unexpected: true } },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow(/\(received: (?:path, content=<object>|content=<object>, path)\)/);
  });

  it("includes multiple received keys when several params are present", () => {
    expect(() =>
      assertRequiredParams(
        { path: "/tmp/a.txt", extra: "yes" },
        [
          { keys: ["path"], label: "path" },
          { keys: ["content"], label: "content" },
        ],
        "write",
      ),
    ).toThrow(/\(received: path, extra\)/);
  });

  it("omits received hint when the record is empty", () => {
    const err = (() => {
      try {
        assertRequiredParams({}, [{ keys: ["content"], label: "content" }], "write");
      } catch (e) {
        return e instanceof Error ? e.message : "";
      }
      return "";
    })();
    expect(err).not.toMatch(/received:/);
    expect(err).toMatch(/Missing required parameter: content/);
  });

  it("does not throw when all required params are present", () => {
    expect(() =>
      assertRequiredParams(
        { path: "a.txt", content: "hello" },
        [
          { keys: ["path"], label: "path" },
          { keys: ["content"], label: "content" },
        ],
        "write",
      ),
    ).not.toThrow();
  });
});
