import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export function reserveSecretEnvFile(filePath) {
  const outputPath = resolve(filePath);
  const fd = openSync(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  let open = true;
  let complete = false;

  return {
    path: outputPath,
    write(name, value) {
      if (!open || complete) throw new Error("Secret output reservation is no longer writable");
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Invalid environment variable name");
      if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
        throw new Error("Invalid environment variable value");
      }

      try {
        writeFileSync(fd, `${name}=${value}\n`, "utf8");
        fsyncSync(fd);
        closeSync(fd);
        open = false;
        complete = true;
      } catch (error) {
        if (open) closeSync(fd);
        open = false;
        unlinkSync(outputPath);
        complete = true;
        throw error;
      }
    },
    abort() {
      if (complete) return;
      if (open) closeSync(fd);
      open = false;
      unlinkSync(outputPath);
    },
  };
}
