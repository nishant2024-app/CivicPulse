import type { ComplaintStatus, Role } from "./enums";

/**
 * Complaint state machine. Single source of truth for API enforcement and UI affordances.
 *
 * `relation` narrows who within a role may act:
 *  - "any"      anyone holding the role in the organization (subject to department scope)
 *  - "assignee" only the field worker the complaint is currently assigned to
 *  - "reporter" only the citizen who filed the complaint
 */
export type ActorRelation = "any" | "assignee" | "reporter";

export interface TransitionRule {
  to: ComplaintStatus;
  allowed: ReadonlyArray<{ role: Role; relation: ActorRelation }>;
  /** A note is mandatory, e.g. the reason for rejection. */
  requiresNote?: boolean;
}

const ADMINS = [
  { role: "SUPER_ADMIN", relation: "any" },
  { role: "ORGANIZATION_ADMIN", relation: "any" },
  { role: "DEPARTMENT_MANAGER", relation: "any" },
] as const satisfies TransitionRule["allowed"];

const ASSIGNEE = { role: "FIELD_WORKER", relation: "assignee" } as const;
const REPORTER = { role: "CITIZEN", relation: "reporter" } as const;

export const STATUS_TRANSITIONS: Readonly<Record<ComplaintStatus, readonly TransitionRule[]>> = {
  REPORTED: [
    { to: "VERIFIED", allowed: ADMINS },
    { to: "REJECTED", allowed: ADMINS, requiresNote: true },
  ],
  VERIFIED: [
    // ASSIGNED is entered through the assignment endpoint, which applies this rule.
    { to: "ASSIGNED", allowed: ADMINS },
    { to: "REJECTED", allowed: ADMINS, requiresNote: true },
  ],
  ASSIGNED: [
    { to: "IN_PROGRESS", allowed: [...ADMINS, ASSIGNEE] },
    { to: "ON_HOLD", allowed: [...ADMINS, ASSIGNEE], requiresNote: true },
  ],
  IN_PROGRESS: [
    { to: "ON_HOLD", allowed: [...ADMINS, ASSIGNEE], requiresNote: true },
    { to: "RESOLVED", allowed: [...ADMINS, ASSIGNEE], requiresNote: true },
  ],
  ON_HOLD: [
    { to: "IN_PROGRESS", allowed: [...ADMINS, ASSIGNEE] },
    { to: "ASSIGNED", allowed: ADMINS },
  ],
  RESOLVED: [
    { to: "CLOSED", allowed: [...ADMINS, REPORTER] },
    { to: "REOPENED", allowed: [...ADMINS, REPORTER], requiresNote: true },
  ],
  CLOSED: [{ to: "REOPENED", allowed: [...ADMINS, REPORTER], requiresNote: true }],
  REJECTED: [{ to: "REOPENED", allowed: ADMINS, requiresNote: true }],
  REOPENED: [
    { to: "ASSIGNED", allowed: ADMINS },
    { to: "REJECTED", allowed: ADMINS, requiresNote: true },
  ],
};

/** Statuses in which work is still expected. Used for "open" counts and SLA scans. */
export const OPEN_STATUSES: readonly ComplaintStatus[] = [
  "REPORTED",
  "VERIFIED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "REOPENED",
];

export const TERMINAL_STATUSES: readonly ComplaintStatus[] = ["CLOSED", "REJECTED"];

export function isOpenStatus(status: ComplaintStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export interface TransitionActor {
  role: Role;
  isAssignee: boolean;
  isReporter: boolean;
}

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; reason: "INVALID_TRANSITION" | "NOT_PERMITTED" | "NOTE_REQUIRED" };

export function findTransition(
  from: ComplaintStatus,
  to: ComplaintStatus,
): TransitionRule | undefined {
  return STATUS_TRANSITIONS[from].find((rule) => rule.to === to);
}

function actorMatches(rule: TransitionRule, actor: TransitionActor): boolean {
  return rule.allowed.some((entry) => {
    // A reporter keeps reporter rights whatever their membership role is
    // (a field worker can also file complaints as a member of the community).
    if (entry.relation === "reporter") return actor.isReporter;
    if (entry.role !== actor.role) return false;
    if (entry.relation === "assignee") return actor.isAssignee;
    return true;
  });
}

export function checkTransition(
  from: ComplaintStatus,
  to: ComplaintStatus,
  actor: TransitionActor,
  note?: string | null,
): TransitionCheck {
  const rule = findTransition(from, to);
  if (!rule) return { ok: false, reason: "INVALID_TRANSITION" };
  if (!actorMatches(rule, actor)) return { ok: false, reason: "NOT_PERMITTED" };
  if (rule.requiresNote && !note?.trim()) return { ok: false, reason: "NOTE_REQUIRED" };
  return { ok: true, rule };
}

/** Transitions the actor may perform from `from`; drives the action buttons in the UI. */
export function availableTransitions(
  from: ComplaintStatus,
  actor: TransitionActor,
): TransitionRule[] {
  return STATUS_TRANSITIONS[from].filter((rule) => actorMatches(rule, actor));
}
