/**
 * Telegram platform adapter using Telegraf SDK
 * Handles message sending with 4096 character limit splitting
 * Converts markdown to Telegram-compatible HTML using custom regex converter
 */
import { Telegraf, Context } from 'telegraf';
import { IPlatformAdapter } from '../types';

const MAX_LENGTH = 4096;

interface CodePlaceholder {
  id: string;
  content: string;
}

export class TelegramAdapter implements IPlatformAdapter {
  private bot: Telegraf;
  private streamingMode: 'stream' | 'batch';

  constructor(token: string, mode: 'stream' | 'batch' = 'stream') {
    this.bot = new Telegraf(token, {
      handlerTimeout: Infinity,
    });
    this.streamingMode = mode;
    console.log(`[Telegram] Adapter initialized (mode: ${mode}, timeout: disabled, format: HTML)`);
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    const id = parseInt(chatId);
    const chunks = this.splitMessage(message);

    for (const chunk of chunks) {
      const htmlMessage = this.markdownToTelegramHtml(chunk);
      await this.bot.telegram.sendMessage(id, htmlMessage, {
        parse_mode: 'HTML',
      });
    }
  }

  /**
   * Custom regex-based markdown to Telegram HTML converter
   * Priority: code blocks > bold/italic > links > headers > lists > tables
   */
  public markdownToTelegramHtml(markdown: string): string {
    try {
      const placeholders: CodePlaceholder[] = [];

      let text = this.protectCodeBlocks(markdown, placeholders);
      text = this.protectInlineCode(text, placeholders);

      text = this.convertLinks(text);
      text = this.convertBold(text);
      text = this.convertItalic(text);
      text = this.convertHeaders(text);
      text = this.convertLists(text);
      text = this.convertTables(text);

      text = this.restoreCodePlaceholders(text, placeholders);

      text = this.escapeAngleBrackets(text);

      text = this.addParagraphSeparators(text);

      return text;
    } catch (error) {
      console.warn('[Telegram] Markdown conversion failed, sending plain text:', error);
      return markdown;
    }
  }

  /**
   * Add \n\n between paragraphs (non-header, non-list, non-code content)
   */
  private addParagraphSeparators(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let lastWasContent = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const isHeader = trimmed.startsWith('<b>') && !trimmed.startsWith('<pre>');

      if (
        trimmed === '' ||
        trimmed.startsWith('<pre>') ||
        trimmed.startsWith('<code') ||
        trimmed.startsWith('•') ||
        trimmed.startsWith('|') ||
        trimmed.startsWith('<a ')
      ) {
        if (trimmed === '' && lastWasContent) {
          result.push('');
        }
        result.push(line);
        lastWasContent = false;
      } else if (isHeader) {
        result.push(line);
        if (i < lines.length - 1) {
          const nextTrimmed = lines[i + 1].trim();
          if (nextTrimmed !== '' && !nextTrimmed.startsWith('<b>')) {
            result.push('');
          }
        }
        lastWasContent = true;
      } else {
        result.push(line);
        if (i < lines.length - 1) {
          const nextTrimmed = lines[i + 1].trim();
          if (
            nextTrimmed !== '' &&
            !nextTrimmed.startsWith('<b>') &&
            !nextTrimmed.startsWith('<pre>') &&
            !nextTrimmed.startsWith('<code') &&
            !nextTrimmed.startsWith('•') &&
            !nextTrimmed.startsWith('|')
          ) {
            result.push('');
          }
        }
        lastWasContent = true;
      }
    }

