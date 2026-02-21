/**
 * Slack platform adapter using Slack Web API
 * Handles message sending with proper formatting and length limits
 */
import { WebClient } from '@slack/web-api';
import { IPlatformAdapter } from '../types';

const MAX_LENGTH = 40000; // Slack message length limit

export class SlackAdapter implements IPlatformAdapter {
  private client: WebClient;
  private streamingMode: 'stream' | 'batch';
  private botUserId: string | null = null;
  private allowedUsers: string[];

  constructor(
    token: string,
    mode: 'stream' | 'batch' = 'stream',
    allowedUsers: string[] = []
  ) {
    this.client = new WebClient(token);
    this.streamingMode = mode;
    this.allowedUsers = allowedUsers;
    console.log(`[Slack] Adapter initialized (mode: ${mode})`);
    if (allowedUsers.length > 0) {
      console.log(`[Slack] Whitelist mode enabled - ${allowedUsers.length} authorized user(s)`);
    } else {
      console.log('[Slack] Public mode enabled - all users can interact with the bot');
    }
  }

  /**
   * Send a message to a Slack channel
   * Automatically splits messages longer than 40000 characters
   * Uses Block Kit for markdown rendering of code and technical content
   */
  async sendMessage(channelId: string, message: string): Promise<void> {
    try {
      const messages = this.splitMessage(message);
      for (const msg of messages) {
        await this.client.chat.postMessage({
          channel: channelId,
          text: msg,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: msg,
              },
            },
          ],
        });
      }
      console.log(`[Slack] Message sent to channel ${channelId}`);
    } catch (error) {
      console.error('[Slack] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Split message into chunks that fit within Slack's character limit
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
   * Get the WebClient instance
   */
  getClient(): WebClient {
    return this.client;
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
    return 'slack';
  }

  /**
   * Extract conversation ID from Slack event
   * For direct messages: returns DM channel ID
   * For channel mentions: returns channel ID
   */
  getConversationId(event: { channel: string }): string {
    return event.channel;
  }

  /**
   * Extract user ID from Slack event
   */
  getUserId(event: { user?: string }): string | null {
    return event.user || null;
  }

  /**
   * Check if a message is a direct message or bot mention
   */
  isBotMentioned(text: string, botUserId: string | null): boolean {
    if (!botUserId) {
      return false;
    }
    // Check for <@BOT_USER_ID> mention format
    const mentionPattern = new RegExp(`<@${botUserId}>`);
    return mentionPattern.test(text);
  }

  /**
   * Strip bot mention from text
   */
  stripMention(text: string, botUserId: string | null): string {
    if (!botUserId) {
      return text;
    }
    const mentionPattern = new RegExp(`<@${botUserId}>\\s*`, 'g');
    return text.replace(mentionPattern, '').trim();
  }

  /**
   * Set the bot user ID (retrieved after auth test)
   */
  setBotUserId(userId: string): void {
    this.botUserId = userId;
    console.log(`[Slack] Bot user ID set: ${userId}`);
  }

  /**
   * Get the bot user ID
   */
  getBotUserId(): string | null {
    return this.botUserId;
  }

  /**
   * Check if a user is allowed to interact with the bot
   * Following zeroclaw's pattern:
   * - Empty list = deny everyone (secure by default)
   * - "*" = allow everyone (public mode)
   * - Specific user IDs = exact match required
   */
  isUserAllowed(userId: string): boolean {
    // If whitelist is empty, deny all (secure by default)
    if (this.allowedUsers.length === 0) {
      return false;
    }

    // Check if user is in whitelist (exact match or wildcard)
    return this.allowedUsers.some(user => user === '*' || user === userId);
  }

  /**
   * Start the adapter (performs auth test)
   */
  async start(): Promise<void> {
    try {
      const authResult = await this.client.auth.test();
      console.log(`[Slack] Auth test successful`);
      console.log(`[Slack] Bot name: ${authResult.user}`);
      console.log(`[Slack] Team: ${authResult.team}`);
      console.log(`[Slack] Bot user ID: ${authResult.user_id}`);

      // Store bot user ID for mention detection
      this.setBotUserId(authResult.user_id!);
    } catch (error) {
      console.error('[Slack] Auth test failed:', error);
      throw error;
    }
  }

  /**
   * Stop the adapter gracefully
   */
  stop(): void {
    console.log('[Slack] Adapter stopped');
  }
}
