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
// 仅当前会话内的提示信息（库存不足还缺多少、领用/退回结果），不写入 localStorage
let flash = null;
let editingPartId = null;

const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return migrateState(JSON.parse(saved));
  return defaultState();
}

function defaultState() {
  return {
    view: "repairs",
    filter: "all",
    parts: [
      { id: crypto.randomUUID(), name: "角阀", unit: "个", stock: 5, price: 35, safety: 2 },
      { id: crypto.randomUUID(), name: "不锈钢波纹管", unit: "根", stock: 1, price: 18, safety: 2 }
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
        movements: []
      }
    ]
  };
}

// 旧台账没有 parts / movements，逐项补齐，保证旧数据照常打开
function migrateState(data) {
  const parts = Array.isArray(data.parts)
    ? data.parts.map((part) => ({
        id: part.id,
        name: part.name ?? "",
        unit: part.unit || "件",
        stock: Number(part.stock || 0),
        price: Number(part.price || 0),
        safety: Number(part.safety || 0)
      }))
    : [];

  return {
    view: data.view === "parts" ? "parts" : "repairs",
    filter: statuses[data.filter] ? data.filter : "all",
    parts,
    repairs: Array.isArray(data.repairs)
      ? data.repairs.map((repair) => ({
          id: repair.id,
          location: repair.location ?? "",
          title: repair.title ?? "",
          priority: priorities[repair.priority] ? repair.priority : "medium",
          cost: Number(repair.cost || 0),
          status: statuses[repair.status] && repair.status !== "all" ? repair.status : "todo",
          photo: repair.photo ?? "",
          note: repair.note ?? "",
          movements: Array.isArray(repair.movements)
            ? repair.movements.map((move) => ({
                id: move.id,
                partId: move.partId,
                partName: move.partName ?? "",
                unit: move.unit || "件",
                qty: Number(move.qty || 0),
                // 单价在领用时快照，之后改价不影响历史领用成本
                price: Number(move.price || 0),
                time: Number(move.time) || Date.now(),
                returns: Array.isArray(move.returns)
                  ? move.returns.map((record) => ({
                      id: record.id,
                      qty: Number(record.qty || 0),
                      time: Number(record.time) || Date.now()
                    }))
                  : []
              }))
            : []
        }))
      : []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function findPart(partId) {
  return state.parts.find((part) => part.id === partId);
}

function findRepair(repairId) {
  return state.repairs.find((repair) => repair.id === repairId);
}

function isLowStock(part) {
  return part.stock <= part.safety;
}

function movementReturned(move) {
  return move.returns.reduce((total, record) => total + record.qty, 0);
}

function movementNet(move) {
  return move.qty - movementReturned(move);
}

function repairMaterialCost(repair) {
  return repair.movements.reduce((total, move) => total + movementNet(move) * move.price, 0);
}

// 同一零件的多次领用合并为一组，但每次领用/退回记录仍保留在 records 中
function partGroups(repair) {
  const groups = new Map();
  repair.movements.forEach((move) => {
    const part = findPart(move.partId);
    const name = part ? part.name : move.partName;
    const unit = part ? part.unit : move.unit || "件";
    if (!groups.has(move.partId)) {
      groups.set(move.partId, { partId: move.partId, name, unit, issued: 0, returned: 0, net: 0, cost: 0, records: [] });
    }
    const group = groups.get(move.partId);
    const returned = movementReturned(move);
    const net = move.qty - returned;
    group.issued += move.qty;
    group.returned += returned;
    group.net += net;
    group.cost += net * move.price;
    group.records.push({ move, returned, net });
  });
  return [...groups.values()];
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const materialCost = unfinished.reduce((total, repair) => total + repairMaterialCost(repair), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;
  const lowCount = state.parts.filter(isLowStock).length;

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
          <div class="stat"><span>预计费用</span><strong>¥${money(totalCost)}</strong></div>
          <div class="stat"><span>未完成材料成本</span><strong>¥${money(materialCost)}</strong></div>
          <button type="button" class="stat stat-link" data-action="view" data-value="parts">
            <span>库存预警</span><strong class="${lowCount ? "danger-text" : ""}">${lowCount} 种</strong>
          </button>
        </section>
      </header>

      <div class="container">
        <div class="tabs">
          <button type="button" class="tab ${state.view === "repairs" ? "active" : ""}" data-action="view" data-value="repairs">维修事项</button>
          <button type="button" class="tab ${state.view === "parts" ? "active" : ""}" data-action="view" data-value="parts">备件库存</button>
        </div>
        ${flash ? `<div class="banner ${flash.tone}">${escapeHtml(flash.text)}</div>` : ""}
        ${state.view === "parts" ? renderPartsView() : renderRepairsView(repairs)}
      </div>
    </main>
  `;
}

function renderRepairsView(repairs) {
  return `
    <section class="layout">
      <aside class="panel">
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
        <p class="hint">备件在「备件库存」页登记；事项开工（处理中）后才能领用，用完可退，删除事项时未退部分按报废处理。</p>
      </aside>

      <section>
        <div class="toolbar">
          ${Object.entries(statuses)
            .map(
              ([value, label]) =>
                `<button type="button" class="seg ${state.filter === value ? "active" : ""}" data-action="filter" data-value="${value}">${label}</button>`
            )
            .join("")}
        </div>
        <div class="repairs">
          ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderRepair(repair) {
  const groups = partGroups(repair);
  const totalNet = groups.reduce((total, group) => total + group.net, 0);
  const materialCost = repairMaterialCost(repair);

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
          <span class="chip">预计 ¥${money(repair.cost)}</span>
          ${groups.length ? `<span class="chip">领用 ${groups.length} 种 · 净用 ${totalNet}</span>` : ""}
          ${materialCost > 0 ? `<span class="chip chip-cost">零件材料 ¥${money(materialCost)}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${renderStockSection(repair, groups)}
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          <button type="button" class="ghost" data-action="delete-repair" data-id="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStockSection(repair, groups) {
  return `
    <div class="move-section">
      ${groups.map(renderMoveGroup).join("")}
      ${renderIssueControl(repair, groups)}
    </div>
  `;
}

function renderIssueControl(repair, groups) {
  if (repair.status === "doing") {
    const options = state.parts.length
      ? state.parts
          .map(
            (part) =>
              `<option value="${part.id}">${escapeHtml(part.name)}（库存 ${part.stock} ${escapeHtml(part.unit)}，单价 ¥${money(part.price)}）${
                isLowStock(part) ? " · 预警" : ""
              }</option>`
          )
          .join("")
      : `<option value="">请先登记备件</option>`;
    return `
      <form class="issue-form" data-issue-form="${repair.id}">
        <select name="partId" ${state.parts.length ? "" : "disabled"}>${options}</select>
        <input name="qty" type="number" min="1" step="1" value="1" aria-label="领用数量">
        <button type="submit" class="mini" ${state.parts.length ? "" : "disabled"}>领用</button>
      </form>
    `;
  }
  if (repair.status === "todo" && !groups.length) {
    return `<p class="hint">事项开工（转为「处理中」）后才能领用备件。</p>`;
  }
  if (repair.status === "done" && groups.some((group) => group.net > 0)) {
    return `<p class="hint">事项已完工，未用完的备件仍可按原领用记录退回。</p>`;
  }
  return "";
}

function renderMoveGroup(group) {
  const records = group.records
    .slice()
    .reverse()
    .map(({ move, returned, net }) => renderMoveRecord(move, returned, net))
    .join("");
  return `
    <div class="move-group">
      <div class="move-summary">
        <strong>${escapeHtml(group.name)}</strong>
        <span>领 ${group.issued} / 退 ${group.returned} / 净 <em>${group.net}</em> ${escapeHtml(group.unit)}</span>
        <span class="move-cost">材料 ¥${money(group.cost)}${group.net === 0 ? " · 已退清" : ""}</span>
      </div>
      <details class="move-details">
        <summary>领用 / 退回记录（${group.records.length} 次领用）</summary>
        ${records}
      </details>
    </div>
  `;
}

function renderMoveRecord(move, returned, net) {
  return `
    <div class="move-record">
      <div class="move-line">
        <span class="move-time">${formatTime(move.time)}</span>
        领用 ${move.qty} ${escapeHtml(move.unit)} × ¥${money(move.price)} = ¥${money(move.qty * move.price)}
        <span class="move-sub">已退 ${returned}，净用 ${net}</span>
      </div>
      ${
        move.returns.length
          ? `<div class="return-list">${move.returns
              .slice()
              .reverse()
              .map(
                (record) =>
                  `<div class="return-record">↩ ${formatTime(record.time)} 退回 ${record.qty} ${escapeHtml(move.unit)}</div>`
              )
              .join("")}</div>`
          : ""
      }
      ${
        net > 0
          ? `
        <form class="return-form" data-return-form data-movement="${move.id}">
          <input name="qty" type="number" min="1" max="${net}" step="1" value="1" aria-label="退回数量">
          <button type="submit" class="mini ghost-mini">退回</button>
          <span class="hint">最多可退 ${net} ${escapeHtml(move.unit)}</span>
        </form>`
          : `<span class="done-tag">该次领用已退清</span>`
      }
    </div>
  `;
}

function renderPartsView() {
  const editing = editingPartId ? findPart(editingPartId) : null;
  const lowParts = state.parts.filter(isLowStock);

  return `
    <section class="layout">
      <aside class="panel">
        <h2>${editing ? "编辑备件" : "登记备件"}</h2>
        <form class="form" id="part-form">
          <label>零件名称<input name="name" required placeholder="例如 角阀" value="${editing ? escapeHtml(editing.name) : ""}"></label>
          <label>单位<input name="unit" list="unit-options" placeholder="件 / 个 / 根 / 米" value="${editing ? escapeHtml(editing.unit) : "件"}"></label>
          <datalist id="unit-options">
            <option value="件"></option><option value="个"></option><option value="根"></option>
            <option value="米"></option><option value="卷"></option><option value="套"></option>
          </datalist>
          <label>库存数量<input name="stock" type="number" min="0" step="1" value="${editing ? editing.stock : 0}"></label>
          <label>单价（元）<input name="price" type="number" min="0" step="0.01" value="${editing ? editing.price : 0}"></label>
          <label>安全库存<input name="safety" type="number" min="0" step="1" value="${editing ? editing.safety : 0}"></label>
          <button class="primary" type="submit">${editing ? "保存修改" : "保存备件"}</button>
          ${editing ? `<button type="button" class="ghost" data-action="part-cancel">取消编辑</button>` : ""}
        </form>
        <p class="hint">库存可随时盘点直接修改；库存达到或低于安全库存时会出现预警，领用、退回后预警即时变化。</p>
      </aside>

      <section>
        ${
          lowParts.length
            ? `<div class="banner warn">${lowParts
                .map((part) => `${escapeHtml(part.name)}（${part.stock}/${part.safety} ${escapeHtml(part.unit)}）`)
                .join("、")} 已达到或低于安全库存，请及时补货。</div>`
            : ""
        }
        <h2 class="list-title">备件库存（${state.parts.length} 种）</h2>
        <div class="parts-list">
          ${
            state.parts.length
              ? state.parts.map(renderPartRow).join("")
              : `<div class="empty">还没有登记备件，在左侧新增第一种零件。</div>`
          }
        </div>
      </section>
    </section>
  `;
}

function renderPartRow(part) {
  const low = isLowStock(part);
  return `
    <div class="part-row">
      <div class="part-name"><strong>${escapeHtml(part.name)}</strong><span>单位：${escapeHtml(part.unit)}</span></div>
      <div class="part-stock ${low ? "low" : ""}"><strong>${part.stock}</strong><span>安全库存 ${part.safety}</span></div>
      <div class="part-price"><strong>¥${money(part.price)}</strong><span>单价</span></div>
      <div>${low ? `<span class="low-badge">库存预警</span>` : `<span class="ok-badge">库存正常</span>`}</div>
      <div class="part-actions">
        <button type="button" class="ghost" data-action="part-edit" data-id="${part.id}">编辑</button>
        <button type="button" class="danger" data-action="part-delete" data-id="${part.id}">删除</button>
      </div>
    </div>
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

// 事件代理只绑定一次，render 之后依旧生效
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.id === "repair-form") handleRepairSubmit(event, form);
  else if (form.id === "part-form") handlePartSubmit(event, form);
  else if (form.dataset.issueForm !== undefined) handleIssue(event, form);
  else if (form.dataset.returnForm !== undefined) handleReturn(event, form);
});

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, value } = button.dataset;
  if (action === "view") {
    state.view = value;
    flash = null;
    saveState();
    render();
  } else if (action === "filter") {
    state.filter = value;
    flash = null;
    saveState();
    render();
  } else if (action === "delete-repair") {
    handleRepairDelete(id);
  } else if (action === "part-edit") {
    editingPartId = id;
    flash = null;
    render();
  } else if (action === "part-delete") {
    handlePartDelete(id);
  } else if (action === "part-cancel") {
    editingPartId = null;
    render();
  }
});

