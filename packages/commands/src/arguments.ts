import { PhotoctlError } from "@photoctl/protocol";

export interface ArgumentSpec {
  flags?: readonly string[];
  options?: readonly string[];
  repeatableOptions?: readonly string[];
}

export interface ParsedArguments {
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string>;
  optionValues: Map<string, string[]>;
}

export function parseArguments(args: string[], spec: ArgumentSpec): ParsedArguments {
  const allowedFlags = new Set(spec.flags ?? []);
  const allowedOptions = new Set(spec.options ?? []);
  const repeatableOptions = new Set(spec.repeatableOptions ?? []);
  const parsed: ParsedArguments = {
    positionals: [],
    flags: new Set(),
    options: new Map(),
    optionValues: new Map(),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      parsed.positionals.push(argument);
      continue;
    }
    if (allowedFlags.has(argument)) {
      if (parsed.flags.has(argument)) duplicate(argument);
      parsed.flags.add(argument);
      continue;
    }
    if (allowedOptions.has(argument) || repeatableOptions.has(argument)) {
      if (parsed.options.has(argument) && !repeatableOptions.has(argument)) duplicate(argument);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new PhotoctlError("usage", `${argument} requires a value`);
      }
      parsed.options.set(argument, value);
      parsed.optionValues.set(argument, [...(parsed.optionValues.get(argument) ?? []), value]);
      index += 1;
      continue;
    }
    throw new PhotoctlError("usage", `Unexpected argument: ${argument}`);
  }

  return parsed;
}

function duplicate(name: string): never {
  throw new PhotoctlError("usage", `Duplicate option: ${name}`);
}
