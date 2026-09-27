import "./styles.css";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();
let flash = null; // 一次性提示：{ scope: "parts" | `repair:${id}`, kind: "error" | "ok", text }
let editingPartId = null;
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return normalizeState(JSON.parse(saved));
  return {
    filter: "all",
    parts: [
      { id: crypto.randomUUID(), name: "生料带", unit: "卷", price: 2.5, stock: 10, safety: 3, scrapped: 0 },
      { id: crypto.randomUUID(), name: "进水软管", unit: "根", price: 18, stock: 4, safety: 2, scrapped: 0 },
      { id: crypto.randomUUID(), name: "玻璃胶", unit: "支", price: 12, stock: 1, safety: 2, scrapped: 0 }
    ],
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        withdrawals: []
      }
    ]
  };
}

// 旧数据没有台账和领用字段，这里补齐，保证照常打开
function normalizeState(saved) {
  const repairs = Array.isArray(saved.repairs) ? saved.repairs : [];
  repairs.forEach((repair) => {
    if (!Array.isArray(repair.withdrawals)) repair.withdrawals = [];
    repair.withdrawals.forEach((record) => {
      if (!Array.isArray(record.returns)) record.returns = [];
    });
  });
  const parts = Array.isArray(saved.parts) ? saved.parts : [];
  parts.forEach((part) => {
    part.unit = part.unit || "个";
    part.price = toNonNegNum(part.price) ?? 0;
    part.stock = toNonNegInt(part.stock) ?? 0;
    part.safety = toNonNegInt(part.safety) ?? 0;
    part.scrapped = toNonNegInt(part.scrapped) ?? 0;
  });
  return { filter: saved.filter || "all", repairs, parts };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;
  const lowStock = lowStockParts();

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>¥${totalCost}</strong></div>
          <div class="stat ${lowStock.length ? "alert" : ""}"><span>库存预警</span><strong>${lowStock.length}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="sidebar">
          <section class="panel">
            <h2>新增维修事项</h2>
            <form class="form" id="repair-form">
              <label>位置<input name="location" required placeholder="例如卫生间"></label>
              <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
              <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
              <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
              <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
              <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
              <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
              <button class="primary" type="submit">保存事项</button>
            </form>
          </section>
          ${renderPartsPanel()}
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
  flash = null;
}

function renderPartsPanel() {
  return `
    <section class="panel">
      <h2>备件台账</h2>
      ${flash && flash.scope === "parts" ? `<p class="flash ${flash.kind}">${escapeHtml(flash.text)}</p>` : ""}
      <form class="form" id="part-form">
        <label>零件名称<input name="name" required placeholder="例如生料带"></label>
        <div class="part-grid">
          <label>单位<input name="unit" placeholder="个" value="个"></label>
          <label>单价（元）<input name="price" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="part-grid">
          <label>库存<input name="stock" type="number" min="0" step="1" value="0"></label>
          <label>安全库存<input name="safety" type="number" min="0" step="1" value="0"></label>
        </div>
        <button class="primary" type="submit">登记零件</button>
      </form>
      <div class="part-list">
        ${state.parts.length ? state.parts.map(renderPartRow).join("") : `<div class="empty-small">还没有登记零件</div>`}
      </div>
    </section>
  `;
}

