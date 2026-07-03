import { describe, it, expect, vi } from "vitest";
import { ProcessLogsHandler } from "./telemetry.handlers";
import type { TelemetryRepository } from "./telemetry.repository";

describe("ProcessLogsHandler", () => {
  it("persists the api log when log_data is present", async () => {
    const insertApiLog = vi.fn().mockResolvedValue(undefined);
    const handler = new ProcessLogsHandler({ insertApiLog } as unknown as TelemetryRepository);
    await handler.run({ log_data: { path: "/api/v1/issues", method: "GET", response_code: 200 } });
    expect(insertApiLog).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/issues", method: "GET" }));
  });

  it("no-ops on empty log_data", async () => {
    const insertApiLog = vi.fn();
    const handler = new ProcessLogsHandler({ insertApiLog } as unknown as TelemetryRepository);
    await handler.run({});
    expect(insertApiLog).not.toHaveBeenCalled();
  });
});
