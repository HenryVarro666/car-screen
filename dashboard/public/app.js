// Dashboard front end. The server has already ranked the cars; this page filters, sorts and shows them.
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (value, digits = 0) => (value === undefined || value === null ? "" : "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const safeUrl = (url) => (typeof url === "string" && url.startsWith("https://") ? url : null);
const link = (url, text) => (safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));

const STATUS = {
  available: "可售", transferable: "可调车", listed: "平台在挂", on_hold: "已预留", coming_soon: "即将上架",
  unavailable: "已下架", sold: "已售", unverified: "本次没读到", private_lead: "私人线索", auction: "拍卖中",
};
const TONE = { available: "good", transferable: "good", listed: "", on_hold: "warn", coming_soon: "warn", unavailable: "bad", sold: "bad", unverified: "warn", private_lead: "", auction: "good" };

const state = { data: null, model: "", fields: new Set(), compare: new Set() };

function optionTag(car, field) {
  const option = car.options?.[field.key];
  if (!option || option.value === "unknown") return `<span class="tag">${esc(field.label)} 待核</span>`;
  if (option.value === "absent") return `<span class="tag bad">${esc(field.label)} 无</span>`;
  const wanted = !field.preferred || field.preferred.includes(option.value);
  const text = option.value === "present" ? field.label : `${field.label} ${option.value}`;
  return `<span class="tag ${wanted ? "good" : ""}" title="证据 ${esc(option.evidence)} 级，${esc(option.at)}">${esc(text)}·${esc(option.evidence)}</span>`;
}

const fieldsOf = (car) => state.data.profile.fields.filter((f) => car.fieldKeys.includes(f.key));
const otdOf = (car) => car.quoteRecord?.quote?.otd;
const checkedOf = (car) => (car.confirmed?.at ?? car.last?.at ?? "").slice(0, 10);

