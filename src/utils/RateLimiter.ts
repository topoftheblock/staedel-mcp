// src/utils/RateLimiter.ts

/**
 * Serializes outgoing requests with a minimum spacing between them so we don't
 * hammer the Städel API when a tool call fans out into many fetches
 * (e.g. harvesting a page of records, then an image download).
 */
export class RateLimiter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number = 100) {}

  public async fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const runAfter = this.queue;
    let release: () => void;
    this.queue = new Promise(resolve => { release = resolve; });

    await runAfter;
    try {
      return await fetch(url, init);
    } finally {
      setTimeout(release!, this.minIntervalMs);
    }
  }
}

export const staedelRateLimiter = new RateLimiter();
