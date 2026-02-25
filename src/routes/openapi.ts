import { Router } from "express";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const router = Router();

router.get("/openapi.json", (_req, res) => {
  try {
    // In production, openapi.json is at the project root alongside dist/
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const specPath = join(__dirname, "..", "..", "openapi.json");
    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    res.json(spec);
  } catch {
    res.status(404).json({ error: "OpenAPI spec not found" });
  }
});

export default router;