function renderPartRow(part) {
  if (editingPartId === part.id) {
    return `
      <form class="part-row part-edit" data-part="${part.id}">
        <div class="part-grid">
          <label>名称<input name="name" required value="${escapeHtml(part.name)}"></label>
          <label>单位<input name="unit" required value="${escapeHtml(part.unit)}"></label>
        </div>
        <div class="part-grid">
          <label>单价<input name="price" type="number" min="0" step="0.01" value="${part.price}"></label>
          <label>库存<input name="stock" type="number" min="0" step="1" value="${part.stock}"></label>
        </div>
        <label>安全库存<input name="safety" type="number" min="0" step="1" value="${part.safety}"></label>
        <div class="part-actions">
          <button class="primary" type="submit">保存</button>
          <button class="ghost" type="button" data-cancel-edit>取消</button>
        </div>
      </form>
    `;
  }
  const low = part.stock < part.safety;
  return `
    <div class="part-row ${low ? "low" : ""}">
      <div class="part-main">
        <strong>${escapeHtml(part.name)}</strong>
        <span class="part-meta">¥${fmtMoney(part.price)} / ${escapeHtml(part.unit)}</span>
      </div>
      <div class="part-meta">
        <span>库存 ${part.stock} · 安全 ${part.safety}</span>
        ${low ? `<span class="warn">低于安全库存，缺 ${part.safety - part.stock}</span>` : ""}
        ${part.scrapped ? `<span class="scrap">累计报废 ${part.scrapped}</span>` : ""}
      </div>
      <div class="part-actions">
        <button class="ghost" type="button" data-edit-part="${part.id}">编辑</button>
        <button class="ghost" type="button" data-delete-part="${part.id}">删除</button>
      </div>
    </div>
  `;
}

