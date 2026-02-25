import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

const app = createTestApp();

describe("Health", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "press-kits-service" });
  });

  it("requires no auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});
