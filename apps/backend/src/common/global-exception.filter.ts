import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = typeof body === 'object' && body && 'message' in body ? (body as { message: string }).message : 'Erro interno';
    const code = typeof body === 'object' && body && 'code' in body ? (body as { code: string }).code : 'INTERNAL_ERROR';

    response.status(status).json({
      statusCode: status,
      code,
      message,
      details: typeof body === 'object' ? body : {}
    });
  }
}
