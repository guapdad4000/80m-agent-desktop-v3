import { describe, expect, it } from "vitest";
import type { Message } from "./Messages";
import { mergeMessages } from "./chatAreaUtils";

describe("mergeMessages", () => {
  it("keeps stale overlay replies in chronological position instead of pushing them to the bottom", () => {
    const loaded: Message[] = [
      { id: "db-user-1", role: "user", content: "first prompt", createdAt: 1000 },
      { id: "db-assistant-1", role: "assistant", content: "first reply persisted", createdAt: 1001 },
      { id: "db-user-2", role: "user", content: "second prompt", createdAt: 2000 },
      { id: "db-assistant-2", role: "assistant", content: "second reply", createdAt: 2001 },
    ];
    const staleOverlay: Message[] = [
      { id: "assistant-local-old", role: "assistant", content: "first reply streamed", createdAt: 1001 },
    ];

    expect(mergeMessages(loaded, staleOverlay).map((message) => message.id)).toEqual([
      "db-user-1",
      "db-assistant-1",
      "assistant-local-old",
      "db-user-2",
      "db-assistant-2",
    ]);
  });
});
