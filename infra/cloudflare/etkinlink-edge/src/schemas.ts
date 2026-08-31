import { z } from "zod";

const nullableText = z.string().nullable();
const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const apiDate = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

const sourceDetailsSchema = z
  .object({
    status: nullableText,
    attendanceMode: nullableText,
    updatedAt: nullableText,
    organizer: nullableText,
    performers: z.array(z.string()),
    price: z.number().nullable(),
    currency: nullableText,
    ticketUrl: httpsUrl.nullable(),
    availability: nullableText,
    ageRange: nullableText,
    isAccessibleForFree: z.boolean().nullable(),
    doorTime: nullableText,
    duration: nullableText,
  })
  .strict();

export const eventSchema = z
  .object({
    id: z.string().regex(/^etkinlik-io-[1-9]\d*$/),
    databaseId: z.string().nullable(),
    externalId: z.number().int().positive(),
    title: z.string().min(1).max(500),
    summary: nullableText,
    description: nullableText,
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
    venue: nullableText,
    city: nullableText,
    district: nullableText,
    address: nullableText,
    imageUrl: httpsUrl.nullable(),
    categories: z.array(z.string().max(200)).max(50),
    sourceUrl: httpsUrl,
    attendeeCount: z.literal(0),
    attendeePhotoUrls: z.tuple([]),
    joined: z.literal(false),
    saved: z.literal(false),
    sourceDetails: sourceDetailsSchema,
  })
  .strict();

const catalogItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    slug: z.string().max(200),
  })
  .strict();

export const catalogResponseSchema = z
  .object({
    cities: z.array(catalogItemSchema).max(10_000),
    formats: z.array(catalogItemSchema).max(1_000),
    categories: z.array(catalogItemSchema).max(1_000),
  })
  .strict();

export const eventDetailResponseSchema = z
  .object({ event: eventSchema })
  .strict();

export const eventListResponseSchema = z
  .object({
    events: z.array(eventSchema).max(50),
    total: z.number().int().nonnegative(),
    nextSkip: z.number().int().nonnegative().nullable(),
  })
  .strict();

const listRequestSchema = z
  .object({
    action: z.literal("list"),
    city: z.string().max(120).nullable().optional(),
    formats: z.array(z.string().min(1).max(120)).max(20).optional(),
    startAt: apiDate.nullable().optional(),
    endAt: apiDate.nullable().optional(),
    sort: z.enum(["recent", "upcoming"]).optional(),
    skip: z.number().int().min(0).max(100_000).optional(),
    take: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const detailRequestSchema = z
  .object({
    action: z.literal("detail"),
    eventId: z.number().int().positive(),
  })
  .strict();

const catalogRequestSchema = z
  .object({ action: z.literal("catalog") })
  .strict();

export const eventApiRequestSchema = z.discriminatedUnion("action", [
  listRequestSchema,
  detailRequestSchema,
  catalogRequestSchema,
]);

export type EventApiRequest = z.infer<typeof eventApiRequestSchema>;

export function responseSchemaForAction(action: EventApiRequest["action"]) {
  if (action === "detail") return eventDetailResponseSchema;
  if (action === "catalog") return catalogResponseSchema;
  return eventListResponseSchema;
}
