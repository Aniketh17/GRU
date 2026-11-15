// Removes build/unit before compiling unit tests (cross-platform, no dependency).
import { rmSync } from "node:fs";
rmSync(new URL("../build/unit", import.meta.url), { recursive: true, force: true });
