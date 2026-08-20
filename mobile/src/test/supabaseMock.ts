type BuilderResult<T> = {
  data: T;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

export type SupabaseBuilder<T = unknown> = {
  abortSignal: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  insert: jest.Mock;
  order: jest.Mock;
  remove: jest.Mock;
  select: jest.Mock;
  single: jest.Mock;
  update: jest.Mock;
  upload: jest.Mock;
  then: Promise<BuilderResult<T>>['then'];
};

export function createSupabaseBuilder<T>(
  result: BuilderResult<T>,
): SupabaseBuilder<T> {
  const builder = {} as SupabaseBuilder<T>;
  for (const method of [
    'abortSignal',
    'delete',
    'eq',
    'in',
    'insert',
    'order',
    'remove',
    'select',
    'single',
    'update',
    'upload',
  ] as const) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  return builder;
}
