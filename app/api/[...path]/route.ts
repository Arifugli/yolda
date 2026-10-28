import { listTariffs } from "@/lib/orders/tariff-admin";
import { orderStream } from "@/lib/orders/stream";
import { courierInbox } from "@/lib/orders/delivery";
import { smsMode, sendLoginCode } from "@/lib/sms";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import {
  authenticate,
  AppError,
  hash,
  token,
  type User,
  requireRole,
} from "@/lib/auth";
import { otpCode } from "@/lib/providers";
import {
  adminAction,
  adminData,
  getShipment,
  listShipments,
  mutate,
  nearby,
  participant,
  claimQuickDeliveries,
} from "@/lib/service";
import { rate } from "@/lib/rate";
import { store, load } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { geocode } from "@/lib/geocoding";
import { codeDigest } from "@/lib/secure-cache";
import {
  mobilityList,
  mobilityDetail,
  mobilityVehicles,
  mobilityPresence,
} from "@/lib/mobility";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function limitedBody(req: NextRequest, max: number) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Запрос слишком большой");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
async function handle(req: NextRequest, ctx: Context) {
  try {
    const path = (await ctx.params).path;
    const endpoint = path.join("/");
    const post = req.method === "POST";
    if (post) {
      const origin = req.headers.get("origin");
      const expectedOrigin =
        process.env.APP_ORIGIN ||
        `${req.nextUrl.protocol}//${req.headers.get("host")}`;
      if (
        req.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== expectedOrigin)
      )
        throw new AppError(403, "Недопустимый источник запроса");
      if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024)
        throw new AppError(413, "Файл слишком большой");
    }
    const raw = post
      ? await limitedBody(
          req,
          endpoint === "files" ? 6 * 1024 * 1024 : 1024 * 1024,
        )
      : Buffer.alloc(0);
    const body = () => {
      try {
        return JSON.parse(raw.toString("utf8"));
      } catch {
        throw new AppError(400, "Неверный JSON");
      }
    };
    if (endpoint === "health") {
      await pool.query("SELECT 1");
      return json({ ok: true });
    }
    if (endpoint === "auth/otp" && post) {
      const provider = smsMode();
      const b = z
        .object({
          phone: z.string().regex(/^\+998\d{9}$/),
          name: z.string().min(2).max(60),
          dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(body());
      if (
        !Number.isFinite(new Date(b.dob).getTime()) ||
        new Date(b.dob) > new Date()
      )
        throw new AppError(400, "Неверная дата рождения");
      await rate("otp-global", 100, 60);
      await rate("otp:" + b.phone, 3, 600);
      const code = otpCode();
      await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "otp-send:" + b.phone,
        ]);
        await sendLoginCode(b.phone, code);
        await db.query(
          "INSERT INTO otp(phone,hash,expires_at,dob,name,provider) VALUES($1,$2,now()+interval '5 minutes',$3,$4,$5) ON CONFLICT(phone) DO UPDATE SET hash=$2,expires_at=now()+interval '5 minutes',attempts=0,dob=$3,name=$4,provider=$5",
          [
            b.phone,
            await codeDigest(code, "otp:" + b.phone),
            b.dob,
            b.name,
            provider,
          ],
        );
      });
      return json(
        provider === "demo"
          ? {
              demo: true,
              code,
              message: "Симуляция SMS — код отображается только в демо",
            }
          : { demo: false, message: "Код отправлен по SMS" },
      );
    }
    if (endpoint === "auth/login" && post) {
      const provider = smsMode();
      const b = z
        .object({
          phone: z.string().regex(/^\+998\d{9}$/),
          code: z.string().regex(/^\d{6}$/),
        })
        .parse(body());
      await rate("login:" + b.phone, 15, 600);
      const result = await transaction(async (db) => {
        const o = (
          await db.query("SELECT * FROM otp WHERE phone=$1 FOR UPDATE", [
            b.phone,
          ])
        ).rows[0];
        if (
          !o ||
          o.provider !== provider ||
          new Date(o.expires_at) < new Date() ||
          o.attempts >= 5
        )
          throw new AppError(401, "Код истек");
        if (o.hash !== (await codeDigest(b.code, "otp:" + b.phone))) {
          await db.query("UPDATE otp SET attempts=attempts+1 WHERE phone=$1", [
            b.phone,
          ]);
          return null;
        }
        let user = (
          await db.query("SELECT * FROM users WHERE phone=$1", [b.phone])
        ).rows[0];
        if (user?.restricted) throw new AppError(403, "Аккаунт ограничен");
        if (!user)
          user = (
            await db.query(
              "INSERT INTO users(name,phone,dob,phone_verified) VALUES($1,$2,$3,true) RETURNING *",
              [o.name, b.phone, o.dob],
            )
          ).rows[0];
        await db.query("UPDATE users SET phone_verified=true WHERE id=$1", [
          user.id,
        ]);
        user.phone_verified = true;
        await db.query("DELETE FROM otp WHERE phone=$1", [b.phone]);
        await claimQuickDeliveries(db, user);
        const session = token();
        await db.query(
          "INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",
          [hash(session), user.id],
        );
        return { session, user };
      });
      if (!result) throw new AppError(401, "Неверный код");
      const res = json({ user: result.user });
      res.cookies.set("yolda_session", result.session, {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.APP_ORIGIN?.startsWith("https://") ||
          req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 604800,
      });
      return res;
    }
    if (endpoint === "config" && !post)
      return json({
        authMode: process.env.SMS_PROVIDER === "eskiz" ? "sms" : "demo",
        settings: (await pool.query("SELECT data FROM settings WHERE id=1"))
          .rows[0].data,
      });
    if (path[0] === "tracking" && path[1] && !post) {
      const r = await pool.query(
        "SELECT status,updated_at FROM shipments WHERE tracking_hash=$1",
        [hash(path[1])],
      );
      if (!r.rowCount) throw new AppError(404, "Ссылка недействительна");
      return json(r.rows[0]);
    }
    const u = await authenticate(
      req.cookies.get("yolda_session")?.value ?? null,
    );
    if (post) await rate("write:" + u.id, 120, 60);
    if (
      !post &&
      path.length === 3 &&
      path[0] === "orders" &&
      path[2] === "events"
    ) {
      await rate("order-stream:" + u.id, 30, 60);
      return await orderStream(
        z.uuid().parse(path[1]),
        req.cookies.get("yolda_session")!.value,
        req.signal,
      );
    }
    if (endpoint === "places" && !post) {
      await rate("places:" + u.id, 30, 60);
      return json(await geocode(req.nextUrl.searchParams));
    }
    if (path[0] === "delivery") {
      if (!post && endpoint === "delivery/presence")
        return json(await transaction((db) => courierInbox(db, u)));
      const action =
        path.length === 2 && path[1] === "presence"
          ? "presence"
          : path.length === 3 &&
              ["dispatch", "accept", "reject"].includes(path[2])
            ? path[2]
            : null;
      if (!post || !action) throw new AppError(404, "Не найдено");
      return json(
        await mutate(
          u,
          "delivery." + action,
          path.length === 3 ? path[1] : undefined,
          body(),
          req.headers.get("idempotency-key") ?? "",
        ),
      );
    }
    if (path[0] === "mobility") {
      if (!post) {
        if (path.length === 1)
          return json(await mobilityList(u, req.nextUrl.searchParams));
        if (path.length === 2 && path[1] === "vehicles")
          return json(await mobilityVehicles(u));
        if (path.length === 2 && path[1] === "presence")
          return json(
            await mobilityPresence(
              u,
              req.nextUrl.searchParams.get("kind") ?? "taxi",
            ),
          );
        if (path.length === 2) return json(await mobilityDetail(u, path[1]));
        throw new AppError(404, "Не найдено");
      }
      const vehicle = path.length === 2 && path[1] === "vehicles";
      const special =
        path.length === 2 && ["presence", "quote"].includes(path[1])
          ? path[1]
          : null;
      if (!(path.length === 1 || vehicle || special || path.length === 3))
        throw new AppError(404, "Не найдено");
      const result = await mutate(
        u,
        "mobility." +
          (vehicle
            ? "vehicle"
            : (special ?? (path.length === 1 ? "create" : path[2]))),
        path.length === 3 ? path[1] : undefined,
        body(),
        req.headers.get("idempotency-key") ?? "",
      );
      return result.rejected
        ? json({ error: result.message }, 400)
        : json(result);
    }
    if (endpoint === "auth/logout" && post) {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        hash(req.cookies.get("yolda_session")!.value),
      ]);
      const res = json({ ok: true });
      res.cookies.delete("yolda_session");
      return res;
    }
    if (path[0] === "avatars" && path[1] && !post) {
      const row = (
        await pool.query(
          "SELECT f.* FROM users u JOIN files f ON f.id=(u.profile->>'avatarId')::uuid AND f.owner_id=u.id WHERE u.id=$1",
          [z.uuid().parse(path[1])],
        )
      ).rows[0];
      if (!row) throw new AppError(404, "Фото профиля не найдено");
      return new NextResponse(await load(row.path), {
        headers: {
          "Content-Type": row.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (endpoint === "me")
      return json({
        user: u,
        settings: (await pool.query("SELECT data FROM settings WHERE id=1"))
          .rows[0].data,
        stats: (
          await pool.query(
            "SELECT 'sender' role,count(*)::int completed FROM shipments WHERE sender_id=$1 AND status='completed' UNION ALL SELECT 'courier',count(*)::int FROM shipments WHERE courier_id=$1 AND status='completed'",
            [u.id],
          )
        ).rows,
        ratings: (
          await pool.query(
            "SELECT role,round(avg(stars),1) average,count(*)::int count FROM reviews WHERE target_id=$1 AND publish_at<=now() AND NOT hidden GROUP BY role",
            [u.id],
          )
        ).rows,
      });
    if (endpoint === "shipments" && !post) return json(await listShipments(u));
    if (endpoint === "nearby")
      return json(await nearby(u, req.nextUrl.searchParams));
    if (endpoint === "couriers")
      return json(
        (
          await pool.query(
            "SELECT id,name,public_id,profile,(SELECT count(*)::int FROM shipments s WHERE s.courier_id=u.id AND s.status='completed') deliveries,(SELECT round(avg(stars),1) FROM reviews r WHERE r.target_id=u.id AND role='courier' AND publish_at<=now() AND NOT hidden) rating FROM users u WHERE identity='verified' AND NOT restricted AND profile->>'accepting'='true' AND id<>$1",
            [u.id],
          )
        ).rows,
      );
    if (endpoint === "lockers")
      return json(
        (await pool.query("SELECT id,name,city,kind,connected FROM lockers"))
          .rows,
      );
    if (endpoint === "notifications")
      return json(
        (
          await pool.query(
            "SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100",
            [u.id],
          )
        ).rows,
      );
    if (endpoint === "income")
      return json(
        (
          await pool.query(
            "SELECT * FROM payouts WHERE user_id=$1 ORDER BY created_at DESC",
            [u.id],
          )
        ).rows,
      );
    if (endpoint === "route" && post) {
      const v = z
        .object({
          origin: z.tuple([
            z.number().min(39).max(42),
            z.number().min(69).max(74),
          ]),
          destination: z.tuple([
            z.number().min(39).max(42),
            z.number().min(69).max(74),
          ]),
          departAt: z.iso.datetime(),
          city: z.string(),
        })
        .parse(body());
      await pool.query(
        "INSERT INTO routes VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET data=$2,updated_at=now()",
        [u.id, JSON.stringify(v)],
      );
      return json(v);
    }
    if (endpoint === "route")
      return json(
        (await pool.query("SELECT data FROM routes WHERE user_id=$1", [u.id]))
          .rows[0]?.data ?? null,
      );
    if (path[0] === "admin" && path[1] === "tariffs" && !post)
      return json(await listTariffs(u));
    if (endpoint === "admin" && !post) return json(await adminData(u));
    if (path[0] === "admin" && path[1] === "files" && path[2] && !post) {
      requireRole(u, ["admin", "support"]);
      const f = (
        await pool.query("SELECT * FROM files WHERE id=$1", [
          z.uuid().parse(path[2]),
        ])
      ).rows[0];
      if (!f) throw new AppError(404, "Фото не найдено");
      await pool.query(
        "INSERT INTO audit_logs(actor_id,action,entity_id) VALUES($1,$2,$3)",
        [u.id, "evidence.read", f.id],
      );
      return new NextResponse(await load(f.path), {
        headers: {
          "Content-Type": f.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path[0] === "admin" && post)
      return json(await adminAction(u, path[1], body()));
    if (path[0] === "shipments" && path.length === 2 && !post)
      return json(await getShipment(u, path[1]));
    if (endpoint === "files" && post) {
      const form = await new Response(raw, {
        headers: { "Content-Type": req.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
        throw new AppError(400, "Фото до 5 МБ");
      let bytes = Buffer.from(await file.arrayBuffer());
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";
      const mime = png
        ? "image/png"
        : jpg
          ? "image/jpeg"
          : webp
            ? "image/webp"
            : null;
      if (!mime || mime !== file.type)
        throw new AppError(400, "Только PNG, JPEG или WebP");
      try {
        const decoded = sharp(bytes, { limitInputPixels: 20000000 });
        const metadata = await decoded.metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width * metadata.height > 20000000
        )
          throw new Error("Image dimensions");
        bytes = Buffer.from(
          await decoded
            .rotate()
            .toFormat(
              mime === "image/png"
                ? "png"
                : mime === "image/jpeg"
                  ? "jpeg"
                  : "webp",
            )
            .toBuffer(),
        );
      } catch {
        throw new AppError(
          400,
          "Изображение повреждено или превышает 20 мегапикселей",
        );
      }
      const shipmentId = form.get("shipmentId")?.toString();
      if (shipmentId) {
        const s = (
          await pool.query("SELECT * FROM shipments WHERE id=$1", [
            z.uuid().parse(shipmentId),
          ])
        ).rows[0];
        if (!s) throw new AppError(404, "Заказ не найден");
        participant(u, s);
      }
      const id = randomUUID();
      await store(id, bytes, mime);
      await pool.query(
        "INSERT INTO files(id,owner_id,shipment_id,path,mime) VALUES($1,$2,$3,$4,$5)",
        [id, u.id, shipmentId ?? null, id, mime],
      );
      return json({ id });
    }
    if (path[0] === "files" && path[1] && !post) {
      const f = (
        await pool.query("SELECT * FROM files WHERE id=$1", [
          z.uuid().parse(path[1]),
        ])
      ).rows[0];
      if (!f) throw new AppError(404, "Фото не найдено");
      if (f.owner_id !== u.id) {
        if (!f.shipment_id) throw new AppError(403, "Нет доступа");
        const s = (
          await pool.query("SELECT * FROM shipments WHERE id=$1", [
            f.shipment_id,
          ])
        ).rows[0];
        participant(u, s);
      }
      return new NextResponse(await load(f.path), {
        headers: {
          "Content-Type": f.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (endpoint === "events") {
      const id = req.nextUrl.searchParams.get("shipmentId");
      if (!id) throw new AppError(400, "Нужен заказ");
      await getShipment(u, id);
      let timer: ReturnType<typeof setInterval>;
      let closed = false;
      let n = 0;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(timer);
            try {
              controller.close();
            } catch {}
          };
          req.signal.addEventListener("abort", close);
          timer = setInterval(async () => {
            if (closed) return;
            try {
              const fresh = await authenticate(
                req.cookies.get("yolda_session")?.value ?? null,
              );
              const data = await getShipment(fresh, id);
              if (!closed)
                controller.enqueue(
                  encoder.encode("data: " + JSON.stringify(data) + "\n\n"),
                );
              if (++n >= 30) close();
            } catch {
              close();
            }
          }, 2000);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          closed = true;
          clearInterval(timer);
        },
      });
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    if (post) {
      const action =
        path[0] === "shipments"
          ? path.length === 1
            ? "create"
            : path[2]
          : endpoint;
      return json(
        await mutate(
          u,
          action,
          path[0] === "shipments" ? path[1] : undefined,
          body(),
          req.headers.get("idempotency-key") ?? "",
        ),
      );
    }
    throw new AppError(404, "Не найдено");
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json(
        {
          error: "Проверьте поля формы",
          fields: e.issues.map((x) => ({ path: x.path, message: x.message })),
        },
        400,
      );
    if ((e as { code?: string }).code === "23505")
      return json({ error: "Эта операция уже выполнена" }, 409);
    console.error(
      "API operation failed",
      e instanceof Error ? e.name : "Error",
    );
    return json(
      {
        error:
          "Операция не выполнена. Проверьте доступность базы и настройку провайдеров",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
