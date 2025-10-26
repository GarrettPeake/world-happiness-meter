import { Jetstream } from "@skyware/jetstream";

export interface FirehosePost {
  text: string;
  did: string;
  collection: string;
  rkey: string;
}

export interface FirehoseOptions {
  onPost: (post: FirehosePost) => void | Promise<void>;
  onError?: (error: Error) => void;
  durationMs?: number;
  eventLimit?: number;
}

export async function connectToFirehose(
  options: FirehoseOptions
): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let isClosed = false;

    // Create Jetstream instance
    const jetstream = new Jetstream({
      wantedCollections: ["app.bsky.feed.post"],
      endpoint: "wss://jetstream2.us-east.bsky.network/subscribe",
    });

    let eventCount = 0;

    const cleanup = async () => {
      if (isClosed) return;
      isClosed = true;

      if (timeout) {
        clearTimeout(timeout);
      }

      // Close the Jetstream connection
      jetstream.close();
      resolve();
    };

    // Listen for new posts
    jetstream.onCreate("app.bsky.feed.post", async (event) => {
      try {
        const post: FirehosePost = {
          text: event.commit.record.text,
          did: event.did,
          collection: event.commit.collection,
          rkey: event.commit.rkey,
        };

        eventCount++;
        if (options.eventLimit && eventCount > options.eventLimit) {
          cleanup();
          return;
        }

        await options.onPost(post);
      } catch (err) {
        if (options.onError) {
          options.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    // Handle errors
    jetstream.on("error", (err) => {
      if (options.onError) {
        options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Handle connection open
    jetstream.on("open", () => {
      console.log("Connected to Bluesky firehose via Jetstream");
    });

    // Handle connection close
    jetstream.on("close", () => {
      console.log("Firehose connection closed");
      cleanup();
    });

    // Set timeout if duration specified
    if (options.durationMs) {
      timeout = setTimeout(() => {
        console.log(
          `${options.durationMs! / 1000} seconds elapsed, stopping firehose`
        );
        cleanup();
      }, options.durationMs);
    }

    // Start the Jetstream connection
    jetstream.start();
  });
}
