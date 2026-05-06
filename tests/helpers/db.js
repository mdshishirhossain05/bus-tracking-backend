import { prisma } from "../../src/config/prisma.js";
export async function deleteUserByEmail(email) {
    await prisma.user.deleteMany({
        where: { email },
    });
}
//# sourceMappingURL=db.js.map