import { describe, expect, it } from "vitest";
import { hasPermission, ROLE_PERMISSIONS } from "./permissions";

describe("permission matrix", () => {
  it("is strictly additive up the role hierarchy", () => {
    const chain = [
      "CITIZEN",
      "FIELD_WORKER",
      "DEPARTMENT_MANAGER",
      "ORGANIZATION_ADMIN",
      "SUPER_ADMIN",
    ] as const;
    for (let i = 1; i < chain.length; i++) {
      for (const permission of ROLE_PERMISSIONS[chain[i - 1]!]) {
        expect(ROLE_PERMISSIONS[chain[i]!].has(permission)).toBe(true);
      }
    }
  });

  it("keeps privileged permissions away from citizens and workers", () => {
    expect(hasPermission("CITIZEN", "complaint:triage")).toBe(false);
    expect(hasPermission("CITIZEN", "complaint:read:all")).toBe(false);
    expect(hasPermission("FIELD_WORKER", "member:manage")).toBe(false);
    expect(hasPermission("DEPARTMENT_MANAGER", "audit:read")).toBe(false);
    expect(hasPermission("ORGANIZATION_ADMIN", "platform:admin")).toBe(false);
  });

  it("denies everything without a role", () => {
    expect(hasPermission(null, "complaint:create")).toBe(false);
  });
});
