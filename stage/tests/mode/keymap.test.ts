import { describe, expect, it } from "@rstest/core";
import { ModeType } from "../../src/mode/base";
import { KEY_TO_MODE } from "../../src/mode/index";

describe("KEY_TO_MODE", () => {
  it("matches the documented mode table (4 = Manipulate, 5 = Measure)", () => {
    // Regression guard: keyboard `4`/`5` were previously swapped relative to
    // app.setMode and the docs. Lock the mapping down.
    expect(KEY_TO_MODE["1"]).toBe(ModeType.View);
    expect(KEY_TO_MODE["2"]).toBe(ModeType.Select);
    expect(KEY_TO_MODE["3"]).toBe(ModeType.Edit);
    expect(KEY_TO_MODE["4"]).toBe(ModeType.Manipulate);
    expect(KEY_TO_MODE["5"]).toBe(ModeType.Measure);
  });

  it("only maps the five digit keys", () => {
    expect(Object.keys(KEY_TO_MODE).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });
});
