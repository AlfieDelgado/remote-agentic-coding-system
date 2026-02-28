/**
 * Remote Coding Agent - Main Entry Point
 * Telegram + Claude MVP
 */

// Load environment variables FIRST, before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { TelegramAdapter } from './adapters/telegram';
import { TestAdapter } from './adapters/test';
import { GitHubAdapter } from './adapters/github';
import { SlackAdapter } from './adapters/slack';
import { handleMessage } from './orchestrator/orchestrator';
import { pool } from './db/connection';
import { ConversationLockManager } from './utils/conversation-lock';
import * as crypto from 'crypto';

// Module-level references for event handlers
let slack: SlackAdapter | null = null;
let lockManager: ConversationLockManager;

async function main(): Promise<void> {
  console.log('[App] Starting Remote Coding Agent (Telegram + Claude MVP)');

  // Validate required environment variables
  // At least one platform token is required
  const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasSlack = !!process.env.SLACK_BOT_TOKEN;

  if (!hasTelegram && !hasSlack) {
    console.error('[App] Missing platform configuration. At least one of TELEGRAM_BOT_TOKEN or SLACK_BOT_TOKEN is required');
    console.error('[App] Please check .env.example for required configuration');
    process.exit(1);
  }

  // Database is always required
  if (!process.env.DATABASE_URL) {
    console.error('[App] Missing required environment variable: DATABASE_URL');
    console.error('[App] Please check .env.example for required configuration');
    process.exit(1);
  }

  // Validate AI assistant credentials (warn if missing, don't fail)
  const hasClaudeCredentials = process.env.CLAUDE_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const hasCodexCredentials = process.env.CODEX_ID_TOKEN && process.env.CODEX_ACCESS_TOKEN;

  if (!hasClaudeCredentials && !hasCodexCredentials) {
    console.error('[App] No AI assistant credentials found. Set Claude or Codex credentials.');
    process.exit(1);
  }

  if (!hasClaudeCredentials) {
    console.warn('[App] Claude credentials not found. Claude assistant will be unavailable.');
  }
  if (!hasCodexCredentials) {
    console.warn('[App] Codex credentials not found. Codex assistant will be unavailable.');
  }

  // Test database connection
  try {
    await pool.query('SELECT 1');
    console.log('[Database] Connected successfully');
  } catch (error) {
    console.error('[Database] Connection failed:', error);
    process.exit(1);
  }

  // Initialize conversation lock manager
  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_CONVERSATIONS || '10');
  lockManager = new ConversationLockManager(maxConcurrent);
  console.log(`[App] Lock manager initialized (max concurrent: ${maxConcurrent})`);

  // Initialize test adapter
  const testAdapter = new TestAdapter();
  await testAdapter.start();

  // Initialize GitHub adapter (conditional)
  let github: GitHubAdapter | null = null;
  if (process.env.GITHUB_TOKEN && process.env.WEBHOOK_SECRET) {
    github = new GitHubAdapter(process.env.GITHUB_TOKEN, process.env.WEBHOOK_SECRET);
    await github.start();
  } else {
    console.log('[GitHub] Adapter not initialized (missing GITHUB_TOKEN or WEBHOOK_SECRET)');
  }

  // Initialize Slack adapter (conditional)
  if (process.env.SLACK_BOT_TOKEN) {
    const slackStreamingMode = (process.env.SLACK_STREAMING_MODE || 'stream') as 'stream' | 'batch';

    // Setup Slack user authorization (whitelist)
    const slackAllowedUserIds = (process.env.SLACK_ALLOWED_USER_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id);

    slack = new SlackAdapter(process.env.SLACK_BOT_TOKEN, slackStreamingMode, slackAllowedUserIds);
    await slack.start();
  } else {
    console.log('[Slack] Adapter not initialized (missing SLACK_BOT_TOKEN)');
  }

  // Setup Express server
  const app = express();
  const port = process.env.PORT || 3000;

  // GitHub webhook endpoint (must use raw body for signature verification)
  // IMPORTANT: Register BEFORE express.json() to prevent body parsing
  if (github) {
    app.post('/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
      try {
        const signature = req.headers['x-hub-signature-256'] as string;
        if (!signature) {
          return res.status(400).json({ error: 'Missing signature header' });
        }

        const payload = (req.body as Buffer).toString('utf-8');

        // Process async (fire-and-forget for fast webhook response)
        github.handleWebhook(payload, signature).catch(error => {
          console.error('[GitHub] Webhook processing error:', error);
        });

        return res.status(200).send('OK');
      } catch (error) {
        console.error('[GitHub] Webhook endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
    console.log('[Express] GitHub webhook endpoint registered');
  }

  // Slack events endpoint
  if (slack) {
    app.post('/webhooks/slack', express.json(), async (req, res) => {
      try {
        console.log('[Slack] Webhook received:', {
          type: req.body.type,
          hasEvent: !!req.body.event,
          eventType: req.body.event?.type
        });

        // Handle URL verification challenge
        if (req.body.type === 'url_verification') {
          console.log('[Slack] URL verification challenge received');
          return res.status(200).send(req.body.challenge);
        }

        // Handle events
        if (req.body.type === 'event_callback') {
          const event = req.body.event;
          console.log('[Slack] Event received:', event.type);

          // Process async (fire-and-forget for fast webhook response)
          handleSlackEvent(event).catch(error => {
            console.error('[Slack] Event processing error:', error);
          });
        }

        return res.status(200).send('OK');
      } catch (error) {
        console.error('[Slack] Webhook endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
    console.log('[Express] Slack events endpoint registered');

    // Slash commands endpoint (separate from events)
    // CRITICAL: Use express.raw() to preserve raw body for signature verification
    app.post('/slack/commands', express.raw({ type: 'application/x-www-form-urlencoded' }), async (req, res) => {
      try {
        // Verify signature (critical for security)
        const slackSignature = req.headers['x-slack-signature'] as string;
        const slackTimestamp = req.headers['x-slack-request-timestamp'] as string;
        const signingSecret = process.env.SLACK_SIGNING_SECRET;

        if (!slackSignature || !slackTimestamp || !signingSecret) {
          console.warn('[Slack] Missing security headers');
          return res.status(403).send('Unauthorized');
        }

        // Get raw body string for signature verification
        const rawBody = (req.body as Buffer).toString('utf-8');

        // Verify timestamp (prevent replay attacks)
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(slackTimestamp)) > 300) {
          console.warn('[Slack] Timestamp too old');
          return res.status(403).send('Unauthorized');
        }

        // Verify signature using HMAC SHA256
        const baseStr = `v0:${slackTimestamp}:${rawBody}`;
        const expectedSignature = 'v0=' + crypto
          .createHmac('sha256', signingSecret)
          .update(baseStr)
          .digest('hex');

        if (slackSignature !== expectedSignature) {
          console.warn('[Slack] Invalid signature');
          return res.status(403).send('Unauthorized');
        }

        // Parse form data from raw body
        const params = new URLSearchParams(rawBody);
        const command = params.get('command');
        const text = params.get('text') || '';
        const userId = params.get('user_id');
        const channelId = params.get('channel_id');
        const teamId = params.get('team_id');

        // Map Slack slash commands to internal commands
        // Slack uses /agent-* prefix to avoid reserved command conflicts
        const slackToInternalCommand: Record<string, string> = {
          '/agent-status': '/status',
          '/agent-clone': '/clone',
          '/agent-setcwd': '/setcwd',
          '/agent-getcwd': '/getcwd',
          '/agent-load-commands': '/load-commands',
          '/agent-command-invoke': '/command-invoke',
          '/agent-command-set': '/command-set',
          '/agent-commands': '/commands',
          '/agent-repos': '/repos',
          '/agent-reset': '/reset',
          '/agent-help': '/help',
          '/agent-pytest': '/pytest',
          '/agent-jest': '/jest',
          '/agent-pip-install': '/pip-install',
          '/agent-start-app': '/start-app',
          '/agent-kill-app': '/kill-app',
        };

        // Translate Slack command to internal command
        const internalCommand = command ? (slackToInternalCommand[command] || command) : '/help';

        console.log('[Slack] Command received:', { command, text, userId, channelId, teamId });

        // Log command translation for debugging
        if (command !== internalCommand) {
          console.log(`[Slack] Translating command: ${command} → ${internalCommand}`);
        }

        // Authorization check
        if (userId && !slack!.isUserAllowed(userId!)) {
          console.warn(`[Slack] Unauthorized command from user ${userId}`);
          return res.json({
            response_type: 'ephemeral',
            text: 'Sorry, you are not authorized to use this bot.'
          });
        }

        // Build full command with arguments
        const fullCommand = internalCommand + (text ? ' ' + text : '');

        // Fire-and-forget: respond immediately, process async
        // NOTE: The orchestrator handles conversation creation, so we don't need to call db.getOrCreateConversation here
        lockManager.acquireLock(channelId!, async () => {
          await handleMessage(slack!, channelId!, fullCommand);
        }).catch(error => {
          console.error('[Slack] Command processing error:', error);
        });

        // Immediate response (required within 3 seconds)
        return res.json({
          response_type: 'in_channel',
          text: `Processing ${internalCommand}...`
        });

      } catch (error) {
        console.error('[Slack] Command endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
    console.log('[Express] Slack commands endpoint registered');
  }

  // JSON parsing for all other endpoints
  app.use(express.json());

  // Health check endpoints
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/db', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (_error) {
      res.status(500).json({ status: 'error', database: 'disconnected' });
    }
  });

  app.get('/health/concurrency', (_req, res) => {
    try {
      const stats = lockManager.getStats();
      res.json({
        status: 'ok',
        ...stats
      });
    } catch (_error) {
      res.status(500).json({ status: 'error', reason: 'Failed to get stats' });
    }
  });

  // Test adapter endpoints
  app.post('/test/message', async (req, res) => {
    try {
      const { conversationId, message } = req.body;
      if (!conversationId || !message) {
        return res.status(400).json({ error: 'conversationId and message required' });
      }

      await testAdapter.receiveMessage(conversationId, message);

      // Process the message through orchestrator (non-blocking)
      lockManager
        .acquireLock(conversationId, async () => {
          await handleMessage(testAdapter, conversationId, message);
        })
        .catch(error => {
          console.error('[Test] Message handling error:', error);
        });

      return res.json({ success: true, conversationId, message });
    } catch (error) {
      console.error('[Test] Endpoint error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/test/messages/:conversationId', (req, res) => {
    const messages = testAdapter.getSentMessages(req.params.conversationId);
    res.json({ conversationId: req.params.conversationId, messages });
  });

  app.delete('/test/messages/:conversationId?', (req, res) => {
    testAdapter.clearMessages(req.params.conversationId);
    res.json({ success: true });
  });

  app.listen(port, () => {
    console.log(`[Express] Health check server listening on port ${port}`);
  });

  // Initialize platform adapter (Telegram)
  const streamingMode = (process.env.TELEGRAM_STREAMING_MODE || 'stream') as 'stream' | 'batch';
  const telegram = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN!, streamingMode);

  // Setup Telegram user authorization (whitelist)
  const allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id);

  function isUserAuthorized(userId: number): boolean {
    // If no whitelist is configured, allow everyone (current behavior)
    if (allowedUserIds.length === 0) {
      return true;
    }
    // Check if user ID is in the whitelist
    return allowedUserIds.includes(userId.toString());
  }

  // Log authorization mode on startup
  if (allowedUserIds.length > 0) {
    console.log(`[Telegram] Whitelist mode enabled - ${allowedUserIds.length} authorized user(s)`);
  } else {
    console.log('[Telegram] Public mode enabled - all users can interact with the bot');
  }

  // Handle text messages
  telegram.getBot().on('text', async ctx => {
    // Authorization check: Only allow whitelisted users (if whitelist is configured)
    if (!isUserAuthorized(ctx.from.id)) {
      console.warn(`[Telegram] Unauthorized access attempt from user ${ctx.from.id} (username: ${ctx.from.username || 'none'})`);
      // Silently ignore the message - don't send any response
      return;
    }

    const conversationId = telegram.getConversationId(ctx);
    const message = ctx.message.text;

    if (!message) return;

    // Fire-and-forget: handler returns immediately, processing happens async
    lockManager
      .acquireLock(conversationId, async () => {
        await handleMessage(telegram, conversationId, message);
      })
      .catch(error => {
        console.error('[Telegram] Failed to process message:', error);
      });
  });

  // Start bot
  await telegram.start();

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('[App] Shutting down gracefully...');
    telegram.stop();
    pool.end().then(() => {
      console.log('[Database] Connection pool closed');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log('[App] Remote Coding Agent is ready!');
  console.log('[App] Send messages to your Telegram bot to get started');
  console.log('[App] Test endpoint available: POST http://localhost:' + port + '/test/message');
}

// Run the application
main().catch(error => {
  console.error('[App] Fatal error:', error);
  process.exit(1);
});

/**
 * Handle Slack events
 */
async function handleSlackEvent(event: any): Promise<void> {
  if (!slack) return;

  // Only process message events and app_mention events
  if (event.type !== 'message' && event.type !== 'app_mention') {
    return;
  }

  // Skip messages from bots (including our own)
  if (event.bot_id || event.subtype === 'bot_message') {
    return;
  }

  // Skip messages without text (e.g., file uploads, reactions)
  if (!event.text) {
    return;
  }

  // Skip slash commands - they're handled by the /slack/commands endpoint
  // This prevents duplicate processing when Slack sends both command and message events
  if (event.text.startsWith('/')) {
    console.log('[Slack] Skipping slash command in events endpoint (handled by /slack/commands)');
    return;
  }

  const conversationId = slack.getConversationId(event);
  const userId = slack.getUserId(event);

  if (!userId) {
    console.warn('[Slack] Message without user ID, skipping');
    return;
  }

  // Authorization check: Only allow whitelisted users
  if (!slack.isUserAllowed(userId)) {
    console.warn(`[Slack] Unauthorized access attempt from user ${userId}`);
    // Silently ignore the message - don't send any response
    return;
  }

  // Check if bot is mentioned or if it's a DM
  const botUserId = slack.getBotUserId();
  const isBotMentioned = slack.isBotMentioned(event.text, botUserId);

  // For DM channels, we don't need a mention
  // For public/private channels, we require a bot mention
  // Check both channel_type field and channel ID prefix for robustness
  const channelId = event.channel || '';
  const isDM = event.channel_type === 'im' || channelId.startsWith('D');

  if (!isDM && !isBotMentioned) {
    console.log('[Slack] Message not directed at bot, skipping');
    return;
  }

  // Strip bot mention if present
  const message = slack.stripMention(event.text, botUserId);

  console.log(`[Slack] Processing message from user ${userId} in ${conversationId}`);

  // Fire-and-forget: handler returns immediately, processing happens async
  try {
    await lockManager.acquireLock(conversationId, async () => {
      await handleMessage(slack!, conversationId, message);
    });
  } catch (error) {
    console.error('[Slack] Failed to process message:', error);
  }
}