function visible(car) {
  const scope = $("scope").value;
  const stage = car.rec.stage;
  if (scope === "active" && stage > 3) return false;
  if (scope === "stock" && (!car.rec.inStock || car.closed)) return false;
  if (scope === "all" && car.closed) return false;
  if (scope === "closed" && !car.closed) return false;
  if (state.model && car.model !== state.model) return false;
  if ($("area").value && car.area !== $("area").value) return false;
  const maxOtd = Number($("maxOtd").value);
  if (maxOtd > 0 && !(otdOf(car) <= maxOtd)) return false;
  const maxMiles = Number($("maxMiles").value);
  if (maxMiles > 0 && !(car.miles <= maxMiles)) return false;
  for (const key of state.fields) {
    const field = state.data.profile.fields.find((f) => f.key === key);
    const option = car.options?.[key];
    const has = option && !["absent", "unknown"].includes(option.value) && (!field.preferred || field.preferred.includes(option.value));
    if (!has) return false;
  }
  const q = $("search").value.trim().toLowerCase();
  if (q) {
    const hay = [car.id, car.title, car.dealer, car.city, car.vin, car.stock, car.color].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function sorted(cars) {
  const by = $("sort").value;
  const big = Number.MAX_SAFE_INTEGER;
  const key = {
    rank: (c) => c.rank,
    otd: (c) => otdOf(c) ?? big,
    miles: (c) => c.miles ?? big,
    price: (c) => c.quoteRecord?.quote?.price ?? big,
  }[by];
  if (by === "checked") return [...cars].sort((a, b) => checkedOf(b).localeCompare(checkedOf(a)) || a.rank - b.rank);
  return [...cars].sort((a, b) => key(a) - key(b) || a.rank - b.rank);
}

function row(car) {
  const quote = car.quoteRecord?.quote;
  const status = car.rec.status;
  const cap = state.data.profile.budget.otdCap;
  const auction = car.auction ? `<small>最高出价 ${money(car.auction.highBid)}${car.auction.ends ? `，${esc(car.auction.ends.replace("T", " ").slice(0, 16))} 截拍` : ""}</small>` : "";
  return `<tr>
    <td><input type="checkbox" data-compare="${esc(car.vin)}" aria-label="比较 ${esc(car.id)}" ${state.compare.has(car.vin) ? "checked" : ""}></td>
    <td class="car"><button type="button" data-detail="${esc(car.vin)}">${esc(car.id)} · ${esc(car.year)} ${esc(car.title)}</button>
      <small>${esc(car.dealer)}，${esc(car.city)}${safeUrl(car.listing) ? ` · ${link(car.listing, "原页")}` : ""}</small>${auction}</td>
    <td><span class="tag ${TONE[status] ?? ""}">${esc(STATUS[status] ?? status)}</span><br><small class="muted">${esc(checkedOf(car))}${car.rec.stale ? " · 待复核" : ""}</small></td>
    <td class="num">${car.miles !== undefined ? car.miles.toLocaleString("en-US") + (car.approximateMiles ? " 约" : "") : "待核"}</td>
    <td class="num">${quote ? money(quote.price) : "待核"}</td>
    <td class="num">${quote ? `${money(quote.otd)}${quote.lowerBound ? ' <span class="floor">起</span>' : ""}<br><small class="muted">${quote.otd > cap ? "超 " + money(quote.otd - cap) : "余 " + money(cap - quote.otd)}</small>` : "待核"}</td>
    <td class="num">${quote ? money(quote.monthly) : ""}</td>
    <td><div class="opts">${fieldsOf(car).filter((f) => f.mode !== "record").map((f) => optionTag(car, f)).join("")}</div></td>
    <td class="why">${esc(car.rec.reasons.join("；"))}${car.rec.next.length ? `<div class="next">下一步：${esc(car.rec.next.join("；"))}</div>` : ""}</td>
  </tr>`;
}

const HEAD = `<thead><tr><th><span aria-hidden="true">比较</span></th><th>车</th><th>状态</th><th class="num">里程</th><th class="num">车价</th><th class="num">估算落地</th><th class="num">月供</th><th>选装（证据等级）</th><th>为什么排这里</th></tr></thead>`;

function renderList() {
  const cars = state.data.vehicles.filter(visible);
  const total = state.data.vehicles.length;
  $("status").textContent = `显示 ${cars.length} 台，共 ${total} 台。核对日期 ${state.data.today}。`;
  if (!cars.length) { $("list").innerHTML = `<p class="muted">没有符合条件的车。放宽筛选，或把范围改成"全部"。</p>`; return; }
  const table = (list) => `<div class="tablewrap"><table>${HEAD}<tbody>${list.map(row).join("")}</tbody></table></div>`;
  if ($("sort").value !== "rank") { $("list").innerHTML = table(sorted(cars)); return; }
  const stages = state.data.profile.stages;
  $("list").innerHTML = stages.map((label, index) => {
    const group = cars.filter((c) => c.rec.stage === index);
    return group.length ? `<section class="stage"><h2>${esc(label)} <span>${group.length} 台</span></h2>${table(sorted(group))}</section>` : "";
  }).join("");
}

function renderCompare() {
  const cars = state.data.vehicles.filter((c) => state.compare.has(c.vin));
  const box = $("compare");
  box.hidden = cars.length < 2;
  if (box.hidden) return;
  const fields = state.data.profile.fields.filter((f) => cars.some((c) => c.fieldKeys.includes(f.key)));
  const line = (label, cell) => `<tr><th scope="row">${esc(label)}</th>${cars.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`;
  box.innerHTML = `<table><tbody>
    ${line("车", (c) => `<strong>${esc(c.id)}</strong> ${esc(c.year)} ${esc(c.title)}<br>${link(c.listing, c.dealer)}`)}
    ${line("档位", (c) => esc(c.rec.stageLabel))}
    ${line("状态", (c) => `${esc(STATUS[c.rec.status] ?? c.rec.status)}（${esc(checkedOf(c))}）`)}
    ${line("里程", (c) => (c.miles !== undefined ? c.miles.toLocaleString("en-US") : "待核"))}
    ${line("车价", (c) => (c.quoteRecord ? money(c.quoteRecord.quote.price) : "待核"))}
    ${line("估算落地", (c) => (c.quoteRecord ? money(c.quoteRecord.quote.otd, 2) + (c.quoteRecord.quote.lowerBound ? " 起" : "") : "待核"))}
    ${line("月供", (c) => (c.quoteRecord ? money(c.quoteRecord.quote.monthly, 2) : ""))}
    ${fields.map((f) => line(f.label, (c) => (c.fieldKeys.includes(f.key) ? optionTag(c, f) : "—"))).join("")}
    ${line("车史", (c) => esc(c.history ?? "待核"))}
    ${line("保修", (c) => esc(c.warrantyUntil ? `至 ${c.warrantyUntil}${c.warrantyMiles ? " / " + c.warrantyMiles.toLocaleString("en-US") + " mi" : ""}` : c.warranty ?? "起算日未知"))}
    ${line("还差什么", (c) => esc(c.open.join("、") || "无"))}
  </tbody></table><p><button type="button" id="clearCompare">清空比较</button></p>`;
}

function configurationCard(car) {
  const config = car.configuration;
  if (!config) {
    return `<section class="configuration-card" aria-labelledby="configuration-title">
      <h3 id="configuration-title">配置分析</h3><p class="configuration-source">待录入同 VIN 配置资料。</p>
    </section>`;
  }
  const levels = { high: "偏高配", mid: "中配", base: "基础配置", unknown: "档位待判定" };
  const grades = { A: "同 VIN 原厂资料", B: "同 VIN 列项", model: "年款资料" };
  const groups = [
    ["present", "已确认配备", "配备项目待补"],
    ["absent", "明确未配备", "缺失项目尚无结论"],
    ["unknown", "待核实", "暂无待核项"],
  ];
  const cells = groups.map(([status, title, empty]) => {
    const items = config.items.filter(item => item.status === status);
    return `<div class="configuration-group" data-status="${status}">
      <h4>${title}</h4>
      ${items.length ? `<ul>${items.map(item => `<li>
        <div class="configuration-item"><strong>${esc(item.name)}</strong>
          ${item.msrp === undefined ? "" : `<span>${money(item.msrp)}</span>`}</div>
        ${item.evidence ? `<span class="configuration-source">${grades[item.evidence]}</span>` : ""}
        <p>${esc(item.detail)}${item.url ? ` ${link(item.url, "依据")}` : ""}</p>
      </li>`).join("")}</ul>` : `<p class="configuration-source">${empty}</p>`}
    </div>`;
  }).join("");
  let msrp = "";
  if (config.msrp) {
    const { base, options, destination, total } = config.msrp;
    const subtotal = Math.round((base + options + destination) * 100) / 100;
    const difference = Math.round((total - subtotal) * 100) / 100;
    msrp = `<div class="configuration-msrp"><h4>原始 MSRP</h4><ul>
      <li>基础价 <strong>${money(base)}</strong></li>
      <li>选装小计 <strong>${money(options)}</strong></li>
      <li>目的地费 <strong>${money(destination)}</strong></li>
      <li>清单所列总额 <strong>${money(total)}</strong></li>
    </ul>${difference ? `<p>已列项目合计 ${money(subtotal)}，与清单总额相差 ${money(Math.abs(difference))}，差额待核。</p>` : ""}</div>`;
  }
  return `<section class="configuration-card" aria-labelledby="configuration-title">
    <div class="configuration-heading"><h3 id="configuration-title">配置分析</h3>
      <strong class="configuration-level">${levels[config.level]}</strong></div>
    <p class="configuration-analysis">${esc(config.analysis)}</p>
    <div class="configuration-groups">${cells}</div>${msrp}
    <p class="configuration-source">${esc(config.date)} · ${config.url ? link(config.url, config.source) : esc(config.source)}</p>
  </section>`;
}

async function showDetail(vin) {
  const car = state.data.vehicles.find((c) => c.vin === vin);
  if (!car) return;
  const quote = car.quoteRecord?.quote;
  const pairs = [
    ["VIN", `<code>${esc(car.vin)}</code>`],
    ["库存号", esc(car.stock ?? "")],
    ["档位", `${esc(car.rec.stageLabel)}：${esc(car.rec.reasons.join("；"))}`],
    ["下一步", esc([car.next, ...car.rec.next].filter(Boolean).join("；"))],
    ["选装", `<div class="opts">${fieldsOf(car).map((f) => optionTag(car, f)).join("")}</div>`],
    ["报价", quote ? `${money(quote.price)}，估算落地 ${money(quote.otd, 2)}${quote.lowerBound ? " 起" : ""}，月供 ${money(quote.monthly, 2)}<br><span class="muted">${esc(quote.basis)}${quote.feeNote ? "。" + esc(quote.feeNote) : ""}（${esc(car.quoteRecord.at)}）</span>` : "待核"],
    ["车史", esc(car.history ?? "待核")],
    ["保修", esc([car.warrantyUntil ? `至 ${car.warrantyUntil}` : "", car.warranty].filter(Boolean).join("。") || "起算日未知")],
    ["风险", esc(car.risk ?? "")],
    ...Object.entries(car.specs ?? {}).map(([k, v]) => [k, esc(v)]),
    ["还差什么", esc(car.open.join("、") || "无")],
    ["链接", [link(car.listing, "车商原页"), ...(car.links ?? []).map(([label, url]) => link(url, label))].join(" · ")],
  ].filter(([, v]) => v);
  $("detailBody").innerHTML = `<h2 id="detailTitle">${esc(car.id)} · ${esc(car.year)} ${esc(car.title)}</h2>
    <p class="muted">${esc(car.dealer)}，${esc(car.city)}</p>
    ${configurationCard(car)}
    <dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
    <h3>记录</h3><div id="history" class="muted">正在读取…</div>`;
  $("detail").showModal();
  try {
    const response = await fetch(`/api/history?vin=${encodeURIComponent(vin)}`);
    if (!response.ok) throw new Error(String(response.status));
    const history = await response.json();
    $("history").className = "";
    $("history").innerHTML = `<ol>${history.observations.map((o) => `<li><time>${esc(o.at.replace("T", " "))}</time> ${o.inventory ? `<span class="tag ${TONE[o.inventory] ?? ""}">${esc(STATUS[o.inventory] ?? o.inventory)}</span>` : ""} ${o.price ? money(o.price) : ""} ${o.miles !== undefined ? o.miles.toLocaleString("en-US") + " mi" : ""} ${link(o.url, o.source)}${o.note ? `<br><span class="muted">${esc(o.note)}</span>` : ""}</li>`).join("")}</ol>`;
  } catch {
    $("history").textContent = "记录没读到，刷新后再试。";
  }
}

function renderChanges() {
  const items = state.data.changes.map((c) => {
    const parts = [];
    if (c.firstSeen) parts.push("新车源");
    if (c.stockChanged && !c.firstSeen) parts.push(`${STATUS[c.previousStatus] ?? c.previousStatus ?? "无"} → ${STATUS[c.inventory] ?? c.inventory}`);
    if (c.quoteChanged && c.quote) parts.push(c.previousQuote && c.previousQuote.price !== c.quote.price ? `${money(c.previousQuote.price)} → ${money(c.quote.price)}` : `报价 ${money(c.quote.price)}`);
    if (c.arrivalChanged) parts.push(`到店 ${c.arrival}`);
    return `<li><time>${esc(c.at.replace("T", " ").slice(0, 16))}</time><strong>${esc(c.id)}</strong><span>${esc(parts.join("，"))}</span>${link(c.url, c.source)}</li>`;
  });
  $("changes").innerHTML = items.join("") || `<li class="muted">还没有变化记录。</li>`;
}

function renderControls() {
  const { profile } = state.data;
  document.title = profile.label;
  $("title").textContent = profile.label;
  const lastRun = state.data.runs[0];
  $("subtitle").textContent = lastRun ? `最近一次记录 ${lastRun.lastAt.replace("T", " ").slice(0, 16)}（${lastRun.job}）` : "还没有记录";
  $("budget").innerHTML = [
    ["落地价上限", money(profile.budget.otdCap)], ["首付", money(profile.budget.downPayment)],
    ["年利率", (profile.budget.apr * 100).toFixed(2) + "%"], ["期数", profile.budget.termMonths],
    ["税率", (profile.tax.rate * 100).toFixed(2) + "%"], ["上牌预留", money(profile.tax.registrationReserve)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("models").innerHTML = [["", "全部"], ...profile.models.map((m) => [m.name, m.name])]
    .map(([value, label]) => `<button type="button" role="tab" data-model="${esc(value)}" aria-selected="${state.model === value}">${esc(label)}</button>`).join("");
  $("area").innerHTML = `<option value="">不限</option>` + profile.areas.map((a) => `<option value="${esc(a.key)}">${esc(a.label)}</option>`).join("");
  $("fields").innerHTML = profile.fields.map((f) => `<button type="button" data-field="${esc(f.key)}" aria-pressed="false">${esc(f.label)}${f.preferred ? " " + esc(f.preferred.join("/")) : ""}</button>`).join("");
}

function render() { renderList(); renderCompare(); }

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-model],[data-field],[data-detail],#clearCompare");
  if (!target) return;
  if (target.dataset.model !== undefined) {
    state.model = target.dataset.model;
    for (const b of $("models").children) b.setAttribute("aria-selected", String(b.dataset.model === state.model));
  } else if (target.dataset.field) {
    const key = target.dataset.field;
    state.fields.has(key) ? state.fields.delete(key) : state.fields.add(key);
    target.setAttribute("aria-pressed", String(state.fields.has(key)));
  } else if (target.dataset.detail) {
    showDetail(target.dataset.detail);
    return;
  } else {
    state.compare.clear();
  }
  render();
});
document.addEventListener("change", (event) => {
  const vin = event.target.dataset?.compare;
  if (vin) {
    if (event.target.checked && state.compare.size >= 3) { event.target.checked = false; $("status").textContent = "最多并排比较三台。"; return; }
    event.target.checked ? state.compare.add(vin) : state.compare.delete(vin);
    renderCompare();
    return;
  }
  render();
});
$("search").addEventListener("input", render);
$("maxOtd").addEventListener("input", render);
$("maxMiles").addEventListener("input", render);

try {
  const response = await fetch("/api/inventory");
  if (!response.ok) throw new Error(String(response.status));
  state.data = await response.json();
  renderControls();
  render();
  renderChanges();
} catch (error) {
  $("status").textContent = `数据没读到（${error.message}）。确认服务在运行后刷新。`;
}
