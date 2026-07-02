import { describe, it, expect } from "vitest";
import { buildCeleryMessage, parseCeleryBody, pyRepr } from "./celery-message";

describe("buildCeleryMessage — Celery protocol v2", () => {
  const msg = buildCeleryMessage(
    "plane.bgtasks.issue_activities_task.issue_activity",
    {
      type: "issue.activity.created",
      requested_data: '{"name": "Test"}',
      actor_id: "u1",
      issue_id: "i1",
      project_id: "p1",
      current_instance: null,
      epoch: 1719900000,
      notification: true,
    },
    { id: "11111111-1111-1111-1111-111111111111", origin: "gen1@test" },
  );

  it("puts the task name in the header, not the body", () => {
    expect(msg.properties.headers.task).toBe("plane.bgtasks.issue_activities_task.issue_activity");
    const parsed = JSON.parse(msg.body.toString("utf-8"));
    expect(parsed).toHaveLength(3);
  });

  it("body is the [args, kwargs, embed] 3-tuple with empty args and no-chain embed", () => {
    const [args, kwargs, embed] = JSON.parse(msg.body.toString("utf-8"));
    expect(args).toEqual([]);
    expect(kwargs.type).toBe("issue.activity.created");
    expect(kwargs.notification).toBe(true);
    expect(kwargs.current_instance).toBeNull();
    expect(embed).toEqual({ callbacks: null, errbacks: null, chain: null, chord: null });
  });

  it("sets id == root_id == correlationId and json content headers", () => {
    expect(msg.properties.correlationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(msg.properties.headers.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(msg.properties.headers.root_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(msg.properties.contentType).toBe("application/json");
    expect(msg.properties.contentEncoding).toBe("utf-8");
    expect(msg.properties.deliveryMode).toBe(2);
    expect(msg.properties.headers.lang).toBe("py");
    expect(msg.properties.headers.ignore_result).toBe(true);
  });

  it("kwargsrepr uses Python repr (True/None/single-quotes)", () => {
    expect(msg.properties.headers.kwargsrepr).toContain("'type': 'issue.activity.created'");
    expect(msg.properties.headers.kwargsrepr).toContain("'notification': True");
    expect(msg.properties.headers.kwargsrepr).toContain("'current_instance': None");
    expect(msg.properties.headers.argsrepr).toBe("()");
  });

  it("round-trips through parseCeleryBody", () => {
    const { args, kwargs } = parseCeleryBody(msg.body);
    expect(args).toEqual([]);
    expect(kwargs.issue_id).toBe("i1");
  });

  it("generates a uuid id + host origin when not provided", () => {
    const m = buildCeleryMessage("t", {});
    expect(m.properties.headers.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(m.properties.headers.origin)).toMatch(/^gen1@/);
  });
});

describe("pyRepr", () => {
  it("renders Python literals", () => {
    expect(pyRepr(null)).toBe("None");
    expect(pyRepr(true)).toBe("True");
    expect(pyRepr(false)).toBe("False");
    expect(pyRepr(42)).toBe("42");
    expect(pyRepr("hi")).toBe("'hi'");
    expect(pyRepr(["a", 1, null])).toBe("['a', 1, None]");
    expect(pyRepr({ k: "v", n: 2 })).toBe("{'k': 'v', 'n': 2}");
  });
});
