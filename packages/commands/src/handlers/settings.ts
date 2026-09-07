import { readUserSettings, writeUserSetting, type LibraryHandle } from "@photoctl/library";
import {
  PhotoctlError,
  userSettingKeySchema,
  type Envelope,
  type SettingsData,
} from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";

export async function settingsCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  if (args.length === 1 && args[0] === "--help")
    return {
      schema: 1,
      ok: true,
      warnings: [],
      data: {
        usage: "settings get [key] | settings set <key> <json> | settings reset <key>",
        keys: userSettingKeySchema.options,
        description:
          "Set replaces the whole key, not a nested patch. Quote JSON for your shell; JSON strings need double quotes. Reset restores the user default. Secrets belong in environment variables. Saving configuration makes no immediate download or foreground provider request; existing automatic embedding consent remains effective. Setting embed_mode to auto permits background embedding.",
        examples: [
          "photoctl settings set models_base_url '\"https://models.example.com/pinned/\"'",
          'photoctl settings set models \'{"edit":"openai/gpt-image-2"}\'',
          "photoctl settings reset models_base_url",
        ],
      },
    };
  const { positionals } = parseArguments(args, {});
  const [action, name, json] = positionals;
  if (
    !(action === "get" && positionals.length <= 2) &&
    !(action === "set" && positionals.length === 3) &&
    !(action === "reset" && positionals.length === 2)
  ) {
    throw new PhotoctlError(
      "usage",
      "settings requires get [key], set <key> <json>, or reset <key>",
    );
  }
  const parsedKey = name === undefined ? undefined : userSettingKeySchema.safeParse(name);
  if (parsedKey && !parsedKey.success) throw new PhotoctlError("usage", "Unknown user setting");
  const key = parsedKey?.data;
  let value: unknown;
  if (action === "set") {
    try {
      value = JSON.parse(json!);
    } catch {
      throw new PhotoctlError("usage", "Setting value must be JSON");
    }
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const settings =
      action === "get"
        ? await readUserSettings(lease.handle)
        : { [key!]: await writeUserSetting(lease.handle, key!, value) };
    return {
      schema: 1,
      ok: true,
      data: {
        settings: key === undefined ? settings : { [key]: settings[key] },
      } satisfies SettingsData,
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}