    return result.join('\n');
  }

  /**
   * Escape angle brackets that aren't part of supported HTML tags
   */
  private escapeAngleBrackets(text: string): string {
    const supportedTags = ['b', 'i', 'code', 'pre', 'a', 'strong', 'em'];

    let result = text;

    result = result.replace(/<([a-zA-Z][a-zA-Z0-9]*)/g, (match, tag) => {
      if (supportedTags.includes(tag.toLowerCase())) {
        return match;
      }
      return `&lt;${tag}`;
    });

    result = result.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)/g, (match, tag) => {
      if (supportedTags.includes(tag.toLowerCase())) {
        return match;
      }
      return `&lt;/${tag}`;
    });

    result = result.replace(/([a-zA-Z0-9]+)>/g, (match, tag) => {
      if (supportedTags.includes(tag.toLowerCase())) {
        return match;
      }
      return `${tag}&gt;`;
    });

    return result;
  }

  /**
   * Protect code blocks with placeholders to prevent nested processing
   */
  private protectCodeBlocks(markdown: string, placeholders: CodePlaceholder[]): string {
    const placeholder = `PLACEHOLDERCD${placeholders.length}`;
    let result = markdown;
    let count = 0;

    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = `${placeholder}${count}`;
      const langClass = lang ? ` class="language-${lang}"` : '';
      placeholders.push({
        id,
        content: `<pre><code${langClass}>${code.trim()}</code></pre>`,
      });
      count++;
      return id;
    });

    count = 0;
    result = result.replace(/```\n([\s\S]*?)```/g, (_, code) => {
      const id = `${placeholder}${count}`;
      placeholders.push({
        id,
        content: `<pre><code>${code.trim()}</code></pre>`,
      });
      count++;
      return id;
    });

    return result;
  }

  /**
   * Protect inline code with placeholders
   */
  private protectInlineCode(markdown: string, placeholders: CodePlaceholder[]): string {
    const placeholder = `PLACEHOLDERIN`;
    let result = markdown;
    let count = 0;

    result = result.replace(/`([^`]+)`/g, (_, code) => {
      const id = `${placeholder}${count}`;
      placeholders.push({
        id,
        content: `<code>${code}</code>`,
      });
      count++;
      return id;
    });

    return result;
  }

  /**
   * Convert markdown links to HTML
   */
  private convertLinks(text: string): string {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      return `<a href="${url}">${label}</a>`;
    });
  }

  /**
   * Convert markdown bold to HTML
   */
  private convertBold(text: string): string {
    return text.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
      return `<b>${content}</b>`;
    });
  }

  /**
   * Convert markdown italic to HTML
   * Supports both *text* and _text_ formats
   */
  private convertItalic(text: string): string {
    return text
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, content) => {
        return `<i>${content}</i>`;
      })
      .replace(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/g, (_, content) => {
        return `<i>${content}</i>`;
      });
  }

  /**
   * Convert markdown headers to bold HTML
   */
  private convertHeaders(text: string): string {
    return text
      .replace(/^### (.+)$/gm, '<b>$1</b>')
      .replace(/^## (.+)$/gm, '<b>$1</b>')
      .replace(/^# (.+)$/gm, '<b>$1</b>');
  }

  /**
   * Convert markdown lists to plain text bullets
   * Unordered: - item → • item
   * Ordered: 1. item → 1. item
   */
  private convertLists(text: string): string {
    let result = text.replace(/^[\-\*] (.+)$/gm, '• $1').replace(/^\d+\. (.+)$/gm, '$1');
    return result;
  }

  /**
   * Convert markdown tables to pipe format plain text
   */
  private convertTables(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inTable = false;
    let tableLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableLines = [];
        }
        const trimmed = line.trim();
        if (trimmed.match(/^\|[\s\-:|]+\|$/)) {
          continue;
        }
        tableLines.push(trimmed);
      } else {
        if (inTable && tableLines.length > 0) {
          const formatted = this.formatTable(tableLines);
          result.push(...formatted);
          tableLines = [];
        }
        inTable = false;
        if (line.trim()) {
          result.push(line);
        }
      }
    }

    if (inTable && tableLines.length > 0) {
      const formatted = this.formatTable(tableLines);
      result.push(...formatted);
    }

    return result.join('\n');
  }

  /**
   * Format table rows to pipe format
   */
  private formatTable(rows: string[]): string[] {
    if (rows.length === 0) return [];

    const colWidths: number[] = [];

    const parsedRows = rows.map(row => {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());
      cells.forEach((cell, i) => {
        colWidths[i] = Math.max(colWidths[i] || 0, cell.length);
      });
      return cells;
    });

    const formatted = parsedRows.map(cells => {
      return cells.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ');
    });

    const _separator = colWidths.map(w => '-'.repeat(w)).join(' | ');

    const result: string[] = [formatted[0], _separator];
    result.push(...formatted.slice(1));

    return result;
  }

  /**
   * Restore code placeholders with actual HTML
   */
  private restoreCodePlaceholders(text: string, placeholders: CodePlaceholder[]): string {
    let result = text;
    for (const p of placeholders) {
      result = result.replace(p.id, p.content);
    }
    return result;
  }

  /**
   * Split message into chunks that fit within Telegram's character limit
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
