// ── State ────────────────────────────────────────────
let data = [];            // {date, close}
let dataLoaded = false;
let trades = [];          // {type:'buy'|'sell', idx, date, close, qty}
let chart = null;

const $ = id => document.getElementById(id);
const fmtP = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmt$ = n => '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

// ── Step tabs ─────────────────────────────────────────
document.querySelectorAll('.input-tab').forEach(t => {
    t.addEventListener('click', () => {
        document.querySelectorAll('.input-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        $(t.dataset.tab === 'upload' ? 'panelUpload' : 'panelPaste').classList.add('active');
    });
});

// ── Upload CSV ─────────────────────────────────────────
const dropZone = $('csvDrop');
dropZone.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) { parseCSV(inp.files[0]); $(inp.files[0].name); } };
    inp.click();
});

['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', e => { if(e.dataTransfer.files[0]) parseCSV(e.dataTransfer.files[0]); });

function parseCSV(file) {
    const r = new FileReader();
    r.onload = () => {
        const rows = r.result.trim().split('\n').map(l => l.split(',').map(s => s.trim()));
        // Skip header, expect [date, close] or [date, adjClose]
        const parsed = [];
        for (let i = 1; i < rows.length; i++) {
            const d = rows[i][0];
            const c = parseFloat(rows[i][rows[i].length - 2]) || parseFloat(rows[i][1]);
            if (d && !isNaN(c)) parsed.push({ date: d, close: c });
        }
        if (parsed.length < 2) { alert('Not enough valid data. Need at least 2 rows.'); return; }
        data = parsed; dataLoaded = true;
        onReady();
    };
    r.readAsText(file);
}

// ── Paste ─────────────────────────────────────────────
$('parseBtn').addEventListener('click', () => {
    const lines = $('pasteArea').value.trim().split('\n');
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim());
        const d = parts[0], c = parseFloat(parts[1]) || parseFloat(parts[2]);
        if (d && !isNaN(c)) parsed.push({ date: d, close: c });
    }
    if (parsed.length < 2) { alert('Need at least 2 valid data rows.'); return; }
    data = parsed; dataLoaded = true;
    onReady();
});

// ── Data loaded ─────────────────────────────────────────
function onReady() {
    $('stepData').classList.add('hidden');
    $('stepTrades').classList.remove('hidden');
    $('stepChart').classList.remove('hidden');
    $('stepResults').classList.remove('hidden');
    addDefaultTrades();
    buildChart();
    updateResults();
}

// ── Default: buy at first, sell at last ───────────────
function addDefaultTrades() {
    trades = [];
    if (data.length < 2) return;
    addTradeUI('buy', 0, data[0].date, data[0].close, 1);
    addTradeUI('sell', data.length - 1, data[data.length-1].date, data[data.length-1].close, 1);
    renderTradesList();
}

// ── Manual trade ──────────────────────────────────────
$('addTradeBtn').addEventListener('click', () => {
    const price = parseFloat($('tradePrice').value);
    if (isNaN(price)) { alert('Enter a valid price.'); return; }
    const qty = parseInt($('tradeQty').value) || 1;
    const type = $('tradeType').value;
    // Find closest data point to price
    let bestIdx = 0, bestDiff = Infinity;
    data.forEach((d, i) => { const diff = Math.abs(d.close - price); if (diff < bestDiff) { bestDiff = diff; bestIdx = i; } });
    // Avoid duplicate trades at same index
    if (trades.some(t => t.idx === bestIdx)) { bestIdx = Math.min(bestIdx + 1, data.length - 1); }
    addTradeUI(type, bestIdx, data[bestIdx].date, data[bestIdx].close, qty);
    $('tradePrice').value = '';
    renderTradesList();
    buildChart();
    updateResults();
});

function addTradeUI(type, idx, date, close, qty) {
    trades.push({ type, idx, date, close, qty });
    trades.sort((a,b) => a.idx - b.idx);
}

function removeTrade(i) {
    trades.splice(i, 1);
    renderTradesList();
    buildChart();
    updateResults();
}

function renderTradesList() {
    $('tradesList').innerHTML = trades.map((t,i) => `
        <div class="trade-item ${t.type}">
            <span>${t.type === 'buy' ? '🟢' : '🔴'} ${t.type.toUpperCase()} #${i+1} — ${t.date} — ${fmt$(t.close)} × ${t.qty}</span>
            <button class="trade-remove" onclick="removeTrade(${i})">×</button>
        </div>`).join('');
}

