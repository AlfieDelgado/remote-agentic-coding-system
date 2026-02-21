/**
 * Telegram platform adapter using Telegraf SDK
 * Handles message sending with 4096 character limit splitting
 * Converts markdown to HTML for rich formatting
 */
import { Telegraf, Context } from 'telegraf';
import { IPlatformAdapter } from '../types';
import { marked } from 'marked';

const MAX_LENGTH = 4096;

export class TelegramAdapter implements IPlatformAdapter {
  private bot: Telegraf;
  private streamingMode: 'stream' | 'batch';

  constructor(token: string, mode: 'stream' | 'batch' = 'stream') {
    // Disable handler timeout to support long-running AI operations
    // Default is 90 seconds which is too short for complex coding tasks
    this.bot = new Telegraf(token, {
      handlerTimeout: Infinity,
    });
    this.streamingMode = mode;
    console.log(`[Telegram] Adapter initialized (mode: ${mode}, timeout: disabled, format: HTML)`);
  }

  /**
   * Send a message to a Telegram chat
   * Automatically splits messages longer than 4096 characters
   * Converts markdown to HTML for rich formatting (code blocks, bold, italic)
   */
  async sendMessage(chatId: string, message: string): Promise<void> {
    const id = parseInt(chatId);
    const chunks = this.splitMessage(message);

    for (const chunk of chunks) {
      const htmlMessage = this.markdownToHtml(chunk);
      await this.bot.telegram.sendMessage(id, htmlMessage, {
        parse_mode: 'HTML',
      });
    }
  }

  /**
   * Convert markdown to HTML for Telegram formatting
   * Telegram supports: <b>, <i>, <code>, <pre>, <pre><code>, <a href>
   */
  private markdownToHtml(markdown: string): string {
    try {
      // Configure marked to avoid adding extra formatting that Telegram doesn't support
      const html = marked.parse(markdown, {
        breaks: true, // Convert \n to <br>
        gfm: true, // GitHub Flavored Markdown (code blocks, tables)
      }) as string;

      return html;
    } catch (error) {
      console.warn('[Telegram] Markdown conversion failed, sending plain text:', error);
      return markdown;
    }
  }

  /**
   * Split message into chunks that fit within Telegram's character limit
   * Preserves line boundaries to avoid breaking code blocks
   */
  private splitMessage(message: string): string[] {
    if (message.length <= MAX_LENGTH) {
      return [message];
    }

    const chunks: string[] = [];
    const lines = message.split('\n');
    let chunk = '';

    for (const line of lines) {
      if (chunk.length + line.length + 1 > MAX_LENGTH - 100) {
        if (chunk) chunks.push(chunk);
        chunk = line;
      } else {
        chunk += (chunk ? '\n' : '') + line;
      }
    }

    if (chunk) chunks.push(chunk);
    return chunks;
  }

  /**
   * Get the Telegraf bot instance
   */
  getBot(): Telegraf {
    return this.bot;
  }

  /**
   * Get the configured streaming mode
   */
  getStreamingMode(): 'stream' | 'batch' {
    return this.streamingMode;
  }

  /**
   * Get platform type
   */
  getPlatformType(): string {
    return 'telegram';
  }

  /**
   * Extract conversation ID from Telegram context
   */
  getConversationId(ctx: Context): string {
    if (!ctx.chat) {
      throw new Error('No chat in context');
    }
    return ctx.chat.id.toString();
  }

  /**
   * Start the bot (begins polling)
   */
  async start(): Promise<void> {
    // Drop pending updates on startup to prevent reprocessing messages after container restart
    // This ensures a clean slate - old unprocessed messages won't be handled
    await this.bot.launch({
      dropPendingUpdates: true,
    });
    console.log('[Telegram] Bot started (polling mode, pending updates dropped)');
  }

  /**
   * Stop the bot gracefully
   */
  stop(): void {
    this.bot.stop();
    console.log('[Telegram] Bot stopped');
  }
}
