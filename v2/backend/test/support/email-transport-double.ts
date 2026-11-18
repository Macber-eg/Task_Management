import {
  type EmailMessage,
  EmailTransport,
} from "../../src/email/email-transport";

/**
 * Keeps every email a test app "sends", so tests can read codes and links
 * and no message ever reaches a real SMTP server.
 */
export class EmailTransportDouble extends EmailTransport {
  readonly sent: EmailMessage[] = [];
  /** Set to make the next deliveries fail like an unreachable relay. */
  failWith: Error | null = null;

  async sendMail(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }

  to(address: string): EmailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }

  last(): EmailMessage | undefined {
    return this.sent.at(-1);
  }

  clear(): void {
    this.sent.length = 0;
    this.failWith = null;
  }
}
