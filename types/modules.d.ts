// Type declarations for modules without TypeScript definitions

declare module 'connect-sqlite3' {
  import session from 'express-session';

  interface SQLiteStoreOptions {
    db?: string;
    dir?: string;
    table?: string;
    concurrentDB?: boolean;
  }

  function connectSqlite3(session: typeof import('express-session')): {
    new (options?: SQLiteStoreOptions): session.Store;
  };

  export = connectSqlite3;
}

declare module 'node-telegram-bot-api' {
  interface TelegramBotOptions {
    polling?: boolean | {
      interval?: number;
      autoStart?: boolean;
      params?: {
        timeout?: number;
      };
    };
    webHook?: boolean | {
      port?: number;
      host?: string;
      key?: string;
      cert?: string;
    };
    onlyFirstMatch?: boolean;
    request?: object;
    baseApiUrl?: string;
    filepath?: boolean;
  }

  interface Message {
    message_id: number;
    from?: User;
    date: number;
    chat: Chat;
    text?: string;
    document?: Document;
    photo?: PhotoSize[];
  }

  interface User {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  }

  interface Chat {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  }

  interface Document {
    file_id: string;
    file_unique_id: string;
    thumb?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  }

  interface PhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }

  interface SendMessageOptions {
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    reply_to_message_id?: number;
  }

  interface SendDocumentOptions extends SendMessageOptions {
    caption?: string;
    thumb?: string | Buffer;
  }

  class TelegramBot {
    constructor(token: string, options?: TelegramBotOptions);
    sendMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<Message>;
    sendDocument(chatId: number | string, doc: string | Buffer, options?: SendDocumentOptions, fileOptions?: object): Promise<Message>;
    sendPhoto(chatId: number | string, photo: string | Buffer, options?: SendMessageOptions): Promise<Message>;
    on(event: string, callback: (msg: Message) => void): void;
    onText(regexp: RegExp, callback: (msg: Message, match: RegExpExecArray | null) => void): void;
  }

  namespace TelegramBot {
    export { Message, User, Chat, Document, PhotoSize, TelegramBotOptions, SendMessageOptions, SendDocumentOptions };
  }

  export = TelegramBot;
}
