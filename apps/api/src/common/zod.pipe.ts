import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform {
  constructor(private schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Données invalides',
        errors: r.error.issues.map((i) => ({ champ: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}
