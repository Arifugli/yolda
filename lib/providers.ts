import { randomInt } from "node:crypto";
export interface IdentityProvider {
  verify(input: { userId: string; dob: string }): Promise<{
    reference: string;
    status: "verified" | "rejected";
    provider: string;
  }>;
}
export interface PaymentProvider {
  pay(
    reference: string,
    amount: number,
  ): Promise<{ reference: string; status: "paid"; simulated: boolean }>;
}
export interface MapsProvider {
  estimate(
    from: [number, number],
    to: [number, number],
  ): { km: number; approximate: boolean };
}
export interface NotificationProvider {
  send(userId: string, text: string): Promise<void>;
}
export interface LockerProvider {
  open(
    connected: boolean,
    fault: string | null,
  ): Promise<{ opened: boolean; simulated: boolean }>;
}
export function assertDemo() {
  if (process.env.APP_MODE !== "demo")
    throw new Error(
      "Real providers are not configured. Explicit APP_MODE=demo is required; production never falls back to demo.",
    );
  if (process.env.DEPLOYMENT_ENV === "production")
    throw new Error("Demo adapters are forbidden in production deployment");
}
export const identityProvider: IdentityProvider = {
  async verify({ dob }) {
    assertDemo();
    const age = (Date.now() - new Date(dob).getTime()) / 31557600000;
    return {
      reference: crypto.randomUUID(),
      status: age >= 18 ? "verified" : "rejected",
      provider: "demo-identity",
    };
  },
};
export const paymentProvider: PaymentProvider = {
  async pay(reference, amount) {
    assertDemo();
    if (amount <= 0) throw new Error("Invalid amount");
    return { reference, status: "paid", simulated: true };
  },
};
export const mapsProvider: MapsProvider = {
  estimate(a, b) {
    const r = Math.PI / 180;
    const dlat = (b[0] - a[0]) * r,
      dlon = (b[1] - a[1]) * r;
    const x =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlon / 2) ** 2;
    return {
      km:
        Math.round(6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) /
        10,
      approximate: true,
    };
  },
};
export const lockerProvider: LockerProvider = {
  async open(connected, fault) {
    assertDemo();
    if (!connected)
      throw new Error(
        "Постамат не в сети. Последнее подтвержденное состояние сохранено",
      );
    if (fault === "door") throw new Error("Дверь не открылась");
    return { opened: true, simulated: true };
  },
};
export const notificationProvider: NotificationProvider = {
  async send() {
    assertDemo();
  },
};
export function otpCode() {
  return String(randomInt(100000, 1000000));
}
