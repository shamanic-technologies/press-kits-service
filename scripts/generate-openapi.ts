import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../src/schemas.js";
import { writeFileSync } from "fs";

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Press Kits Service",
    description: "API for generating, versioning, and publicly sharing company press kits",
    version: "1.0.0",
  },
  servers: [
    {
      url: process.env.SERVICE_URL ?? "https://press-kits.mcpfactory.org",
    },
  ],
});

// Inject security schemes
const doc = document as Record<string, unknown>;
const components = (doc.components ?? {}) as Record<string, unknown>;
components.securitySchemes = {
  apiKey: {
    type: "apiKey",
    in: "header",
    name: "X-API-Key",
  },
};
doc.components = components;
doc.security = [{ apiKey: [] }];

writeFileSync("openapi.json", JSON.stringify(document, null, 2));
console.log("OpenAPI spec generated: openapi.json");
