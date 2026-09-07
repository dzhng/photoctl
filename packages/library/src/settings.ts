import {
  PhotoctlError,
  userSettingsSchema,
  type UserSettingKey,
  type UserSettings,
} from "@photoctl/protocol";
import type { LibraryHandle } from "./open.js";

export async function readUserSettings(handle: LibraryHandle): Promise<UserSettings> {
  const result = await handle.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
    [Object.keys(userSettingsSchema.shape)],
  );
  return userSettingsSchema.parse(
    Object.fromEntries(result.rows.map(({ key, value }) => [key, value])),
  );
}

export async function writeUserSetting(
  handle: LibraryHandle,
  key: UserSettingKey,
  value: unknown,
): Promise<UserSettings[UserSettingKey]> {
  const parsed = userSettingsSchema.shape[key].safeParse(value);
  if (!parsed.success) throw new PhotoctlError("usage", `Invalid value for setting ${key}`);
  await handle.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, JSON.stringify(parsed.data)],
  );
  return parsed.data;
}
