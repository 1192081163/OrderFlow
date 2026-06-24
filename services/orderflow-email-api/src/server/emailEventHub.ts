import type { ServerResponse } from "node:http";

import type { EmailMessageSummary } from "../shared/types.js";

export interface EmailNewMessagesEvent {
  email: string;
  days: number;
  messages: EmailMessageSummary[];
}

export class EmailEventHub {
  private readonly clients = new Set<ServerResponse>();

  subscribe(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");

    this.clients.add(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  broadcastNewMessages(event: EmailNewMessagesEvent): void {
    this.broadcast("new-messages", event);
  }

  private broadcast(eventName: string, payload: unknown): void {
    const text = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      client.write(text);
    }
  }
}
