const $ = (id) => document.getElementById(id);
let operatorToken = sessionStorage.getItem("wallet-operator") || "";
let state;
let policyLoaded = false;
let polling;
const labels = {
  awaiting_approval: "승인 대기",
  ready: "실행 준비",
  executing: "실행 중",
  succeeded: "완료",
  rejected: "거절됨",
  failed: "미전송 실패",
  uncertain: "확인 필요",
  charged_unconfirmed: "최대 금액 기록",
};
const node = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};
async function api(path, body) {
  const r = await fetch("/api/admin/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + operatorToken,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "요청에 실패했습니다.");
  return data;
}
function message(text) {
  $("message").textContent = text;
  $("message").hidden = false;
}
function action(button, fn) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await fn();
      await refresh();
    } catch (e) {
      message(e.message);
    } finally {
      button.disabled = false;
    }
  });
}
function agentName(id) {
  return state.agents.find((a) => a.id === id)?.name || id.slice(0, 8);
}
function detail(op) {
  $("detail-content").textContent = JSON.stringify(op, null, 2);
  $("detail-dialog").showModal();
}
async function worldProof(purpose, operationId) {
  const c = await api("world/challenge", {
    purpose,
    ...(operationId ? { operation_id: operationId } : {}),
  });
  const { verifyHuman } = await import("/world-id.bundle.js");
  message("World ID 앱에서 요청을 확인해 주세요.");
  const proof = await verifyHuman(c, (url) => {
    const a = $("world-connect");
    a.href = url;
    a.hidden = false;
  });
  const r = await api("world/verify", { challenge_id: c.id, proof });
  $("world-connect").hidden = true;
  message("World ID 확인이 완료되었습니다.");
  return r;
}
async function approve(op) {
  if (state.world.enrolled || state.budget.mode === "x402")
    await worldProof("approve", op.id);
  else
    await api("operations/" + op.id + "/approve", {
      actionDigest: op.actionDigest,
    });
  if (state.budget.mode === "demo")
    await api("demo/execute", { operation_id: op.id });
  message("승인이 완료되었습니다.");
}
function render() {
  const b = state.budget;
  const demo = b.mode === "demo";
  const pending = state.operations.filter(
    (o) =>
      o.status === "awaiting_approval" &&
      o.expiresAt > Date.now() &&
      o.policyRevision === b.revision,
  );
  $("mode").textContent = demo ? "SIMULATION" : "LIVE · WORLD CHAIN";
  $("day").textContent = b.day + " · " + b.timezone;
  $("mode-note").textContent = demo
    ? "데모 모드 · USDC 금액은 시뮬레이션입니다. 실제 자금 이동 없이 승인·한도·영수증 흐름을 확인하세요."
    : "실결제 모드 · 등록된 World Chain 지갑에서 승인된 서비스의 USDC 결제를 실행합니다.";
  for (const [id, val] of [
    ["remaining", b.remaining],
    ["daily", b.dailyLimit],
    ["auto", b.autoLimit],
    ["committed", b.committed],
  ])
    $(id).textContent = Number(val).toFixed(2);
  $("pending").textContent = pending.length;
  $("pending-nav").textContent = pending.length;
  $("budget-fill").style.width =
    Math.min(100, (Number(b.committed) / Number(b.dailyLimit)) * 100) + "%";
  if (!policyLoaded) {
    $("daily-limit").value = b.dailyLimit;
    $("auto-limit").value = b.autoLimit;
    policyLoaded = true;
  }
  const approvals = $("approval-list");
  approvals.replaceChildren();
  if (!pending.length) {
    const empty = node("div", undefined, "empty");
    empty.append(
      node("span", "✓", "empty-mark"),
      node("span", "지금은 승인할 요청이 없습니다."),
      node("span", "에이전트는 정해진 한도 안에서 작업합니다."),
    );
    approvals.append(empty);
  }
  for (const op of pending) {
    const c = node("article", undefined, "approval-card");
    const top = node("div", undefined, "approval-top");
    top.append(
      node("span", op.serviceName, "approval-title"),
      node("span", op.amount + " USDC", "approval-amount"),
    );
    const buttons = node("div", undefined, "approval-buttons");
    const yes = node("button", "승인하고 계속", "primary");
    const no = node("button", "거절", "secondary");
    const inspect = node("button", "상세", "secondary");
    action(yes, () => approve(op));
    action(no, () => api("operations/" + op.id + "/reject", {}));
    inspect.onclick = () => detail(op);
    buttons.append(yes, no, inspect);
    c.append(
      top,
      node(
        "p",
        agentName(op.agentId) +
          " · " +
          new Date(op.expiresAt).toLocaleTimeString("ko-KR") +
          "까지 유효",
        "approval-meta",
      ),
      buttons,
    );
    approvals.append(c);
  }
  const tbody = $("activity-body");
  tbody.replaceChildren();
  $("activity-empty").hidden = state.operations.length > 0;
  $("activity-count").textContent = state.operations.length + " requests";
  for (const op of state.operations) {
    const tr = node("tr");
    const badge = node(
      "span",
      labels[op.status] || op.status,
      "status-badge" +
        (op.status === "awaiting_approval"
          ? " waiting"
          : ["uncertain", "failed", "rejected"].includes(op.status)
            ? " bad"
            : ""),
    );
    const status = node("td");
    status.append(badge);
    const td = node("td");
    const view = node("button", "↗", "detail-button");
    view.setAttribute("aria-label", op.serviceName + " 상세");
    view.onclick = () => detail(op);
    td.append(view);
    if (op.status === "uncertain") {
      const ack = node("button", "최대 금액 기록", "secondary");
      action(ack, () => api("operations/" + op.id + "/acknowledge", {}));
      td.append(ack);
    }
    tr.append(
      node("td", op.serviceName),
      node("td", agentName(op.agentId)),
      node("td", op.amount + " USDC"),
      status,
      node(
        "td",
        new Date(op.createdAt).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
      td,
    );
    tbody.append(tr);
  }
  const list = $("agent-list");
  list.replaceChildren();
  for (const a of state.agents) {
    const row = node("div", undefined, "agent");
    const info = node("div", undefined, "agent-info");
    info.append(
      node("div", a.name, "agent-name"),
      node(
        "div",
        a.revoked ? "권한 회수됨" : a.id.slice(0, 8) + " · active",
        "agent-id",
      ),
    );
    const revoke = node("button", a.revoked ? "비활성" : "권한 회수");
    revoke.disabled = !!a.revoked;
    action(revoke, () => api("agents/" + a.id + "/revoke", {}));
    row.append(node("span", "◈", "agent-icon"), info, revoke);
    list.append(row);
  }
  const selectedAgent = $("demo-agent").value;
  $("demo-agent").replaceChildren(
    ...state.agents
      .filter((a) => !a.revoked)
      .map((a) => {
        const o = node("option", a.name);
        o.value = a.id;
        return o;
      }),
  );
  if ([...$("demo-agent").options].some((o) => o.value === selectedAgent))
    $("demo-agent").value = selectedAgent;
  if (!$("demo-service").options.length) {
    for (const s of state.services) {
      const o = node("option", s.name + " · " + s.price + " USDC");
      o.value = s.id;
      $("demo-service").append(o);
    }
    serviceChanged();
  }
  $("demo-panel").hidden = !demo;
  $("world-status").textContent = state.world.enrolled
    ? "인간 인증 연결됨 · " + state.world.environment
    : state.world.configured
      ? "World ID를 연결해 승인자를 확인하세요."
      : "미연결 · 데모는 운영자 토큰으로 승인합니다. 설정 후 World ID를 연결할 수 있습니다.";
  $("world-enroll").disabled = !state.world.configured || state.world.enrolled;
  $("world-enroll").textContent = state.world.enrolled
    ? "연결 완료 ✓"
    : "World ID 연결 ↗";
}
async function refresh() {
  state = await api("state");
  render();
}
async function login() {
  await refresh();
  sessionStorage.setItem("wallet-operator", operatorToken);
  $("operator-token").value = "";
  $("login").hidden = true;
  $("workspace").hidden = false;
  clearInterval(polling);
  polling = setInterval(() => refresh().catch(() => {}), 5000);
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  operatorToken = $("operator-token").value.trim();
  try {
    await login();
  } catch (error) {
    $("login-error").textContent = error.message;
  }
});
$("logout").onclick = () => {
  sessionStorage.removeItem("wallet-operator");
  operatorToken = "";
  clearInterval(polling);
  location.reload();
};
$("close-detail").onclick = () => $("detail-dialog").close();
action($("refresh"), () => refresh());
action($("world-enroll"), () => worldProof("enroll"));
$("policy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("policy", {
      daily_limit: $("daily-limit").value,
      auto_limit: $("auto-limit").value,
    });
    message("지출 규칙이 저장되었습니다. 미실행 요청은 다시 생성해 주세요.");
    await refresh();
  } catch (error) {
    message(error.message);
  }
});
function serviceChanged() {
  const s = state.services.find((s) => s.id === $("demo-service").value);
  $("service-description").textContent = s?.description || "";
  $("demo-input").value =
    s?.input === "bess"
      ? JSON.stringify(
          { power_mw: 100, energy_mwh: 200, soc: 0.62, soh: 0.96 },
          null,
          2,
        )
      : "{}";
}
$("demo-service").onchange = serviceChanged;
$("demo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const op = await api("demo", {
      agent_id: $("demo-agent").value,
      service_id: $("demo-service").value,
      input: JSON.parse($("demo-input").value),
      idempotency_key: crypto.randomUUID(),
    });
    message(
      op.status === "awaiting_approval"
        ? "승인 요청이 생성되었습니다. 위의 승인 요청에서 내용을 확인하세요."
        : "요청 완료 · " +
            op.amount +
            " USDC · " +
            (labels[op.status] || op.status),
    );
    await refresh();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
});
$("agent-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const agent = await api("agents", { name: $("agent-name").value });
    $("new-credential").hidden = false;
    $("credential-value").value = JSON.stringify(agent, null, 2);
    $("agent-name").value = "";
    await refresh();
  } catch (error) {
    message(error.message);
  }
});
for (const a of document.querySelectorAll("nav a"))
  a.addEventListener("click", () => {
    for (const link of document.querySelectorAll("nav a"))
      link.classList.toggle("active", link === a);
  });
if (operatorToken)
  login().catch(() => {
    operatorToken = "";
    sessionStorage.removeItem("wallet-operator");
  });