// ── Calculations ──────────────────────────────────────
function calc() {
    if (data.length < 2 || trades.length < 2) return { yourPct: 0, bhPct: 0, yourProfit: 0, bhProfit: 0 };
    const firstP = data[0].close, lastP = data[data.length - 1].close;
    // BuyHold: buy at first, sell at last
    const bhPct = ((lastP - firstP) / firstP) * 100;

    // Your strategy: calculate P&L
    let cash = 0, shares = 0, totalInvested = 0, totalSold = 0;
    trades.forEach(t => {
        if (t.type === 'buy') {
            shares += t.qty;
            totalInvested += t.close * t.qty;
        } else {
            const sellQty = Math.min(t.qty, shares);
            totalSold += t.close * sellQty;
            shares -= sellQty;
        }
    });

    // Include value of remaining shares at last price
    const finalValue = totalSold + shares * lastP;
    const yourPct = totalInvested > 0 ? ((finalValue - totalInvested) / totalInvested) * 100 : 0;

    return {
        yourPct,
        bhPct,
        yourProfit: finalValue - totalInvested,
        bhProfit: (lastP - firstP) * (totalInvested / firstP),
        sharesRemaining: shares,
        totalInvested,
        totalSold,
        finalValue
    };
}

function updateResults() {
    const r = calc();
    const elY = $('statYourReturn'), elB = $('statBuyHold'), elD = $('statDiff');
    elY.textContent = fmtP(r.yourPct);
    elB.textContent = fmtP(r.bhPct);
    const diff = r.yourPct - r.bhPct;
    elD.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';

    [elY, elB, elD].forEach(el => {
        const val = parseFloat(el.textContent);
        el.className = 'stat-val ' + (val > 0.5 ? 'pos' : val < -0.5 ? 'neg' : 'neutral');
    });
}

// ── Chart ─────────────────────────────────────────────
function buildChart() {
    if (!dataLoaded) return;
    const labels = data.map(d => d.date);
    const prices = data.map(d => d.close);

    // Annotations for trades
    const annotations = {};
    trades.forEach((t, i) => {
        const isBuy = t.type === 'buy';
        annotations[`t${i}`] = {
            type: 'point',
            xValue: t.idx,
            yValue: t.close,
            backgroundColor: isBuy ? '#10b981' : '#ef4444',
            borderColor: isBuy ? '#34d399' : '#f87171',
            borderWidth: 2,
            radius: 7,
            label: {
                display: true,
                content: `${isBuy?'B':'S'}${i+1}`,
                position: isBuy ? 'start' : 'end',
                font: { weight: '700', size: 11 },
                color: isBuy ? '#10b981' : '#ef4444',
            }
        };
    });

    if (chart) chart.destroy();
    const ctx = $('mainChart').getContext('2d');

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 420);
    gradient.addColorStop(0, 'rgba(56,189,248,0.15)');
    gradient.addColorStop(1, 'rgba(56,189,248,0)');

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Price',
                data: prices,
                borderColor: '#38bdf8',
                borderWidth: 2,
                pointRadius: 0,
                fill: { target: 'origin', above: gradient },
                tension: 0.1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'nearest' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => '$' + ctx.parsed.y.toFixed(2),
                        title: items => items[0].label
                    }
                },
                annotation: { annotations }
            },
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const idx = elements[0].index;
                const currentType = trades.length % 2 === 0 ? 'buy' : 'sell';
                // Check if we're at the last trade which should be a sell
                const type = currentType === 'sell' ? 'sell' : 'buy';
                addTradeUI(type, idx, data[idx].date, data[idx].close, 1);
                renderTradesList();
                buildChart();
                updateResults();
            },
            scales: {
                x: { display: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } },
                y: { display: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 11 }, callback: v => '$' + v } }
            }
        },
        plugins: [window['chartjs-plugin-annotation']]
    });
}

// ── Reset ─────────────────────────────────────────────
$('resetBtn').addEventListener('click', () => {
    data = []; trades = []; dataLoaded = false;
    $('stepData').classList.remove('hidden');
    $('stepTrades').classList.add('hidden');
    $('stepChart').classList.add('hidden');
    $('stepResults').classList.add('hidden');
    if (chart) { chart.destroy(); chart = null; }
    $('pasteArea').value = '';
    $('fileName').classList.add('hidden');
});
