/*
 * 中文导读：共享基础能力：zeptomail.d.ts。相关类型、配置或辅助实现集中在本文件。
 */
declare module "zeptomail" {
  interface EmailAddress {
    address: string;
    name?: string;
  }

  interface SendMailInput {
    from: EmailAddress;
    to: Array<{
      email_address: EmailAddress;
    }>;
    subject: string;
    htmlbody?: string;
    textbody?: string;
  }

  export class SendMailClient {
    constructor(options: { url: string; token: string });
    sendMail(input: SendMailInput): Promise<unknown>;
  }
}
