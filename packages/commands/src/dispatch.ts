import { PhotoctlError, type CommandRequest, type Envelope } from "@photoctl/protocol";
export interface DispatchContext {
  version: string;
}
export async function dispatch(
  request: CommandRequest,
  context: DispatchContext,
): Promise<Envelope> {
  try {
    if (request.verb === "version")
      return { schema: 1, ok: true, data: { version: context.version }, warnings: [] };
    throw new PhotoctlError("usage", `Unknown command: ${request.verb}`);
  } catch (error) {
    if (error instanceof PhotoctlError)
      return {
        schema: 1,
        ok: false,
        code: error.code,
        data: error.data ?? { message: error.message },
      };
    throw error;
  }
}
