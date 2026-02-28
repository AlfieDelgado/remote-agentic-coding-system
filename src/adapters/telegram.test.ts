/**
 * Unit tests for Telegram adapter markdown conversion
 */
import { TelegramAdapter } from './telegram';

jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({}),
    },
    launch: jest.fn().mockResolvedValue(true),
    stop: jest.fn(),
  })),
}));

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter('fake-token-for-testing', 'stream');
  });

  describe('sendMessage', () => {
    test('should send message with HTML parse_mode', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '**bold** text');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(123456, '<b>bold</b> text', {
        parse_mode: 'HTML',
      });
    });
  });

  describe('markdownToTelegramHtml', () => {
    describe('code blocks', () => {
      test('should convert code blocks with language', () => {
        expect(adapter.markdownToTelegramHtml('```js\nconst x = 1;\n```')).toBe(
          '<pre><code class="language-js">const x = 1;</code></pre>'
        );
      });

      test('should convert code blocks without language', () => {
        expect(adapter.markdownToTelegramHtml('```\nconst x = 1;\n```')).toBe(
          '<pre><code>const x = 1;</code></pre>'
        );
      });

      test('should preserve code block content with bold inside', () => {
        const input = '```js\n**not bold**\n```';
        const output = adapter.markdownToTelegramHtml(input);
        expect(output).toContain('<pre><code');
        expect(output).toContain('**not bold**');
        expect(output).not.toContain('<b>');
      });
    });

    describe('bold and italic', () => {
      test('should convert bold', () => {
        expect(adapter.markdownToTelegramHtml('**bold text**')).toBe('<b>bold text</b>');
      });

      test('should convert italic with asterisk', () => {
        expect(adapter.markdownToTelegramHtml('*italic text*')).toBe('<i>italic text</i>');
      });

      test('should convert italic with underscore', () => {
        expect(adapter.markdownToTelegramHtml('_italic text_')).toBe('<i>italic text</i>');
      });

      test('should handle mixed bold and italic', () => {
        expect(adapter.markdownToTelegramHtml('**bold** and *italic*')).toBe(
          '<b>bold</b> and <i>italic</i>'
        );
      });
    });

    describe('links', () => {
      test('should convert links to HTML', () => {
        expect(adapter.markdownToTelegramHtml('[click here](https://example.com)')).toBe(
          '<a href="https://example.com">click here</a>'
        );
      });
    });

    describe('headers', () => {
      test('should convert h1', () => {
        expect(adapter.markdownToTelegramHtml('# Header 1')).toBe('<b>Header 1</b>');
      });

      test('should convert h2', () => {
        expect(adapter.markdownToTelegramHtml('## Header 2')).toBe('<b>Header 2</b>');
      });

      test('should convert h3', () => {
        expect(adapter.markdownToTelegramHtml('### Header 3')).toBe('<b>Header 3</b>');
      });
    });

    describe('lists', () => {
      test('should convert unordered list', () => {
        expect(adapter.markdownToTelegramHtml('- item 1\n- item 2')).toBe('• item 1\n• item 2');
      });

      test('should convert ordered list', () => {
        expect(adapter.markdownToTelegramHtml('1. item 1\n2. item 2')).toBe('item 1\n\nitem 2');
      });
    });

    describe('tables', () => {
      test('should convert table to pipe format', () => {
        const input = `| Command | Description |
| --- | --- |
| /clone | Clone repo |`;
        const output = adapter.markdownToTelegramHtml(input);
        expect(output).toContain('Command | Description');
        expect(output).toContain('--- | ---');
        expect(output).toContain('/clone');
        expect(output).toContain('Clone repo');
      });

      test('should handle table with formatting inside', () => {
        const input = `| Command | Description |
| --- | --- |
| \`/clone\` | **Clone** repo |`;
        const output = adapter.markdownToTelegramHtml(input);
        expect(output).toContain('/clone');
        expect(output).toContain('<b>Clone</b>');
      });
    });

    describe('inline code', () => {
      test('should convert inline code', () => {
        expect(adapter.markdownToTelegramHtml('Use `const x = 1`')).toBe(
          'Use <code>const x = 1</code>'
        );
      });

      test('should preserve code content with markdown inside', () => {
        expect(adapter.markdownToTelegramHtml('`not **bold**`')).toBe('<code>not **bold**</code>');
      });
    });

    describe('paragraphs', () => {
      test('should add blank lines between paragraphs', () => {
        const output = adapter.markdownToTelegramHtml('# Header\nSome text');
        expect(output).toBe('<b>Header</b>\n\nSome text');
      });

      test('should NOT add blank lines to list items', () => {
        const output = adapter.markdownToTelegramHtml('- item 1\n- item 2');
        expect(output).toBe('• item 1\n• item 2');
      });

      test('should NOT add blank lines to code blocks', () => {
        const output = adapter.markdownToTelegramHtml('```js\nconst x = 1;\n```');
        expect(output).toBe('<pre><code class="language-js">const x = 1;</code></pre>');
      });
    });

    describe('command help text with angle brackets', () => {
      test('should handle angle brackets in command examples', () => {
        const input = 'Use /command-set <name> <path>';
        const output = adapter.markdownToTelegramHtml(input);
        expect(output).toBe('Use /command-set &lt;name&gt; &lt;path&gt;');
      });
    });
  });

  describe('streaming mode configuration', () => {
    test('should return batch mode when configured', () => {
      const batchAdapter = new TelegramAdapter('fake-token', 'batch');
      expect(batchAdapter.getStreamingMode()).toBe('batch');
    });

    test('should default to stream mode', () => {
      const streamAdapter = new TelegramAdapter('fake-token');
      expect(streamAdapter.getStreamingMode()).toBe('stream');
    });
  });

  describe('bot instance', () => {
    test('should provide access to bot instance', () => {
      const bot = adapter.getBot();
      expect(bot).toBeDefined();
      expect(bot.telegram).toBeDefined();
    });

    test('should return correct platform type', () => {
      expect(adapter.getPlatformType()).toBe('telegram');
    });
  });
});
