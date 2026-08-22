const STORAGE_KEY = "shoe-eye-wages-v1";
const defaultRates = { "1眼": 0.06, "2眼": 0.07, "3眼": 0.08, "4眼": 0.09, "5眼": 0.09, "6眼": 0.10, "7眼": 0.12 };
const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

let db = load();
let activeMonth = new Date().toISOString().slice(0, 7);
let editingEmployeeId = null;
const $ = (s) => document.querySelector(s);
const monthPicker = $("#monthPicker");
monthPicker.value = activeMonth;

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { months: {} }; }
  catch { return { months: {} }; }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
function monthData(create = true) {
  if (!db.months[activeMonth] && create) db.months[activeMonth] = { employees: [] };
  return db.months[activeMonth] || { employees: [] };
}
function amount(row) { return (Number(row.quantity) || 0) * (Number(row.rate) || 0); }
function employeeTotal(employee) { return employee.rows.reduce((sum, row) => sum + amount(row), 0) + (Number(employee.adjustment) || 0); }

function render() {
  const employees = monthData(false).employees;
  const list = $("#employeeList");
  list.replaceChildren();
  employees.forEach(renderEmployee);
  const grand = employees.reduce((s, e) => s + employeeTotal(e), 0);
  const qty = employees.flatMap(e => e.rows).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  $("#grandTotal").textContent = money.format(grand);
  $("#employeeCount").textContent = `${employees.length} 人`;
  $("#quantityTotal").textContent = integer.format(qty);
  $("#emptyState").hidden = employees.length > 0;
}

function renderEmployee(employee) {
  const card = $("#employeeTemplate").content.firstElementChild.cloneNode(true);
  card.dataset.id = employee.id;
  card.querySelector(".employee-name").textContent = employee.name;
  card.querySelector(".employee-note").textContent = employee.note || "";
  card.querySelector(".employee-total strong").textContent = money.format(employeeTotal(employee));
  card.querySelector(".adjustment").value = employee.adjustment || "";
  const tbody = card.querySelector("tbody");
  employee.rows.forEach(row => tbody.append(rowElement(employee, row)));
  card.querySelector(".add-row").onclick = () => {
    const nextEye = `${Math.max(1, 7 - employee.rows.length)}眼`;
    employee.rows.push({ id: uid(), eye: nextEye, quantity: "", rate: defaultRates[nextEye] ?? 0.09 });
    save(); render();
  };
  card.querySelector(".edit-employee").onclick = () => openEmployeeDialog(employee);
  card.querySelector(".adjustment").onchange = e => { employee.adjustment = e.target.value; save(); render(); };
  card.querySelector(".delete-employee").onclick = () => {
    if (!confirm(`确定删除 ${employee.name} 在 ${activeMonth} 的全部记录吗？`)) return;
    monthData().employees = monthData().employees.filter(e => e.id !== employee.id); save(); render();
  };
  $("#employeeList").append(card);
}

function rowElement(employee, row) {
  const tr = document.createElement("tr");
  const options = Object.keys(defaultRates).reverse().map(x => `<option ${x === row.eye ? "selected" : ""}>${x}</option>`).join("");
  tr.innerHTML = `<td><select aria-label="鞋眼目数">${options}</select></td><td><input class="quantity" type="number" inputmode="numeric" min="0" step="1" value="${row.quantity ?? ""}" placeholder="0"></td><td><input class="rate" type="number" inputmode="decimal" min="0" step="0.01" value="${row.rate ?? ""}" placeholder="0.00"></td><td class="money">${money.format(amount(row))}</td><td><button class="remove-row" aria-label="删除此项">×</button></td>`;
  const update = (key, value) => { row[key] = value; save(); render(); };
  tr.querySelector("select").onchange = e => { row.eye = e.target.value; row.rate = defaultRates[row.eye]; save(); render(); };
  tr.querySelector(".quantity").onchange = e => update("quantity", e.target.value);
  tr.querySelector(".rate").onchange = e => update("rate", e.target.value);
  tr.querySelector(".remove-row").onclick = () => { employee.rows = employee.rows.filter(r => r.id !== row.id); save(); render(); };
  return tr;
}

function openEmployeeDialog(employee = null) {
  editingEmployeeId = employee?.id || null;
  $("#employeeDialogTitle").textContent = employee ? "编辑员工" : "添加员工";
  $("#employeeName").value = employee?.name || "";
  $("#employeeNote").value = employee?.note || "";
  $("#employeeDialog").showModal();
  setTimeout(() => $("#employeeName").focus(), 50);
}

$("#employeeForm").addEventListener("submit", e => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  const name = $("#employeeName").value.trim();
  if (!name) return;
  const note = $("#employeeNote").value.trim();
  if (editingEmployeeId) {
    const employee = monthData().employees.find(x => x.id === editingEmployeeId);
    Object.assign(employee, { name, note });
  } else {
    monthData().employees.push({ id: uid(), name, note, adjustment: 0, rows: [6,5,4,3].map(n => ({ id: uid(), eye: `${n}眼`, quantity: "", rate: defaultRates[`${n}眼`] })) });
  }
  save(); $("#employeeDialog").close(); render();
});

function shiftMonth(delta) {
  const [year, month] = activeMonth.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  activeMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  monthPicker.value = activeMonth; render();
}
monthPicker.onchange = () => { activeMonth = monthPicker.value; render(); };
$("#prevMonth").onclick = () => shiftMonth(-1);
$("#nextMonth").onclick = () => shiftMonth(1);
$("#addEmployeeBtn").onclick = () => openEmployeeDialog();
$("#emptyAddBtn").onclick = () => openEmployeeDialog();
$("#settingsBtn").onclick = () => $("#settingsDialog").showModal();
$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `工资备份-${new Date().toISOString().slice(0,10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$("#importInput").onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.months || typeof imported.months !== "object") throw new Error();
    if (!confirm("导入会覆盖当前浏览器里的全部工资数据，是否继续？")) return;
    db = imported; save(); render(); $("#settingsDialog").close();
  } catch { alert("备份文件无效，请选择由本网站导出的 JSON 文件。"); }
  e.target.value = "";
};
$("#clearMonthBtn").onclick = () => {
  if (!confirm(`确定清空 ${activeMonth} 的全部记录吗？此操作无法撤销。`)) return;
  delete db.months[activeMonth]; save(); render(); $("#settingsDialog").close();
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
render();
