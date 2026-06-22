// src/utils/RateLimiter.ts
export class RateLimiter {
    // A basic wrapper around Node's native fetch
    public async fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
      return fetch(url, init);
    }
  }
  
  // Exported with the name the API client currently expects
  export const metMuseumRateLimiter = new RateLimiter();