export async function runSerially<T>(
  values: T[],
  operation: (value: T) => Promise<void>,
): Promise<void> {
  await values.reduce(
    (previous, value) => previous.then(async () => await operation(value)),
    Promise.resolve(),
  );
}