function renderRepair(repair) {
  const records = withdrawalsOf(repair);
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          ${records.length ? `<span class="chip">材料 ¥${fmtMoney(materialCost(repair))}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${renderMaterials(repair)}
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderMaterials(repair) {
  const summary = summarizeWithdrawals(repair);
  const records = withdrawalsOf(repair);
  const cost = summary.reduce((total, item) => total + item.cost, 0);

  const flashHtml =
    flash && flash.scope === `repair:${repair.id}` ? `<p class="flash ${flash.kind}">${escapeHtml(flash.text)}</p>` : "";

  // 同一零件的多次领用合并成一行展示
  const summaryHtml = summary.length
    ? `<div class="mat-summary">${summary
        .map(
          (item) =>
            `<span class="chip">${escapeHtml(item.name)} 净用 ${item.net}${escapeHtml(item.unit)}${
              item.returned ? `（领 ${item.qty} · 退 ${item.returned}）` : ""
            }</span>`
        )
        .join("")}</div>`
    : "";

  const recordsHtml = records.length
    ? `<ul class="mat-records">${records.map((record) => renderWithdrawalRecord(repair, record)).join("")}</ul>`
    : "";

  let actionHtml = "";
  if (repair.status === "todo") {
    actionHtml = `<p class="hint">事项开工后才能领用备件</p>`;
  } else if (!state.parts.length) {
    actionHtml = `<p class="hint">还没有登记零件，请先在左侧「备件台账」登记</p>`;
  } else {
    actionHtml = `
      <form class="withdraw-form" data-withdraw="${repair.id}">
        <select name="partId" aria-label="选择零件">${state.parts
          .map((part) => `<option value="${part.id}">${escapeHtml(part.name)}（库存 ${part.stock}${escapeHtml(part.unit)}）</option>`)
          .join("")}</select>
        <input name="qty" type="number" min="1" step="1" value="1" aria-label="领用数量">
        <button class="primary" type="submit">领用</button>
      </form>`;
  }

  return `
    <div class="materials">
      <div class="mat-head"><strong>备件领退</strong><span>材料成本 ¥${fmtMoney(cost)}</span></div>
      ${flashHtml}
      ${summaryHtml}
      ${recordsHtml}
      ${actionHtml}
    </div>
  `;
}

function renderWithdrawalRecord(repair, record) {
  const returns = returnsOf(record);
  const returned = returnedOf(record);
  const net = record.qty - returned;
  const returnsHtml = returns.length
    ? `<div class="rec-returns">${returns.map((item) => `<span>${formatTime(item.time)} 退回 × ${item.qty}</span>`).join("")}</div>`
    : "";
  const actionHtml =
    net > 0
      ? `<form class="return-form" data-repair="${repair.id}" data-return="${record.id}">
          <input name="qty" type="number" min="1" max="${net}" step="1" placeholder="最多 ${net}" aria-label="退回数量">
          <button class="ghost" type="submit">退回</button>
        </form>`
      : `<span class="rec-done">已全部退回</span>`;
  return `
    <li>
      <div class="rec-main">
        <span>${formatTime(record.time)} 领用 ${escapeHtml(record.name)} × ${record.qty}（¥${fmtMoney(record.price)}/${escapeHtml(
          record.unit
        )}），已退 ${returned}，净用 ${net}</span>
        ${actionHtml}
      </div>
      ${returnsHtml}
    </li>
  `;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.repairs.unshift({
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim(),
      withdrawals: []
    });
    saveState();
    render();
  });

  document.querySelector("#part-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const name = data.name.trim();
    const price = toNonNegNum(data.price);
    const stock = toNonNegInt(data.stock);
    const safety = toNonNegInt(data.safety);
    if (state.parts.some((part) => part.name === name)) {
      flash = { scope: "parts", kind: "error", text: `零件「${name}」已存在，可在下方直接编辑。` };
      render();
      return;
    }
    if (price === null || stock === null || safety === null) {
      flash = { scope: "parts", kind: "error", text: "单价、库存、安全库存需为不小于 0 的数字，库存和安全库存需为整数。" };
      render();
      return;
    }
    state.parts.push({ id: crypto.randomUUID(), name, unit: data.unit.trim() || "个", price, stock, safety, scrapped: 0 });
    flash = { scope: "parts", kind: "ok", text: `已登记零件「${name}」。` };
    saveState();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.delete);
      if (!repair) return;
      // 清掉事项时，未退回的零件按报废处理：库存不恢复，只累计报废数
      const outstanding = summarizeWithdrawals(repair).filter((item) => item.net > 0);
      if (outstanding.length) {
        const detail = outstanding.map((item) => `${item.name} × ${item.net}${item.unit}`).join("、");
        const ok = confirm(`该事项还有未退回的零件：${detail}。\n删除后这些零件将按报废处理，库存不会恢复。确定删除？`);
        if (!ok) return;
        outstanding.forEach((item) => {
          const part = state.parts.find((entry) => entry.id === item.partId);
          if (part) part.scrapped += item.net;
        });
      }
      state.repairs = state.repairs.filter((item) => item.id !== repair.id);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-edit-part]").forEach((button) => {
    button.addEventListener("click", () => {
      editingPartId = button.dataset.editPart;
      render();
    });
  });

  document.querySelectorAll("[data-cancel-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      editingPartId = null;
      render();
    });
  });

  document.querySelectorAll(".part-edit").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const part = state.parts.find((item) => item.id === form.dataset.part);
      if (!part) return;
      const data = Object.fromEntries(new FormData(form));
      const name = data.name.trim();
      const price = toNonNegNum(data.price);
      const stock = toNonNegInt(data.stock);
      const safety = toNonNegInt(data.safety);
      if (state.parts.some((item) => item.id !== part.id && item.name === name)) {
        flash = { scope: "parts", kind: "error", text: `零件「${name}」已存在。` };
        render();
        return;
      }
      if (price === null || stock === null || safety === null) {
        flash = { scope: "parts", kind: "error", text: "单价、库存、安全库存需为不小于 0 的数字，库存和安全库存需为整数。" };
        render();
        return;
      }
      Object.assign(part, { name, unit: data.unit.trim() || "个", price, stock, safety });
      editingPartId = null;
      flash = { scope: "parts", kind: "ok", text: `已更新「${name}」。` };
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-part]").forEach((button) => {
    button.addEventListener("click", () => {
      const part = state.parts.find((item) => item.id === button.dataset.deletePart);
      if (!part) return;
      const used = state.repairs.some((repair) => withdrawalsOf(repair).some((record) => record.partId === part.id));
      if (used) {
        flash = { scope: "parts", kind: "error", text: `「${part.name}」已有领用记录，不能删除。` };
        render();
        return;
      }
      state.parts = state.parts.filter((item) => item.id !== part.id);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-withdraw]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.withdraw);
      if (!repair) return;
      const scope = `repair:${repair.id}`;
      if (repair.status === "todo") {
        flash = { scope, kind: "error", text: "事项开工后才能领用备件，请先把状态改为「处理中」。" };
        render();
        return;
      }
      const data = Object.fromEntries(new FormData(form));
      const part = state.parts.find((item) => item.id === data.partId);
      const qty = Number(data.qty);
      if (!part) {
        flash = { scope, kind: "error", text: "请选择要领用的零件。" };
        render();
        return;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        flash = { scope, kind: "error", text: "领用数量需为正整数。" };
        render();
        return;
      }
      if (part.stock < qty) {
        // 库存不足：不扣任何库存，只提示还差多少
        flash = {
          scope,
          kind: "error",
          text: `「${part.name}」库存不足：现有 ${part.stock}${part.unit}，本次要领 ${qty}，还缺 ${qty - part.stock}。未扣减任何库存。`
        };
        render();
        return;
      }
      part.stock -= qty;
      repair.withdrawals.push({
        id: crypto.randomUUID(),
        partId: part.id,
        name: part.name,
        unit: part.unit,
        price: part.price,
        qty,
        returns: [],
        time: Date.now()
      });
      flash = { scope, kind: "ok", text: `已领用「${part.name}」× ${qty}，剩余库存 ${part.stock}。` };
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-return]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.repair);
      const record = repair && withdrawalsOf(repair).find((item) => item.id === form.dataset.return);
      if (!record) return;
      const scope = `repair:${repair.id}`;
      const qty = Number(new FormData(form).get("qty"));
      const net = record.qty - returnedOf(record);
      if (!Number.isInteger(qty) || qty <= 0) {
        flash = { scope, kind: "error", text: "退回数量需为正整数。" };
        render();
        return;
      }
      if (qty > net) {
        // 退回数量不能超过该次净领用
        flash = { scope, kind: "error", text: `退回数量不能超过该次净领用，本次最多可退 ${net}${record.unit}。` };
        render();
        return;
      }
      record.returns.push({ id: crypto.randomUUID(), qty, time: Date.now() });
      const part = state.parts.find((item) => item.id === record.partId);
      if (part) part.stock += qty;
      flash = { scope, kind: "ok", text: `已退回「${record.name}」× ${qty}，库存与材料成本已按净用量恢复。` };
      saveState();
      render();
    });
  });
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function withdrawalsOf(repair) {
  return Array.isArray(repair.withdrawals) ? repair.withdrawals : [];
}

function returnsOf(record) {
  return Array.isArray(record.returns) ? record.returns : [];
}

function returnedOf(record) {
  return returnsOf(record).reduce((total, item) => total + item.qty, 0);
}

// 同一零件的多次领用合并汇总，用于展示和材料成本
function summarizeWithdrawals(repair) {
  const map = new Map();
  withdrawalsOf(repair).forEach((record) => {
    if (!map.has(record.partId)) {
      map.set(record.partId, { partId: record.partId, name: record.name, unit: record.unit, qty: 0, returned: 0, cost: 0 });
    }
    const summary = map.get(record.partId);
    const returned = returnedOf(record);
    summary.qty += record.qty;
    summary.returned += returned;
    summary.cost += (record.qty - returned) * record.price;
  });
  return [...map.values()].map((summary) => ({ ...summary, net: summary.qty - summary.returned }));
}

function materialCost(repair) {
  return summarizeWithdrawals(repair).reduce((total, item) => total + item.cost, 0);
}

function lowStockParts() {
  return state.parts.filter((part) => part.stock < part.safety);
}

function toNonNegInt(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function toNonNegNum(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function fmtMoney(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
