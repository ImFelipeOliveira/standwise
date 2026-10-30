export function httpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
