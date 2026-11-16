import { describe, expect, it } from "vitest";
import { COMPLAINT_STATUSES } from "./enums";
import {
  availableTransitions,
  checkTransition,
  STATUS_TRANSITIONS,
  type TransitionActor,
} from "./complaint-status";

const admin: TransitionActor = { role: "ORGANIZATION_ADMIN", isAssignee: false, isReporter: false };
const assignee: TransitionActor = { role: "FIELD_WORKER", isAssignee: true, isReporter: false };
const otherWorker: TransitionActor = { role: "FIELD_WORKER", isAssignee: false, isReporter: false };
const reporter: TransitionActor = { role: "CITIZEN", isAssignee: false, isReporter: true };
const otherCitizen: TransitionActor = { role: "CITIZEN", isAssignee: false, isReporter: false };

describe("complaint status machine", () => {
  it("defines transitions for every status and only targets known statuses", () => {
    for (const status of COMPLAINT_STATUSES) {
      expect(STATUS_TRANSITIONS[status]).toBeDefined();
      for (const rule of STATUS_TRANSITIONS[status]) {
        expect(COMPLAINT_STATUSES).toContain(rule.to);
        expect(rule.to).not.toBe(status);
      }
    }
  });

  it("allows the happy path for the right actors", () => {
    expect(checkTransition("REPORTED", "VERIFIED", admin).ok).toBe(true);
    expect(checkTransition("VERIFIED", "ASSIGNED", admin).ok).toBe(true);
    expect(checkTransition("ASSIGNED", "IN_PROGRESS", assignee).ok).toBe(true);
    expect(checkTransition("IN_PROGRESS", "RESOLVED", assignee, "Pothole filled").ok).toBe(true);
    expect(checkTransition("RESOLVED", "CLOSED", reporter).ok).toBe(true);
  });

  it("rejects transitions that skip steps", () => {
    expect(checkTransition("REPORTED", "RESOLVED", admin)).toEqual({
      ok: false,
      reason: "INVALID_TRANSITION",
    });
    expect(checkTransition("CLOSED", "IN_PROGRESS", admin)).toEqual({
      ok: false,
      reason: "INVALID_TRANSITION",
    });
  });

  it("does not let citizens triage or workers act on complaints not assigned to them", () => {
    expect(checkTransition("REPORTED", "VERIFIED", reporter)).toEqual({
      ok: false,
      reason: "NOT_PERMITTED",
    });
    expect(checkTransition("ASSIGNED", "IN_PROGRESS", otherWorker)).toEqual({
      ok: false,
      reason: "NOT_PERMITTED",
    });
    expect(checkTransition("RESOLVED", "REOPENED", otherCitizen, "still broken")).toEqual({
      ok: false,
      reason: "NOT_PERMITTED",
    });
  });

  it("requires a note where the rule demands one", () => {
    expect(checkTransition("REPORTED", "REJECTED", admin)).toEqual({
      ok: false,
      reason: "NOTE_REQUIRED",
    });
    expect(checkTransition("REPORTED", "REJECTED", admin, "   ")).toEqual({
      ok: false,
      reason: "NOTE_REQUIRED",
    });
    expect(checkTransition("REPORTED", "REJECTED", admin, "Duplicate").ok).toBe(true);
  });

  it("lets a staff member who filed a complaint keep reporter rights", () => {
    const workerReporter: TransitionActor = {
      role: "FIELD_WORKER",
      isAssignee: false,
      isReporter: true,
    };
    expect(checkTransition("RESOLVED", "REOPENED", workerReporter, "Leak is back").ok).toBe(true);
  });

  it("lists available transitions for the UI", () => {
    expect(availableTransitions("REPORTED", reporter)).toEqual([]);
    expect(availableTransitions("REPORTED", admin).map((r) => r.to)).toEqual([
      "VERIFIED",
      "REJECTED",
    ]);
  });
});
