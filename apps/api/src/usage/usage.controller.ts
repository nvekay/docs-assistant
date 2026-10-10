import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/auth.module';
import { UsageService } from './usage.service';

@Controller('usage')
@UseGuards(AdminGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** GET /usage?days=14: tokens and cost per day for the admin dashboard */
  @Get()
  summary(@Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number) {
    return this.usage.dailySummary(Math.min(Math.max(days, 1), 90));
  }
}
