import { z } from "zod";
import type { GatewayClient } from "../gateway.js";

export interface StructuredSchema<Value> {
  name: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): Value;
}

export interface StructuredImage {
  bytes: Buffer;
  mediaType: "image/jpeg" | "image/png";
  dimensions: { w: number; h: number };
}

export interface StructuredAnswer<Value> {
  value: Value;
  model: string;
  requestId: string | null;
  attempts: number;
}

export interface StructuredModelAdapter {
  readonly id: string;
  readonly version: string | null;
  ask<Value>(
    schema: StructuredSchema<Value>,
    images: StructuredImage[],
    prompt: string,
  ): Promise<StructuredAnswer<Value>>;
}

export class GatewayStructuredModelAdapter implements StructuredModelAdapter {
  readonly id = "gateway-structured-v1";
  readonly version = "1";
  private readonly gateway: GatewayClient;
  private readonly model: string;

  constructor(options: { gateway: GatewayClient; model: string }) {
    this.gateway = options.gateway;
    this.model = options.model;
  }

  async ask<Value>(
    schema: StructuredSchema<Value>,
    images: StructuredImage[],
    prompt: string,
  ): Promise<StructuredAnswer<Value>> {
    const response = await this.gateway.chatCompletions({
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
              },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schema.name, strict: true, schema: schema.jsonSchema },
      },
    });
    const parsed = completionSchema.parse(response.data);
    return {
      value: schema.parse(
        convertProviderFrames(
          JSON.parse(parsed.choices[0]!.message.content) as unknown,
          images[0]?.dimensions,
        ),
      ),
      model: this.model,
      requestId: response.requestId,
      attempts: response.attempts,
    };
  }
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function convertProviderFrames(
  value: unknown,
  dimensions: { w: number; h: number } | undefined,
): unknown {
  if (!dimensions || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => convertProviderFrames(item, dimensions));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "box_2d" ? convertBox(item, dimensions) : convertProviderFrames(item, dimensions),
    ]),
  );
}

function convertBox(
  value: unknown,
  dimensions: { w: number; h: number },
): [number, number, number, number] {
  const box = z.tuple([z.number(), z.number(), z.number(), z.number()]).parse(value);
  if (box.some((coordinate) => coordinate < 0 || coordinate > 1_000)) {
    throw new Error("Provider box coordinates must be between 0 and 1000");
  }
  const [top, left, bottom, right] = box;
  if (bottom <= top || right <= left) {
    throw new Error("Provider box coordinates must be ordered with positive area");
  }
  return [
    Math.round((left / 1_000) * dimensions.w),
    Math.round((top / 1_000) * dimensions.h),
    Math.round(((right - left) / 1_000) * dimensions.w),
    Math.round(((bottom - top) / 1_000) * dimensions.h),
  ];
}