app.addEventListener("change", (event) => {
  const select = event.target.closest("[data-status]");
  if (!select) return;
  const repair = findRepair(select.dataset.status);
  repair.status = select.value;
  flash = null;
  saveState();
  render();
});

function handleRepairSubmit(event, form) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  state.repairs.unshift({
    id: crypto.randomUUID(),
    location: data.location.trim(),
    title: data.title.trim(),
    priority: data.priority,
    cost: Number(data.cost || 0),
    status: data.status,
    photo: data.photo.trim(),
    note: data.note.trim(),
    movements: []
  });
  saveState();
  render();
}

function handlePartSubmit(event, form) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const name = data.name.trim();
  const unit = data.unit.trim() || "件";
  const stock = parseInt(data.stock, 10);
  const price = Number(data.price || 0);
  const safety = parseInt(data.safety, 10);

  if (!name || Number.isNaN(stock) || stock < 0 || Number.isNaN(safety) || safety < 0 || price < 0) {
    flash = { tone: "error", text: "请检查备件信息：名称必填，库存/安全库存为非负整数，单价不为负数。" };
    render();
    return;
  }

  if (editingPartId) {
    const part = findPart(editingPartId);
    Object.assign(part, { name, unit, stock, price, safety });
    editingPartId = null;
  } else {
    state.parts.push({ id: crypto.randomUUID(), name, unit, stock, price, safety });
  }
  saveState();
  render();
}

