import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

/** Logs route and duration of every request as JSON, so p95 can be computed from the logs */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Timing');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const req = ctx.switchToHttp().getRequest<Request>();
    // Express types req.route as any; the matched pattern (e.g. /documents/:id) groups requests better than the URL
    const route = (req.route as { path?: string } | undefined)?.path ?? req.url;
    const log = () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.logger.log(JSON.stringify({ method: req.method, route, ms: Math.round(ms) }));
    };
    return next.handle().pipe(tap({ complete: log, error: log }));
  }
}
