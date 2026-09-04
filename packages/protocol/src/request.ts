export interface CommandRequest {
  verb: string;
  args: string[];
  cwd: string;
  env: { noDaemon: boolean };
}
