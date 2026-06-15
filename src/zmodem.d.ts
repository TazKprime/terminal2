declare module "zmodem.js" {
  export class ZmodemBrowser {
    static sendSuggestion(zsession: any, filename: string, options?: any): void;
    static receive(suggestions: any[], callbacks: {
      on_header?: (header: any) => void;
      on_file_information?: (info: any) => void;
      on_input?: (data: Uint8Array) => void;
      on_confirm?: (msg: string) => Promise<boolean>;
    }): any;
  }

  export class ZmodemSession {
    start(): void;
    send_header(header: any): void;
    send_file_data(data: Uint8Array): void;
    end(): void;
    close(): void;
    get_offset(): number;
    get_file_length(): number;
    get_fname(): string;
  }

  export class ZSentry {
    constructor(callbacks: {
      on_header?: (header: any) => void;
      on_raw?: (data: Uint8Array) => void;
    });
    consume(data: Uint8Array): void;
    consume_suggested_input(data: Uint8Array): void;
  }

  export function strip(data: Uint8Array): Uint8Array;
}
