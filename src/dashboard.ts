import { fireWebhook } from "./webhook";

type DashboardBindings = {
  prod_d1_db_slice_upi_gateway: D1Database;
  sclice_upi_gateway_namespace: KVNamespace;
  USERNAME: string;
  PASSWORD: string;
};

type OrderRow = {
  order_id: number;
  amount: number;
  status: string;
  created_at: string;
  uid: string | null;
  payer_name: string | null;
  paid_at: string | null;
};

type PaymentRow = {
  payment_id: number;
  amount: number;
  uid: string;
  payer_name: string;
  received_at: string;
  note: string | null;
  matched_order_id: number | null;
};

const PAGE_SIZE = 20;
const SESSION_COOKIE = "dashboard_session";
const KV_KEYS = ["api_secret", "upi_id", "webhook_url", "webhook_secret"];

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionToken(env: DashboardBindings) {
  return sha256(`${env.USERNAME}:${env.PASSWORD}`);
}

async function isLoggedIn(c: any) {
  const cookies = parseCookies(c.req.header("Cookie"));
  return cookies[SESSION_COOKIE] === await sessionToken(c.env);
}

function pageNumber(c: any, name: string) {
  const value = Number(c.req.query(name) ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function shell(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --blue:#1A56FF; --blue2:#0E3FCC; --ink:#101828; --text:#344054; --muted:#667085; --line:#E4E7EC; --soft:#F6F8FC; --card:#FFFFFF; --green:#067647; --green-bg:#ECFDF3; --amber:#B54708; --amber-bg:#FFFAEB; --red:#B42318; --red-bg:#FEF3F2; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #F7F9FF 0, #FFFFFF 360px); color: var(--text); font: 14px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body:before { content: ""; position: fixed; inset: 0 0 auto; height: 220px; background: linear-gradient(135deg, #EAF0FF, #FFFFFF 72%); z-index: -1; }
    a { color: var(--blue); text-decoration: none; }
    .wrap { width: min(1200px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0 44px; }
    .hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 24px; padding: 18px 20px; background: #fff; border: 1px solid var(--line); border-radius: 24px; box-shadow: 0 18px 50px rgba(16, 24, 40, .08); }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { position: relative; width: 48px; height: 48px; border-radius: 14px; background: var(--blue); box-shadow: 0 14px 32px rgba(26, 86, 255, .24); }
    .logo:after { content: ""; position: absolute; width: 20px; height: 12px; top: 18px; left: 14px; border-radius: 10px; background: #fff; box-shadow: 10px 0 0 rgba(255,255,255,.52); }
    h1 { margin: 0; color: var(--ink); font-size: clamp(25px, 4vw, 38px); line-height: 1.05; letter-spacing: -0.04em; font-weight: 800; }
    h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; color: var(--ink); font-size: 18px; letter-spacing: -0.02em; font-weight: 800; }
    h2:before { content: ""; width: 10px; height: 24px; border-radius: 99px; background: var(--blue); }
    .muted { color: var(--muted); font-weight: 400; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 20px; box-shadow: 0 14px 36px rgba(16, 24, 40, .07); }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
    .stat { position: relative; overflow: hidden; min-height: 112px; padding: 18px; border-radius: 22px; background: #fff; border: 1px solid var(--line); box-shadow: 0 14px 34px rgba(16, 24, 40, .06); }
    .stat:after { content: ""; position: absolute; right: 16px; top: 16px; width: 34px; height: 34px; border-radius: 12px; background: linear-gradient(135deg, var(--blue), #5A86FF); opacity: .14; }
    .stat b { display: block; margin-top: 10px; color: var(--ink); font-size: 30px; line-height: 1; letter-spacing: -0.04em; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; overflow: hidden; }
    th, td { padding: 13px 12px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
    tbody tr:hover { background: var(--soft); }
    tbody tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); background: #F9FAFB; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 16px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 99px; padding: 5px 10px; font-size: 12px; font-weight: 800; text-transform: capitalize; }
    .pill:before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
    .waiting { color: var(--amber); background: var(--amber-bg); }
    .success { color: var(--green); background: var(--green-bg); }
    .timeout { color: var(--red); background: var(--red-bg); }
    .pager { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    .btn, button { border: 0; border-radius: 999px; padding: 10px 16px; color: #fff; background: var(--blue); font-weight: 800; cursor: pointer; box-shadow: 0 10px 22px rgba(26, 86, 255, .2); }
    .btn:hover, button:hover { background: var(--blue2); }
    .btn.secondary { color: var(--ink); background: #fff; border: 1px solid var(--line); box-shadow: 0 8px 18px rgba(16, 24, 40, .06); }
    input { width: 100%; border: 1px solid #D0D5DD; border-radius: 12px; background: #fff; color: var(--ink); padding: 11px 12px; outline: none; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: var(--blue); box-shadow: 0 0 0 4px rgba(26, 86, 255, .12); }
    label { display: grid; gap: 7px; color: #475467; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    .form-grid { display: grid; grid-template-columns: 190px 1fr auto; gap: 12px; align-items: end; }
    .actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .actions p { margin: 4px 0 0; }
    .notice { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #B2CCFF; border-radius: 14px; color: #1849C6; background: #EFF4FF; font-weight: 700; }
    .login { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at top, #EAF0FF, transparent 34rem); }
    .login .card { width: min(430px, 100%); padding: 28px; }
    .login form { display: grid; gap: 15px; }
    .error { color: var(--red); background: var(--red-bg); border: 1px solid #FECDCA; padding: 10px 12px; border-radius: 12px; }
    @media (max-width: 760px) { .hero, .pager { align-items: stretch; flex-direction: column; } .stats, .form-grid { grid-template-columns: 1fr; } th, td { padding: 10px 9px; } .card, .hero { border-radius: 18px; } }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function loginPage(error = "") {
  return shell("Dashboard Login", `<main class="login">
  <section class="card">
    <div class="brand" style="margin-bottom:18px"><div class="logo"></div><div><h1>UPI Gateway</h1><div class="muted">Operator dashboard</div></div></div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/dashboard/login">
      <label>Username <input name="username" autocomplete="username" required></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Enter dashboard</button>
    </form>
  </section>
</main>`);
}

function pagination(path: string, pageParam: string, page: number, hasNext: boolean) {
  const previous = Math.max(1, page - 1);
  const next = page + 1;
  return `<div class="pager">
    <span class="muted">Page ${page}</span>
    ${page > 1 ? `<a class="btn secondary" href="${path}?${pageParam}=${previous}">Previous</a>` : ""}
    ${hasNext ? `<a class="btn secondary" href="${path}?${pageParam}=${next}">Next</a>` : ""}
  </div>`;
}

function statusPill(status: string) {
  return `<span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function money(amount: number) {
  return `₹${Number(amount).toFixed(2)}`;
}

async function dashboardPage(c: any) {
  const ordersPage = pageNumber(c, "ordersPage");
  const paymentsPage = pageNumber(c, "paymentsPage");
  const timeoutResult = c.req.query("timeoutResult");
  const orderOffset = (ordersPage - 1) * PAGE_SIZE;
  const paymentOffset = (paymentsPage - 1) * PAGE_SIZE;
  const db = c.env.prod_d1_db_slice_upi_gateway as D1Database;

  const [orderCounts, paymentsCount, orders, payments, kvValues] = await Promise.all([
    db.prepare(`SELECT
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
      COUNT(*) AS total
      FROM Orders`).first<{ waiting: number | null; success: number | null; timeout: number | null; total: number }>(),
    db.prepare(`SELECT COUNT(*) AS total FROM Payments`).first<{ total: number }>(),
    db.prepare(`SELECT * FROM Orders ORDER BY order_id DESC LIMIT ? OFFSET ?`).bind(PAGE_SIZE + 1, orderOffset).all<OrderRow>(),
    db.prepare(`SELECT * FROM Payments ORDER BY payment_id DESC LIMIT ? OFFSET ?`).bind(PAGE_SIZE + 1, paymentOffset).all<PaymentRow>(),
    Promise.all(KV_KEYS.map(async (key) => [key, await c.env.sclice_upi_gateway_namespace.get(key)] as const)),
  ]);

  const orderRows = orders.results.slice(0, PAGE_SIZE);
  const paymentRows = payments.results.slice(0, PAGE_SIZE);
  const kvMap = Object.fromEntries(kvValues);

  return shell("UPI Gateway Dashboard", `<main class="wrap">
    <header class="hero">
      <div class="brand"><div class="logo"></div><div><h1>UPI Gateway</h1><div class="muted">Payment operations control tower</div></div></div>
      <a class="btn secondary" href="/dashboard/logout">Logout</a>
    </header>

    <section class="stats">
      <div class="stat"><span class="muted">Open Orders</span><b>${orderCounts?.waiting ?? 0}</b></div>
      <div class="stat"><span class="muted">Completed</span><b>${orderCounts?.success ?? 0}</b></div>
      <div class="stat"><span class="muted">Timed Out</span><b>${orderCounts?.timeout ?? 0}</b></div>
      <div class="stat"><span class="muted">Payments In</span><b>${paymentsCount?.total ?? 0}</b></div>
    </section>

    ${timeoutResult ? `<div class="notice">${escapeHtml(timeoutResult)}</div>` : ""}

    <div class="grid">
      <section class="card actions">
        <div>
          <h2>Operations</h2>
          <p class="muted">Mark waiting orders older than 10 minutes as timed out and trigger timeout webhooks.</p>
        </div>
        <form method="post" action="/dashboard/timeout-orders">
          <button type="submit">Run Timeout Sweep</button>
        </form>
      </section>

      <section class="card">
        <h2>Order Pipeline</h2>
        <div class="table-scroll"><table><thead><tr><th>ID</th><th>Amount</th><th>Status</th><th>Created</th><th>UID</th><th>Payer</th><th>Paid</th></tr></thead><tbody>
          ${orderRows.map((order) => `<tr><td>#${order.order_id}</td><td>${money(order.amount)}</td><td>${statusPill(order.status)}</td><td>${escapeHtml(order.created_at)}</td><td>${escapeHtml(order.uid)}</td><td>${escapeHtml(order.payer_name)}</td><td>${escapeHtml(order.paid_at)}</td></tr>`).join("")}
        </tbody></table></div>
        ${pagination("/dashboard", "ordersPage", ordersPage, orders.results.length > PAGE_SIZE)}
      </section>

      <section class="card">
        <h2>Payment Ledger</h2>
        <div class="table-scroll"><table><thead><tr><th>ID</th><th>Amount</th><th>UID</th><th>Payer</th><th>Received</th><th>Note</th><th>Order</th></tr></thead><tbody>
          ${paymentRows.map((payment) => `<tr><td>#${payment.payment_id}</td><td>${money(payment.amount)}</td><td>${escapeHtml(payment.uid)}</td><td>${escapeHtml(payment.payer_name)}</td><td>${escapeHtml(payment.received_at)}</td><td>${escapeHtml(payment.note)}</td><td>${escapeHtml(payment.matched_order_id)}</td></tr>`).join("")}
        </tbody></table></div>
        ${pagination("/dashboard", "paymentsPage", paymentsPage, payments.results.length > PAGE_SIZE)}
      </section>

      <section class="card">
        <h2>Runtime Configuration</h2>
        <form class="form-grid" method="post" action="/dashboard/kv">
          <label>Key <input name="key" list="kv-keys" required></label>
          <label>Value <input name="value" required></label>
          <button type="submit">Save</button>
          <datalist id="kv-keys">${KV_KEYS.map((key) => `<option value="${key}"></option>`).join("")}</datalist>
        </form>
        <div class="table-scroll" style="margin-top:14px"><table><thead><tr><th>Key</th><th>Current Value</th></tr></thead><tbody>
          ${KV_KEYS.map((key) => `<tr><td>${key}</td><td>${escapeHtml(kvMap[key] ?? "not set")}</td></tr>`).join("")}
        </tbody></table></div>
      </section>
    </div>
  </main>`);
}

export function registerDashboardRoutes(app: any) {
  app.get("/dashboard/login", (c: any) => c.html(loginPage()));

  app.post("/dashboard/login", async (c: any) => {
    const body = await c.req.parseBody();
    if (body.username !== c.env.USERNAME || body.password !== c.env.PASSWORD) {
      return c.html(loginPage("Invalid username or password"), 401);
    }
    const token = await sessionToken(c.env);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/dashboard",
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    });
  });

  app.get("/dashboard/logout", () => new Response(null, {
    status: 302,
    headers: {
      Location: "/dashboard/login",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  }));

  app.get("/dashboard", async (c: any) => {
    if (!await isLoggedIn(c)) return c.redirect("/dashboard/login");
    return c.html(await dashboardPage(c));
  });

  app.post("/dashboard/kv", async (c: any) => {
    if (!await isLoggedIn(c)) return c.redirect("/dashboard/login");
    const body = await c.req.parseBody();
    const key = String(body.key ?? "").trim();
    const value = String(body.value ?? "");
    if (!key) return c.text("Missing key", 400);
    await c.env.sclice_upi_gateway_namespace.put(key, value);
    return c.redirect("/dashboard");
  });

  app.post("/dashboard/timeout-orders", async (c: any) => {
    try{
    if (!await isLoggedIn(c)) return c.redirect("/dashboard/login");

    const secret = await c.env.sclice_upi_gateway_namespace.get("api_secret");
    if (!secret) {
      return c.redirect("/dashboard?timeoutResult=API%20secret%20is%20not%20configured");
    }

    const db = c.env.prod_d1_db_slice_upi_gateway;
    const result = await db.prepare(
        `UPDATE Orders
         SET status = 'timeout'
         WHERE status = 'waiting'
           AND CAST(julianday('now') - julianday(created_at) AS REAL) * 24 * 60 >= 10
         RETURNING *`
      ).all();
      const orders = result.results as any[];
      for (const order of orders) {
        if (!c.env.sclice_upi_gateway_namespace) continue;
        await fireWebhook(c.env.sclice_upi_gateway_namespace, c.env.prod_d1_db_slice_upi_gateway, "order.timeout", { order });
      }

    
    return c.redirect(`/dashboard?timeoutResult=${encodeURIComponent(`Timed out ${orders.length} order(s)`)}`);
    }catch(e: any){
      return c.redirect(`/dashboard?timeoutResult=${encodeURIComponent(`Error: ${e.message}`)}`);
    }
  });
}
