import { z } from "zod";

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  actorUserId: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(200).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
