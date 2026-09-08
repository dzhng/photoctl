import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { PhotoctlError } from "@photoctl/protocol";

export async function configureInput(args: string[]): Promise<string | undefined> {
  if (args.length === 1 && args[0] === "--key-stdin") {
    let value = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) value += chunk;
    return value;
  }
  if (args.length !== 0) return process.env.AI_GATEWAY_API_KEY;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new PhotoctlError(
      "usage",
      "Use openphoto configure --key-stdin or --from-env when no terminal is attached",
    );
  }
  // Readline owns terminal editing/restoration; its echo goes to a muted stream.
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  try {
    return await new Promise<string>((resolve, reject) => {
      prompt.once("close", () =>
        reject(new PhotoctlError("usage", "Configuration cancelled; no credentials saved")),
      );
      prompt.once("SIGINT", () => prompt.close());
      prompt.question("", resolve);
      process.stderr.write("AI Gateway API key (hidden; saved in ~/.openphoto/.env): ");
    });
  } finally {
    prompt.close();
    output.destroy();
    process.stderr.write("\n");
  }
}
