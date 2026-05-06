import "dotenv/config";
import { io } from "socket.io-client";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://bus-tracking-backend-production-5f40.up.railway.app";

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const TRIP_ID = process.env.TRIP_ID;

if (!ACCESS_TOKEN) {
  console.error("❌ ACCESS_TOKEN missing");
  process.exit(1);
}

if (!TRIP_ID) {
  console.error("❌ TRIP_ID missing");
  process.exit(1);
}

const socket = io(BACKEND_URL, {
  transports: ["websocket"],
  auth: {
    token: ACCESS_TOKEN,
  },
});

socket.onAny((event, ...args) => {
  console.log(`📥 event: ${event}`, JSON.stringify(args, null, 2));
});

socket.on("connect", () => {
  console.log("✅ socket connected:", socket.id);

  console.log("📨 sending join_trip for:", TRIP_ID);
  socket.emit("join_trip", { tripId: TRIP_ID });
});

socket.on("connected", (payload) => {
  console.log("📡 connected event:", payload);
});

socket.on("trip:joined", (payload) => {
  console.log("✅ joined trip:", JSON.stringify(payload, null, 2));
});

socket.on("join_denied", (payload) => {
  console.log("❌ join denied:", JSON.stringify(payload, null, 2));
});

socket.on("trip:location_updated", (payload) => {
  console.log("📍 location update:", JSON.stringify(payload, null, 2));
});

socket.on("trip:eta_updated", (payload) => {
  console.log("⏱ eta update:", JSON.stringify(payload, null, 2));
});

socket.on("trip:ended", (payload) => {
  console.log("🛑 trip ended:", JSON.stringify(payload, null, 2));
});

socket.on("auth_error", (payload) => {
  console.log("❌ auth error:", JSON.stringify(payload, null, 2));
});

socket.on("disconnect", (reason) => {
  console.log("🔌 disconnected:", reason);
});

socket.on("connect_error", (err) => {
  console.error("❌ connect error:", err.message);
});
