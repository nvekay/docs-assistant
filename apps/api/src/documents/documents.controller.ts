import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createUrlDocumentSchema, type CreateUrlDocument } from '@docs-assistant/shared';
import { AdminGuard } from '../auth/auth.module';
import { ZodValidationPipe } from '../common/zod.pipe';
import { DocumentsService, MAX_UPLOAD_BYTES } from './documents.service';

@Controller('documents')
@UseGuards(AdminGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list() {
    return this.documents.list();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('title') title?: string) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    return this.documents.createFromUpload(file, title);
  }

  @Post('url')
  addUrl(@Body(new ZodValidationPipe(createUrlDocumentSchema)) body: CreateUrlDocument) {
    return this.documents.createFromUrl(body.url, body.title);
  }

  // Declared before ':id/reindex' so "reindex-all" is never read as a document id
  @Post('reindex-all')
  reindexAll() {
    return this.documents.reindexAll();
  }

  @Post(':id/reindex')
  reindex(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.reindex(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(id);
  }
}
