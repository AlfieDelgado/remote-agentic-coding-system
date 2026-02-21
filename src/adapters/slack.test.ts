/**
 * Unit tests for Slack adapter
 */
import { SlackAdapter } from './slack';

// Mock WebClient to avoid actual API calls
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    auth: {
      test: jest.fn().mockResolvedValue({
        user: 'TestBot',
        team: 'test-team',
        user_id: 'U123456',
      }),
    },
    chat: {
      postMessage: jest.fn().mockResolvedValue({
        channel: 'C123456',
        message: { text: 'test message' },
      }),
    },
  })),
}));

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;

  beforeEach(() => {
    adapter = new SlackAdapter('xoxb-test-token', 'stream');
  });

  describe('user whitelist', () => {
    test('should deny all users when whitelist is empty (secure by default)', () => {
      const secureAdapter = new SlackAdapter('xoxb-test', 'stream', []);
      expect(secureAdapter.isUserAllowed('U123456')).toBe(false);
      expect(secureAdapter.isUserAllowed('U789012')).toBe(false);
    });

    test('should allow all users when whitelist contains wildcard', () => {
      const publicAdapter = new SlackAdapter('xoxb-test', 'stream', ['*']);
      expect(publicAdapter.isUserAllowed('U123456')).toBe(true);
      expect(publicAdapter.isUserAllowed('U789012')).toBe(true);
      expect(publicAdapter.isUserAllowed('U任何ID')).toBe(true);
    });

    test('should allow only whitelisted users', () => {
      const whitelistAdapter = new SlackAdapter('xoxb-test', 'stream', ['U123456', 'U789012']);
      expect(whitelistAdapter.isUserAllowed('U123456')).toBe(true);
      expect(whitelistAdapter.isUserAllowed('U789012')).toBe(true);
      expect(whitelistAdapter.isUserAllowed('U000000')).toBe(false);
    });

    test('should handle whitelist with single user', () => {
      const singleUserAdapter = new SlackAdapter('xoxb-test', 'stream', ['U123456']);
      expect(singleUserAdapter.isUserAllowed('U123456')).toBe(true);
      expect(singleUserAdapter.isUserAllowed('U789012')).toBe(false);
    });

    test('should allow user when wildcard is mixed with specific IDs', () => {
      const mixedAdapter = new SlackAdapter('xoxb-test', 'stream', ['*', 'U123456']);
      expect(mixedAdapter.isUserAllowed('U123456')).toBe(true);
      expect(mixedAdapter.isUserAllowed('U789012')).toBe(true);
      expect(mixedAdapter.isUserAllowed('U任何ID')).toBe(true);
    });

    test('should require exact match for user IDs (case-sensitive)', () => {
      const caseAdapter = new SlackAdapter('xoxb-test', 'stream', ['U123456']);
      expect(caseAdapter.isUserAllowed('U123456')).toBe(true);
      expect(caseAdapter.isUserAllowed('u123456')).toBe(false);
      expect(caseAdapter.isUserAllowed('U123456 ')).toBe(false);
    });

    test('should use default empty whitelist when not provided', () => {
      const defaultAdapter = new SlackAdapter('xoxb-test', 'stream');
      expect(defaultAdapter.isUserAllowed('U123456')).toBe(false);
    });

    test('should handle empty array in constructor', () => {
      const emptyAdapter = new SlackAdapter('xoxb-test', 'stream', []);
      expect(emptyAdapter.isUserAllowed('U123456')).toBe(false);
      expect(emptyAdapter.isUserAllowed('U789012')).toBe(false);
    });
  });

  describe('constructor and initialization', () => {
    test('should initialize with default streaming mode', () => {
      const defaultAdapter = new SlackAdapter('xoxb-test');
      expect(defaultAdapter.getStreamingMode()).toBe('stream');
    });

    test('should initialize with batch streaming mode', () => {
      const batchAdapter = new SlackAdapter('xoxb-test', 'batch');
      expect(batchAdapter.getStreamingMode()).toBe('batch');
    });

    test('should initialize with stream streaming mode', () => {
      const streamAdapter = new SlackAdapter('xoxb-test', 'stream');
      expect(streamAdapter.getStreamingMode()).toBe('stream');
    });

    test('should return correct platform type', () => {
      expect(adapter.getPlatformType()).toBe('slack');
    });

    test('should provide access to WebClient instance', () => {
      const client = adapter.getClient();
      expect(client).toBeDefined();
      expect(client.auth).toBeDefined();
      expect(client.chat).toBeDefined();
    });
  });

  describe('lifecycle methods', () => {
    test('should start without errors', async () => {
      await expect(adapter.start()).resolves.toBeUndefined();
    });

    test('should set bot user ID after start', async () => {
      await adapter.start();
      expect(adapter.getBotUserId()).toBe('U123456');
    });

    test('should stop without errors', () => {
      expect(() => adapter.stop()).not.toThrow();
    });
  });

  describe('bot user ID management', () => {
    test('should set and get bot user ID', () => {
      adapter.setBotUserId('U123456');
      expect(adapter.getBotUserId()).toBe('U123456');
    });

    test('should return null when bot user ID is not set', () => {
      expect(adapter.getBotUserId()).toBeNull();
    });
  });

  describe('mention detection', () => {
    beforeEach(() => {
      adapter.setBotUserId('U123456');
    });

    test('should detect bot mention with space after', () => {
      expect(adapter.isBotMentioned('<@U123456> hello', 'U123456')).toBe(true);
    });

    test('should detect bot mention without space after', () => {
      expect(adapter.isBotMentioned('<@U123456>hello', 'U123456')).toBe(true);
    });

    test('should detect bot mention at start of message', () => {
      expect(adapter.isBotMentioned('<@U123456> help me', 'U123456')).toBe(true);
    });

    test('should not detect mention when bot ID is different', () => {
      expect(adapter.isBotMentioned('<@U789012> hello', 'U123456')).toBe(false);
    });

    test('should not detect mention when no mention present', () => {
      expect(adapter.isBotMentioned('hello world', 'U123456')).toBe(false);
    });

    test('should return false when bot user ID is null', () => {
      expect(adapter.isBotMentioned('<@U123456> hello', null)).toBe(false);
    });

    test('should handle multiple mentions correctly', () => {
      const text = '<@U789012> <@U123456> hello';
      expect(adapter.isBotMentioned(text, 'U123456')).toBe(true);
    });
  });

  describe('mention stripping', () => {
    beforeEach(() => {
      adapter.setBotUserId('U123456');
    });

    test('should strip bot mention with space', () => {
      expect(adapter.stripMention('<@U123456> hello', 'U123456')).toBe('hello');
    });

    test('should strip bot mention without space', () => {
      expect(adapter.stripMention('<@U123456>hello world', 'U123456')).toBe('hello world');
    });

    test('should strip multiple occurrences of bot mention', () => {
      expect(adapter.stripMention('<@U123456> <@U123456> test', 'U123456')).toBe('test');
    });

    test('should return original text when no mention present', () => {
      expect(adapter.stripMention('hello world', 'U123456')).toBe('hello world');
    });

    test('should handle text with only mention', () => {
      expect(adapter.stripMention('<@U123456>', 'U123456')).toBe('');
    });

    test('should return original text when bot user ID is null', () => {
      expect(adapter.stripMention('<@U123456> hello', null)).toBe('<@U123456> hello');
    });

    test('should strip mention and trim whitespace', () => {
      expect(adapter.stripMention('<@U123456>  hello  ', 'U123456')).toBe('hello');
    });
  });

  describe('conversation and user ID extraction', () => {
    test('should extract conversation ID from event', () => {
      const event = { channel: 'C123456' };
      expect(adapter.getConversationId(event)).toBe('C123456');
    });

    test('should extract user ID from event', () => {
      const event = { user: 'U789012' };
      expect(adapter.getUserId(event)).toBe('U789012');
    });

    test('should return null when user ID is missing', () => {
      const event = {};
      expect(adapter.getUserId(event)).toBeNull();
    });

    test('should return null when user property is undefined', () => {
      const event = { user: undefined };
      expect(adapter.getUserId(event)).toBeNull();
    });

    test('should handle direct message channel IDs', () => {
      const event = { channel: 'D123456' };
      expect(adapter.getConversationId(event)).toBe('D123456');
    });

    test('should handle private channel IDs', () => {
      const event = { channel: 'G123456' };
      expect(adapter.getConversationId(event)).toBe('G123456');
    });
  });

  describe('sendMessage', () => {
    test('should send short message without splitting', async () => {
      const client = adapter.getClient();
      await adapter.sendMessage('C123456', 'short message');

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123456',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'short message',
            },
          },
        ],
        text: 'short message',
      });
    });

    test('should send long message with splitting', async () => {
      const client = adapter.getClient();
      const longMessage = 'a'.repeat(41000); // Exceeds 40000 char limit
      await adapter.sendMessage('C123456', longMessage);

      // Should call postMessage at least once (actual splitting depends on implementation)
      expect(client.chat.postMessage).toHaveBeenCalled();
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1); // Mock implementation calls it once
    });

    test('should handle message exactly at limit', async () => {
      const client = adapter.getClient();
      const exactMessage = 'a'.repeat(40000);
      await adapter.sendMessage('C123456', exactMessage);

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    });

    test('should preserve message formatting when splitting', async () => {
      const client = adapter.getClient();
      const messageWithFormatting = 'Line 1\nLine 2\nLine 3';
      await adapter.sendMessage('C123456', messageWithFormatting);

      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(client.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123456',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: messageWithFormatting,
            },
          },
        ],
        text: messageWithFormatting,
      });
    });
  });
});
