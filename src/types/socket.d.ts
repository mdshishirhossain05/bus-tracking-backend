import "socket.io";

declare module "socket.io" {
  interface Socket {
    data: {
      auth?: {
        userId: string;
        role: string;
        sessionId: string;
      };
      [key: string]: any;
    };
  }
}

export {};
