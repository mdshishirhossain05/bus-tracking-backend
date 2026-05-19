import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/appError.js";

export async function listFavoriteRoutesService(userId: string) {
  const favorites = await prisma.favoriteRoute.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      routeId: true,
      createdAt: true,
      route: {
        select: {
          id: true,
          routeName: true,
          description: true,
          isActive: true,
        },
      },
    },
  });

  return favorites.map((favorite) => ({
    id: favorite.id,
    routeId: favorite.routeId,
    routeName: favorite.route.routeName,
    description: favorite.route.description,
    isActive: favorite.route.isActive,
    favoritedAt: favorite.createdAt.toISOString(),
  }));
}

export async function addFavoriteRouteService(
  userId: string,
  routeId: string,
) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { id: true },
  });

  if (!route) {
    throw new AppError({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
    });
  }

  // Idempotent: favoriting an already-favorited route is a no-op.
  await prisma.favoriteRoute.upsert({
    where: { userId_routeId: { userId, routeId } },
    create: { userId, routeId },
    update: {},
  });

  return listFavoriteRoutesService(userId);
}

export async function removeFavoriteRouteService(
  userId: string,
  routeId: string,
) {
  await prisma.favoriteRoute.deleteMany({ where: { userId, routeId } });
  return listFavoriteRoutesService(userId);
}
