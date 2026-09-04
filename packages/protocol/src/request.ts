export interface CommandRequest {
  verb: string;
  args: string[];
  cwd: string;
  env: {
    noDaemon: boolean;
    libraryPath?: string;
    cacheRoot?: string;
    lockBudgetMs?: string;
    volumeMap?: string;
  };
}
