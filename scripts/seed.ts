import { pool, transaction } from "../lib/db";
import { assertDemo } from "../lib/providers";
import { mutate } from "../lib/service";
import { randomUUID } from "node:crypto";
assertDemo();
await transaction(async (db) => {
  const names = [
    "Азиза Демо",
    "Бехруз Демо",
    "Дилноза Демо",
    "Сардор Демо",
    "Администратор Демо",
    "Оператор Демо",
    "Непроверенный Демо",
    "Поддержка Демо",
    "Финансы Демо",
  ];
  for (let i = 0; i < names.length; i++) {
    await db.query(
      `INSERT INTO users(name,phone,phone_verified,identity,dob,role,profile) VALUES($1,$2,true,$3,'1995-03-15',$4,$5) ON CONFLICT(phone) DO NOTHING`,
      [
        names[i],
        "+99890000000" + i,
        i === 6 ? "unverified" : "verified",
        i === 4
          ? "admin"
          : i === 5
            ? "operator"
            : i === 7
              ? "support"
              : i === 8
                ? "finance"
                : "user",
        JSON.stringify({
          city: ["Фергана", "Коканд", "Андижан", "Наманган"][i % 4],
          transport: i === 1 ? "car" : "walk",
          accepting: true,
          language: "ru",
          notifications: true,
        }),
      ],
    );
  }
  const operator = (
    await db.query("SELECT id FROM users WHERE phone='+998900000005'")
  ).rows[0].id;
  for (const [id, name, city, kind] of [
    ["fergana-locker", "Фергана · Центр", "Фергана", "locker"],
    ["kokand-locker", "Коканд · Вокзал", "Коканд", "locker"],
    ["andijan-point", "Андижан · Пункт", "Андижан", "point"],
    ["namangan-locker", "Наманган · Центр", "Наманган", "locker"],
  ]) {
    await db.query(
      "INSERT INTO lockers(id,name,city,kind,operator_id,address,lat,lng) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET address=coalesce(lockers.address,excluded.address),lat=coalesce(lockers.lat,excluded.lat),lng=coalesce(lockers.lng,excluded.lng)",
      [
        id,
        name,
        city,
        kind,
        operator,
        "Демонстрационная точка · " + name,
        (
          {
            Фергана: 40.386,
            Коканд: 40.528,
            Андижан: 40.782,
            Наманган: 40.998,
          } as Record<string, number>
        )[city],
        (
          {
            Фергана: 71.786,
            Коканд: 70.942,
            Андижан: 72.344,
            Наманган: 71.672,
          } as Record<string, number>
        )[city],
      ],
    );
    if (
      !(await db.query("SELECT 1 FROM compartments WHERE locker_id=$1", [id]))
        .rowCount
    )
      for (let j = 0; j < 3; j++)
        await db.query(
          "INSERT INTO compartments(locker_id,dimensions) VALUES($1,$2)",
          [id, JSON.stringify([60, 60, 60])],
        );
  }
});
const sender = (
  await pool.query("SELECT * FROM users WHERE phone='+998900000000'")
).rows[0];
const recipient = (
  await pool.query("SELECT * FROM users WHERE phone='+998900000002'")
).rows[0];
for (const [city, lat, lng, description, district] of [
  ["Фергана", 40.386, 71.786, "Демо · Документы для учебы", "Центр"],
  ["Коканд", 40.528, 70.942, "Демо · Теплый свитер", "Вокзал"],
  ["Андижан", 40.782, 72.344, "Демо · Книги для друга", "Центр"],
  ["Наманган", 40.998, 71.672, "Демо · Подарок ко дню рождения", "Чорсу"],
] as const) {
  if (
    (
      await pool.query(
        "SELECT 1 FROM shipments WHERE sender_id=$1 AND data->>'description'=$2",
        [sender.id, description],
      )
    ).rowCount
  )
    continue;
  const data = {
    origin: {
      kind: "person",
      city,
      district,
      address: "Вымышленная улица, 10",
      lat,
      lng,
    },
    destination: {
      kind: "person",
      city,
      district: "Университет",
      address: "Вымышленная улица, 22",
      lat: lat + 0.014,
      lng: lng + 0.02,
    },
    recipient: recipient.public_id,
    category: "Другое",
    description,
    weight: 1.5,
    dimensions: [25, 20, 15],
    declaredValue: 50000,
    fragile: false,
    pickupAt: new Date(Date.now() + 3600000).toISOString(),
    deliverBy: new Date(Date.now() + 86400000 * 30).toISOString(),
    instruction: "Демонстрационные адреса. Не отправляйте реальную посылку.",
    payer: "sender",
    allowedContents: true,
    packaging: true,
    urgent: false,
    photos: [],
  };
  const created = await mutate(sender, "create", undefined, data, randomUUID());
  await mutate(sender, "pay", created.id, {}, randomUUID());
  await mutate(sender, "publish", created.id, {}, randomUUID());
}
console.log(
  "Demo accounts and lockers ready. No real identities, payments or hardware.",
);
await pool.end();
