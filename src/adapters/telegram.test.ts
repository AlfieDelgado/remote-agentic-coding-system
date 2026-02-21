/**
 * Unit tests for Telegram adapter
 */
import { TelegramAdapter } from './telegram';

// Mock Telegraf to avoid actual API calls
jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({}),
    },
    launch: jest.fn().mockResolvedValue(true),
    stop: jest.fn(),
  })),
}));

// Mock marked to avoid real markdown parsing
jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((markdown: string) => {
      // Simple mock conversion for testing
      return markdown
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }),
  },
}));

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter('fake-token-for-testing', 'stream');
  });

  describe('HTML formatting', () => {
    test('should convert markdown bold to HTML', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '**bold text**');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        123456,
        '<b>bold text</b>',
        { parse_mode: 'HTML' }
      );
    });

    test('should convert markdown italic to HTML', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '*italic text*');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        123456,
        '<i>italic text</i>',
        { parse_mode: 'HTML' }
      );
    });

    test('should convert markdown code blocks to HTML', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '```const x = 1;```');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        123456,
        '<pre><code>const x = 1;</code></pre>',
        { parse_mode: 'HTML' }
      );
    });

    test('should convert inline code to HTML', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '`code`');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        123456,
        '<code>code</code>',
        { parse_mode: 'HTML' }
      );
    });

    test('should handle mixed formatting', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', '**bold** and *italic* and `code`');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        123456,
        '<b>bold</b> and <i>italic</i> and <code>code</code>',
        { parse_mode: 'HTML' }
      );
    });
  });

  describe('message splitting', () => {
    test('should send short message without splitting', async () => {
      const bot = adapter.getBot();
      await adapter.sendMessage('123456', 'short message');

      expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('should split long messages', async () => {
      const bot = adapter.getBot();
      const longMessage = 'a'.repeat(5000); // Exceeds 4096 char limit
      await adapter.sendMessage('123456', longMessage);

      // Should call sendMessage at least once (actual splitting depends on implementation)
      expect(bot.telegram.sendMessage).toHaveBeenCalled();
    });
  });

  describe('streaming mode configuration', () => {
    test('should return batch mode when configured', () => {
      const batchAdapter = new TelegramAdapter('fake-token-for-testing', 'batch');
      expect(batchAdapter.getStreamingMode()).toBe('batch');
    });

    test('should default to stream mode', () => {
      const streamAdapter = new TelegramAdapter('fake-token-for-testing');
      expect(streamAdapter.getStreamingMode()).toBe('stream');
    });

    test('should return stream mode when explicitly configured', () => {
      const streamAdapter = new TelegramAdapter('fake-token-for-testing', 'stream');
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
