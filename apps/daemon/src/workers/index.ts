export class BackgroundRegistry {
  private readonly probes = new Map<string, () => boolean>();

  register(name: string, isBusy: () => boolean): () => void {
    this.probes.set(name, isBusy);
    return () => this.probes.delete(name);
  }

  isBusy(): boolean {
    return [...this.probes.values()].some((probe) => probe());
  }
}
