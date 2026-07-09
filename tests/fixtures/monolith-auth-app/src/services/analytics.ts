/**
 * UNRELATED to the auth flow (structurally).
 *
 * An in-process analytics/event aggregation service. It is imported by
 * `index.ts` for request tracking, but it imports NOTHING from the auth chain.
 * A pruner focused on "Fix JWT verification" should not need to keep this
 * module's internals — it is not part of the JWT dependency graph.
 */

export interface AnalyticsEvent {
  name: string;
  timestamp: number;
  properties: Record<string, unknown>;
}

interface Bucket {
  count: number;
  lastSeen: number;
  samples: AnalyticsEvent[];
}

const MAX_SAMPLES_PER_BUCKET = 25;

class AnalyticsEngine {
  private buckets = new Map<string, Bucket>();
  private subscribers: Array<(event: AnalyticsEvent) => void> = [];

  track(name: string, properties: Record<string, unknown> = {}): void {
    const event: AnalyticsEvent = { name, timestamp: Date.now(), properties };
    const bucket = this.buckets.get(name) ?? { count: 0, lastSeen: 0, samples: [] };

    bucket.count += 1;
    bucket.lastSeen = event.timestamp;
    bucket.samples.push(event);
    if (bucket.samples.length > MAX_SAMPLES_PER_BUCKET) {
      bucket.samples.shift();
    }

    this.buckets.set(name, bucket);
    this.notify(event);
  }

  subscribe(handler: (event: AnalyticsEvent) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      this.subscribers = this.subscribers.filter((h) => h !== handler);
    };
  }

  summarize(): Record<string, { count: number; lastSeen: number }> {
    const summary: Record<string, { count: number; lastSeen: number }> = {};
    for (const [name, bucket] of this.buckets.entries()) {
      summary[name] = { count: bucket.count, lastSeen: bucket.lastSeen };
    }
    return summary;
  }

  percentileLatency(name: string, percentile: number): number {
    const bucket = this.buckets.get(name);
    if (!bucket || bucket.samples.length === 0) return 0;

    const latencies = bucket.samples
      .map((e) => Number(e.properties.latencyMs ?? 0))
      .sort((a, b) => a - b);

    const index = Math.min(
      latencies.length - 1,
      Math.floor((percentile / 100) * latencies.length)
    );
    return latencies[index];
  }

  private notify(event: AnalyticsEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Swallow subscriber errors so tracking never breaks the request path.
      }
    }
  }
}

export const analytics = new AnalyticsEngine();
