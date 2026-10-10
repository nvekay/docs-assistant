import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { chatRequestSchema, type ChatRequest, type ChatStreamEvent } from '@docs-assistant/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config';
import { resolveAnonymousUser } from './anonymous-user';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * POST /chat answers as Server-Sent Events. It is a POST (not EventSource/GET) because the
   * question goes in the body; the web app reads the stream with fetch + ReadableStream.
   */
  @Post()
  async ask(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = resolveAnonymousUser(req, res, this.config.NODE_ENV === 'production');

    const exceeded = await this.chat.checkLimits(userId);
    if (exceeded) {
      if (exceeded.retryAfterSeconds) res.setHeader('Retry-After', String(exceeded.retryAfterSeconds));
      throw new HttpException({ code: exceeded.code, message: exceeded.message }, 429);
    }
    const conversationId = await this.chat.openConversation(userId, body.conversationId);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // stops proxies from buffering the stream
    res.flushHeaders();

    // Closing the tab aborts the upstream model request, so nobody pays for unread tokens
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const send = (event: ChatStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of this.chat.answer(userId, conversationId, body.message, abort.signal)) {
        if (abort.signal.aborted) break;
        send(event);
      }
    } catch (error) {
      // Headers are already sent, so errors travel as an SSE event instead of an HTTP status
      this.logger.error(JSON.stringify({ event: 'chat_stream_failed', error: (error as Error).message }));
      if (!abort.signal.aborted) {
        send({ type: 'error', code: 'internal', message: 'Something went wrong. Please try again.' });
      }
    } finally {
      res.end();
    }
  }

  @Get(':conversationId/messages')
  messages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = resolveAnonymousUser(req, res, this.config.NODE_ENV === 'production');
    return this.chat.messages(userId, conversationId);
  }
}
