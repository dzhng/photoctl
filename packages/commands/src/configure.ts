import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";

function credentialsPath(): string {
  return join(homedir(), ".openphoto", ".env");
}

async function readCredentials(): Promise<string> {
  try {
    return await readFile(credentialsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new PhotoctlError("usage", "Cannot read ~/.openphoto/.env; check its permissions");
  }
}

export async function savedGatewayKey(): Promise<string | undefined> {
  return parseEnv(await readCredentials()).AI_GATEWAY_API_KEY;
}

export async function configureCommand(args: string[], key?: string): Promise<Envelope> {
  if (args.length === 1 && args[0] === "--help") {
    return {
      schema: 1,
      ok: true,
      warnings: [],
      data: {
        usage: "openphoto configure [--key-stdin | --from-env]",
        description:
          "Save AI_GATEWAY_API_KEY in ~/.openphoto/.env. With no flags, prompts without echoing the key. --key-stdin reads a key from standard input; --from-env saves the current environment key. No network request is made. Environment values override saved credentials.",
      },
    };
  }
  if (args.length > 1 || (args.length === 1 && !["--key-stdin", "--from-env"].includes(args[0]))) {
    throw new PhotoctlError(
      "usage",
      "Use openphoto configure, --key-stdin, or --from-env; never pass a key as an argument",
    );
  }
  const value = key?.trim();
  if (!value || /[\r\n\0]/u.test(value)) {
    throw new PhotoctlError("usage", "Provide a nonempty, single-line AI Gateway API key");
  }
  const values = { ...parseEnv(await readCredentials()), AI_GATEWAY_API_KEY: value };
  const contents = Object.entries(values)
    .map(([name, value]) => {
      const encoded = [
        value,
        `'${value}'`,
        `\`${value}\``,
        `"${value}"`,
        JSON.stringify(value),
      ].find((candidate) => parseEnv(`${name}=${candidate}`)[name] === value);
      if (encoded === undefined)
        throw new PhotoctlError(
          "usage",
          "Cannot preserve a dotenv value; edit ~/.openphoto/.env manually",
        );
      return `${name}=${encoded}\n`;
    })
    .join("");
  const directory = join(homedir(), ".openphoto");
  const temporary = join(directory, `.env-${randomUUID()}`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, credentialsPath());
  } catch {
    throw new PhotoctlError(
      "usage",
      "Cannot save ~/.openphoto/.env; check its directory permissions",
    );
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return {
    schema: 1,
    ok: true,
    warnings: [],
    data: { configured: true, path: credentialsPath(), key: "AI_GATEWAY_API_KEY" },
  };
}
