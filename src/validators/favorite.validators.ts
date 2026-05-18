import { z } from "zod";

export const addFavoriteRouteSchema = z.object({
  routeId: z.string().trim().uuid(),
});

export type AddFavoriteRouteInput = z.infer<typeof addFavoriteRouteSchema>;
