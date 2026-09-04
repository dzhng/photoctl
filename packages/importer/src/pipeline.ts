export async function consumeBoundedOrdered<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  prepare: (input: Input, index: number) => Promise<Output>,
  consume: (output: Output, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  type Settled = { ok: true; value: Output } | { ok: false; error: unknown };
  const inFlight = new Map<number, Promise<Settled>>();
  let nextToStart = 0;
  const fill = () => {
    while (nextToStart < inputs.length && inFlight.size < concurrency) {
      const index = nextToStart;
      nextToStart += 1;
      inFlight.set(
        index,
        prepare(inputs[index], index).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        ),
      );
    }
  };
  fill();
  for (let index = 0; index < inputs.length; index += 1) {
    const result = await inFlight.get(index);
    if (!result) throw new Error(`Missing prepared import candidate at index ${index}`);
    if (!result.ok) {
      await Promise.all(inFlight.values());
      throw result.error;
    }
    await consume(result.value, index);
    inFlight.delete(index);
    fill();
  }
}
