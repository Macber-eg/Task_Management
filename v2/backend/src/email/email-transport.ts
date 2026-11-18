export type EmailMessage = {
  from: string | undefined;
  to: string;
  subject: string;
  html: string;
};

/**
 * Where rendered mail goes. The SMTP implementation is the default; tests
 * replace it so that no message ever leaves the process.
 */
export abstract class EmailTransport {
  abstract sendMail(message: EmailMessage): Promise<void>;
}