function handleIssue(event, form) {
  event.preventDefault();
  const repair = findRepair(form.dataset.issueForm);
  if (repair.status !== "doing") {
    flash = { tone: "error", text: "事项开工（处理中）后才能领用备件。" };
    render();
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  const part = findPart(data.partId);
  const qty = parseInt(data.qty, 10);

  if (!part) {
    flash = { tone: "error", text: "请先在「备件库存」页登记零件。" };
    render();
    return;
  }
  if (Number.isNaN(qty) || qty <= 0) {
    flash = { tone: "error", text: "领用数量必须是大于 0 的整数。" };
    render();
    return;
  }
  // 库存不足：整笔拒绝，不扣任何库存，并说明还缺多少
  if (qty > part.stock) {
    const shortage = qty - part.stock;
    flash = {
      tone: "error",
      text: `「${part.name}」库存不足：现有 ${part.stock} ${part.unit}，本次申请 ${qty} ${part.unit}，还缺 ${shortage} ${part.unit}。本次未扣减任何库存。`
    };
    render();
    return;
  }

  part.stock -= qty;
  repair.movements.push({
    id: crypto.randomUUID(),
    partId: part.id,
    partName: part.name,
    unit: part.unit,
    qty,
    price: part.price,
    time: Date.now(),
    returns: []
  });

  let text = `已领用「${part.name}」${qty} ${part.unit}，库存剩余 ${part.stock} ${part.unit}，材料成本 ¥${money(qty * part.price)} 已计入该事项。`;
  if (isLowStock(part)) {
    text += ` 注意：${part.name} 已达到或低于安全库存（${part.stock}/${part.safety} ${part.unit}）。`;
  }
  flash = { tone: "ok", text };
  saveState();
  render();
}

function handleReturn(event, form) {
  event.preventDefault();
  const movementId = form.dataset.movement;
  const qty = parseInt(new FormData(form).get("qty"), 10);

  let target = null;
  state.repairs.forEach((repair) => {
    const found = repair.movements.find((move) => move.id === movementId);
    if (found) target = { repair, move: found };
  });
  if (!target) return;

  const { repair, move } = target;
  const net = movementNet(move);
  if (Number.isNaN(qty) || qty <= 0) {
    flash = { tone: "error", text: "退回数量必须是大于 0 的整数。" };
    render();
    return;
  }
  // 退回不能超过该次领用的净领用数量
  if (qty > net) {
    flash = {
      tone: "error",
      text: `「${move.partName}」该次领用净领 ${net} ${move.unit}，最多只能退回 ${net} ${move.unit}，库存未变动。`
    };
    render();
    return;
  }

  const part = findPart(move.partId);
  if (part) part.stock += qty;
  move.returns.push({ id: crypto.randomUUID(), qty, time: Date.now() });

  const stockText = part ? `，库存恢复为 ${part.stock} ${part.unit}` : "";
  flash = {
    tone: "ok",
    text: `已退回「${move.partName}」${qty} ${move.unit}${stockText}，事项材料成本恢复 ¥${money(qty * move.price)}。`
  };
  saveState();
  render();
}

function handleRepairDelete(repairId) {
  const repair = findRepair(repairId);
  if (!repair) return;

  // 未退回的净用量按报废处理，库存不再恢复
  const scrapped = partGroups(repair).filter((group) => group.net > 0);
  let message = `确定删除「${repair.location} · ${repair.title}」？`;
  if (scrapped.length) {
    message +=
      "\n以下未退回备件将按报废处理，库存不恢复：\n" +
      scrapped.map((group) => `· ${group.name} ${group.net} ${group.unit}`).join("\n");
  }
  if (!window.confirm(message)) return;

  state.repairs = state.repairs.filter((item) => item.id !== repairId);
  flash = scrapped.length
    ? {
        tone: "warn",
        text: `事项已删除，未退备件 ${scrapped.map((group) => `${group.name} ${group.net}${group.unit}`).join("、")} 已按报废处理。`
      }
    : { tone: "ok", text: "事项已删除。" };
  saveState();
  render();
}

function handlePartDelete(partId) {
  const part = findPart(partId);
  if (!part) return;
  const used = state.repairs.some((repair) => repair.movements.some((move) => move.partId === partId));
  if (used) {
    flash = { tone: "error", text: `「${part.name}」已有领用记录，不能删除；如需停用可把库存盘点为 0，历史记录仍保留。` };
    render();
    return;
  }
  state.parts = state.parts.filter((item) => item.id !== partId);
  if (editingPartId === partId) editingPartId = null;
  saveState();
  render();
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function money(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return String(rounded);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
