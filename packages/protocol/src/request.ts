export interface CommandRequest {
  verb: string;
  args: string[];
  cwd: string;
  env: {
    noDaemon: boolean;
    libraryPath?: string;
    cacheRoot?: string;
    lockBudgetMs?: string;
    pollCeilingMs?: string;
    volumeMap?: string;
    macHelperPath?: string;
    gatewayUrl?: string;
    gatewayApiKey?: string;
  };
}
