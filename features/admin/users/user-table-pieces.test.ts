import { describe, expect, it } from "vitest";
import { maskEmail } from "./user-table-pieces";

// The admin directory shows masked emails so the list can be displayed without
// exposing full addresses. These cases pin the privacy behavior.
describe("maskEmail", () => {
  it("keeps the first and last local characters and the whole domain", () => {
    expect(maskEmail("owner@nazxf.my.id")).toBe("o•••r@nazxf.my.id");
  });

  it("collapses a short local part to a fixed mask", () => {
    expect(maskEmail("ab@example.com")).toBe("a•••@example.com");
    expect(maskEmail("a@example.com")).toBe("a•••@example.com");
  });

  it("caps the mask length so long addresses stay compact", () => {
    const masked = maskEmail("averylonglocalpart@example.com");
    expect(masked).toBe("a••••••t@example.com");
  });

  it("never returns the full local part", () => {
    const email = "secret.person@example.com";
    const masked = maskEmail(email);
    expect(masked).not.toContain("secret");
    expect(masked).toContain("@example.com");
  });

  it("handles a value with no at-sign", () => {
    expect(maskEmail("not-an-email")).toBe("•••");
  });
});
