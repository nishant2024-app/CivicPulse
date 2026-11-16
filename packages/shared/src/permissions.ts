import type { Role } from "./enums";

/**
 * Static role → permission matrix (layer 1 of authorization).
 * Layer 2 — the actor's relationship to a specific resource — is checked in services.
 * Layer 3 — organization isolation — is enforced by PostgreSQL row-level security.
 */
export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "organization:create",
  "member:read",
  "member:manage",
  "invitation:manage",
  "department:read",
  "department:manage",
  "category:manage",
  "sla:manage",
  "complaint:create",
  "complaint:read:own",
  "complaint:read:assigned",
  "complaint:read:department",
  "complaint:read:all",
  "complaint:triage", // verify, reject, set priority, assign
  "complaint:work", // progress updates by the assignee
  "complaint:comment:internal",
  "search:use",
  "analytics:read",
  "audit:read",
  "platform:admin",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CITIZEN: Permission[] = [
  "organization:read",
  "department:read",
  "complaint:create",
  "complaint:read:own",
];

const FIELD_WORKER: Permission[] = [
  ...CITIZEN,
  "complaint:read:assigned",
  "complaint:work",
  "complaint:comment:internal",
  "search:use",
];

const DEPARTMENT_MANAGER: Permission[] = [
  ...FIELD_WORKER,
  "member:read",
  "complaint:read:department",
  "complaint:triage",
  "analytics:read",
];

const ORGANIZATION_ADMIN: Permission[] = [
  ...DEPARTMENT_MANAGER,
  "organization:update",
  "member:manage",
  "invitation:manage",
  "department:manage",
  "category:manage",
  "sla:manage",
  "complaint:read:all",
  "audit:read",
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  CITIZEN: new Set(CITIZEN),
  FIELD_WORKER: new Set(FIELD_WORKER),
  DEPARTMENT_MANAGER: new Set(DEPARTMENT_MANAGER),
  ORGANIZATION_ADMIN: new Set(ORGANIZATION_ADMIN),
  SUPER_ADMIN: new Set<Permission>([...ORGANIZATION_ADMIN, "organization:create", "platform:admin"]),
};

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

export function permissionsFor(role: Role | null | undefined): Permission[] {
  return role ? [...ROLE_PERMISSIONS[role]] : [];
}
