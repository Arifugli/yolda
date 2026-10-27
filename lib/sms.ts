import { AppError } from "./auth";
import { assertDemo } from "./providers";
export function smsMode(): "demo" | "eskiz" {
  if (process.env.SMS_PROVIDER === "eskiz") {
    if (
      !process.env.ESKIZ_TOKEN ||
      !process.env.ESKIZ_TEMPLATE?.includes("{code}")
    )
      throw new AppError(503, "SMS-провайдер не настроен");
    return "eskiz";
  }
  assertDemo();
  return "demo";
}
// Eskiz token and approved message template are server-only configuration.
// Never return provider response bodies: they may contain phone numbers or secrets.
export async function sendLoginCode(
  phone: string,
  code: string,
  send: typeof fetch = fetch,
) {
  const provider = smsMode();
  if (provider === "demo") return { provider };
  if (!/^\+998\d{9}$/.test(phone) || !/^\d{6}$/.test(code))
    throw new AppError(400, "Неверный телефон или код");
  try {
    const response = await send(
      "https://notify.eskiz.uz/api/message/sms/send",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.ESKIZ_TOKEN}` },
        body: new URLSearchParams({
          mobile_phone: phone.slice(1),
          message: process.env.ESKIZ_TEMPLATE!.replaceAll("{code}", code),
          from: process.env.ESKIZ_SENDER || "4546",
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("SMS rejected");
    const result = await response.json();
    if (result.status !== "waiting" && result.status !== "success")
      throw new Error("SMS not accepted");
    return { provider };
  } catch {
    throw new AppError(503, "Не удалось отправить SMS. Попробуйте позже");
  }
}
