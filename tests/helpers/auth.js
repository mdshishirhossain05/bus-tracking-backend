import request from "supertest";
export async function registerAndLogin(app, user) {
    await request(app).post("/api/v1/auth/register").send(user);
    const loginRes = await request(app).post("/api/v1/auth/login").send({
        email: user.email,
        password: user.password,
    });
    return loginRes;
}
//# sourceMappingURL=auth.js.map