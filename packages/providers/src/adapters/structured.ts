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

export interface GroundedInstance {
  /** Image-frame [x,y,w,h], converted using StructuredImage.dimensions by this adapter. */
  box_2d: [number, number, number, number];
  label: string;
  /** Image-frame pixel indices; positive points include, negative points exclude. */
  points: Array<z.infer<typeof groundedPointSchema>>;
}

const MAX_GROUNDED_INSTANCES = 100;
const groundedPointSchema = z
  .object({
    at: z.tuple([z.number(), z.number()]),
    label: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export const groundedInstancesSchema: StructuredSchema<{ instances: GroundedInstance[] }> = {
  name: "photoctl_segment_instances",
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      instances: {
        type: "array",
        maxItems: MAX_GROUNDED_INSTANCES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            box_2d: {
              type: "array",
              items: { type: "number" },
              minItems: 4,
              maxItems: 4,
            },
            label: { type: "string", minLength: 1, maxLength: 256 },
            points: {
              type: "array",
              minItems: 12,
              maxItems: 12,
              description:
                "Exactly 5 positive points confidently inside different parts of the requested target and 7 negative points in distributed adjacent non-target regions. Avoid ambiguous boundaries. Preserve the requested selection and exclusions for each instance.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  at: {
                    type: "array",
                    items: { type: "number", minimum: 0, maximum: 1000 },
                    minItems: 2,
                    maxItems: 2,
                    description:
                      "Normalized [x,y] from 0 to 1000: x left-to-right, y top-to-bottom.",
                  },
                  label: { type: "integer", enum: [0, 1], description: "1 includes; 0 excludes." },
                },
                required: ["at", "label"],
              },
            },
          },
          required: ["box_2d", "label", "points"],
        },
      },
    },
    required: ["instances"],
  },
  parse: (value) =>
    z
      .object({
        instances: z
          .array(
            z
              .object({
                box_2d: z
                  .tuple([z.number(), z.number(), z.number(), z.number()])
                  .refine(
                    (box) => box[2] > 0 && box[3] > 0,
                    "Converted box must have positive area",
                  ),
                label: z.string().min(1).max(256),
                points: z
                  .array(groundedPointSchema)
                  .length(12)
                  .refine(
                    (points) => points.filter((point) => point.label === 1).length === 5,
                    "Each instance requires five positive and seven negative points",
                  ),
              })
              .strict(),
          )
          .max(MAX_GROUNDED_INSTANCES),
      })
      .strict()
      .parse(value),
};

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
          schema.name === groundedInstancesSchema.name,
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
  groundedPoints = false,
): unknown {
  if (!dimensions || !value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => convertProviderFrames(item, dimensions, groundedPoints));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "box_2d"
        ? convertBox(item, dimensions)
        : groundedPoints && key === "points"
          ? convertPoints(item, dimensions)
          : convertProviderFrames(item, dimensions, groundedPoints),
    ]),
  );
}

function convertPoints(value: unknown, dimensions: { w: number; h: number }): unknown {
  return z
    .array(
      groundedPointSchema.extend({
        at: z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]),
      }),
    )
    .parse(value)
    .map(({ at: [x, y], label }) => ({
      // Provider edge coordinates rasterize to the last sample without changing interior scaling.
      at: [
        Math.min(dimensions.w - 1, Math.round((x * dimensions.w) / 1000)),
        Math.min(dimensions.h - 1, Math.round((y * dimensions.h) / 1000)),
      ],
      label,
    }));
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
  const x = Math.round((left / 1_000) * dimensions.w);
  const y = Math.round((top / 1_000) * dimensions.h);
  return [
    x,
    y,
    Math.round((right / 1_000) * dimensions.w) - x,
    Math.round((bottom / 1_000) * dimensions.h) - y,
  ];
}
