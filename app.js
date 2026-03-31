// ── State ────────────────────────────────────────────
let data = [];
let dataLoaded = false;
let trades = [];
let chart = null;
let activeIndicators = new Set();
let savedStrategies = {};

const $ = id => document.getElementById(id);
const fmtP = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmt$ = n => '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

// ── Technical Indicators ─────────────────────────────
function calcSMA(values, period) {
    if (values.length < period) return [];
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) result.push(null);
        else {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += values[j];
            result.push(sum / period);
        }
    }
    return result;
}

function calcEMA(values, period) {
    if (values.length < period) return [];
    const result = [];
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a,b) => a + b, 0) / period;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) result.push(null);
        else if (i === period - 1) { result.push(ema); }
        else { ema = values[i] * k + ema * (1 - k); result.push(ema); }
    }
    return result;
}

function calcRSI(values, period = 14) {
    if (values.length < period + 1) return [];
    const changes = [];
    for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i-1]);
    
    const result = [];
    for (let i = 0; i < changes.length; i++) result.push(null);
    
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period; avgLoss /= period;
    
    result[period - 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    
    for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    // Pad with null for first element
    return [null, ...result];
}

function calcMACD(values, fast = 12, slow = 26, signal = 9) {
    const emaFast = calcEMA(values, fast);
    const emaSlow = calcEMA(values, slow);
    const macdLine = [];
    const signalLine = [];
    const histogram = [];
    for (let i = 0; i < values.length; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) macdLine.push(emaFast[i] - emaSlow[i]);
        else macdLine.push(null);
    }
    const validMACD = macdLine.filter(v => v !== null);
    const signalEMA = calcEMA(validMACD, signal);
    
    let signalIdx = 0;
    for (let i = 0; i < macdLine.length; i++) {
        if (macdLine[i] === null) {
            signalLine.push(null);
            histogram.push(null);
        } else {
            if (signalIdx < signalEMA.length && signalEMA[signalIdx] !== null) {
                signalLine.push(signalEMA[signalIdx]);
                histogram.push(macdLine[i] - signalEMA[signalIdx]);
                signalIdx++;
            } else {
                signalLine.push(null);
                histogram.push(null);
            }
        }
    }
    return { macdLine, signalLine, histogram };
}

// ── Tabs ─────────────────────────────────────────────
document.querySelectorAll('.input-tab').forEach(t => {
    t.addEventListener('click', () => {
        document.querySelectorAll('.input-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        $(t.dataset.tab === 'upload' ? 'panelUpload' : 'panelPaste').classList.add('active');
    });
});

// ── CSV Upload ───────────────────────────────────────
const dropZone = $('csvDrop');
dropZone.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt';
    inp.onchange = () => { if(inp.files[0]) { parseCSV(inp.files[0]); $('fileName').textContent = inp.files[0].name; $('fileName').classList.remove('hidden'); } };
    inp.click();
});
['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', e => { if(e.dataTransfer.files[0]) parseCSV(e.dataTransfer.files[0]); });

function parseCSV(file) {
    const r = new FileReader();
    r.onload = () => {
        const rows = r.result.trim().split('\n').map(l => {
            // Handle both comma and semicolon
            return l.split(/[,;]/).map(s => s.trim().replace(/"/g, ''));
        });
        const parsed = [];
        for (let i = 1; i < rows.length; i++) {
            const d = rows[i][0];
            const c = parseFloat(rows[i][rows[i].length > 4 ? 4 : 1]); // Try adj close first, then close
            if (d && !isNaN(c) && c > 0) parsed.push({ date: d, close: c });
        }
        if (parsed.length < 2) { alert('Not enough valid data. Need at least 2 rows.'); return; }
        data = parsed; dataLoaded = true;
        onReady();
    };
    r.readAsText(file);
}

// ── Paste ────────────────────────────────────────────
$('pasteBtn').addEventListener('click', () => {
    const lines = $('pasteArea').value.trim().split('\n');
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(/[,;]/).map(s => s.trim());
        const d = parts[0], c = parseFloat(parts[1]) || parseFloat(parts[2]);
        if (d && !isNaN(c) && c > 0) parsed.push({ date: d, close: c });
    }
    if (parsed.length < 2) { alert('Need at least 2 valid data rows.'); return; }
    data = parsed; dataLoaded = true;
    onReady();
});

// ── Data Loaded ──────────────────────────────────────
function onReady() {
    $('stepData').classList.add('hidden');
    $('stepTrades').classList.remove('hidden');
    $('stepChart').classList.remove('hidden');
    $('stepResults').classList.remove('hidden');
    // Try to load default strategy from URL
    const params = new URLSearchParams(window.location.hash.slice(1));
    const strategy = params.get('strategy');
    if (strategy) {
        try {
            const s = JSON.parse(atob(strategy));
            if (s.trades && Array.isArray(s.trades)) {
                trades = s.trades.map(t => ({...t}));
            }
        } catch(e) {}
    }
    if (trades.length < 2) {
        trades = [];
        addTradeUI('buy', 0, data[0].date, data[0].close, 1);
        addTradeUI('sell', data.length - 1, data[data.length-1].date, data[data.length-1].close, 1);
    }
    loadSavedStrategies();
    renderTradesList();
    buildChart();
    updateResults();
}

// ── Manual Trade ─────────────────────────────────────
$('addTradeBtn').addEventListener('click', () => {
    const price = parseFloat($('tradePrice').value);
    if (isNaN(price)) { alert('Enter a valid price.'); return; }
    const qty = parseInt($('tradeQty').value) || 1;
    const type = $('tradeType').value;
    let bestIdx = 0, bestDiff = Infinity;
    data.forEach((d, i) => { const diff = Math.abs(d.close - price); if(diff < bestDiff){bestDiff=diff;bestIdx=i;} });
    if (trades.some(t => t.idx === bestIdx)) bestIdx = Math.min(bestIdx+1, data.length-1);
    addTradeUI(type, bestIdx, data[bestIdx].date, data[bestIdx].close, qty);
    $('tradePrice').value = ''; $('tradeQty').value = '1';
    renderTradesList(); buildChart(); updateResults();
});

function addTradeUI(type, idx, date, close, qty) {
    trades.push({type, idx, date, close, qty});
    trades.sort((a,b) => a.idx - b.idx);
}

function removeTrade(i) {
    trades.splice(i, 1);
    renderTradesList(); buildChart(); updateResults();
}

function renderTradesList() {
    $('tradesList').innerHTML = trades.map((t,i) => `
        <div class="trade-item ${t.type}">
            <span>${t.type==='buy'?'🟢':'🔴'} #${i+1} — ${t.date} — ${fmt$(t.close)} × ${t.qty}</span>
            <button class="trade-remove" onclick="removeTrade(${i})">×</button>
        </div>`).join('');
}

// ── Calculations ─────────────────────────────────────
function calc() {
    if (data.length < 2 || trades.length < 2) return {yourPct:0, bhPct:0, yourProfit:0, bhProfit:0};
    const firstP = data[0].close, lastP = data[data.length-1].close;
    const bhPct = ((lastP - firstP) / firstP) * 100;
    let shares = 0, totalInvested = 0, totalSold = 0;
    trades.forEach(t => {
        if (t.type === 'buy') { shares += t.qty; totalInvested += t.close * t.qty; }
        else { const sq = Math.min(t.qty, shares); totalSold += t.close * sq; shares -= sq; }
    });
    const finalValue = totalSold + shares * lastP;
    const yourPct = totalInvested > 0 ? ((finalValue - totalInvested) / totalInvested) * 100 : 0;
    return { yourPct, bhPct, yourProfit: finalValue - totalInvested, bhProfit: (lastP - firstP) * (totalInvested / firstP) };
}

function updateResults() {
    const r = calc();
    ['statYourReturn','statBuyHold','statDiff'].forEach((id,i) => {
        const el = $(id);
        const val = [r.yourPct, r.bhPct, r.yourPct - r.bhPct][i];
        el.textContent = fmtP(val);
        el.className = 'stat-val ' + (val > 0.5 ? 'pos' : val < -0.5 ? 'neg' : 'neutral');
    });
}

// ── Chart ────────────────────────────────────────────
function getColors() {
    return { text: '#94a3b8', grid: 'rgba(255,255,255,0.05)' };
}

function buildChart() {
    if (!dataLoaded) return;
    const ctx = $('mainChart').getContext('2d');
    const labels = data.map(d => d.date);
    const prices = data.map(d => d.close);
    const cols = getColors();
    
    // Toggle indicators
    document.querySelectorAll('.ind-btn').forEach(b => {
        b.classList.toggle('on', activeIndicators.has(b.dataset.ind));
    });
    
    const datasets = [{
        label: 'Price',
        data: prices,
        borderColor: '#38bdf8',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        order: 0,
    }];
    
    if (activeIndicators.has('sma20')) datasets.push({label:'SMA 20',data:calcSMA(prices, 20),borderColor:'#fbbf24',borderWidth:1.5,pointRadius:0,tension:0.05,order:1});
    if (activeIndicators.has('sma50')) datasets.push({label:'SMA 50',data:calcSMA(prices, 50),borderColor:'#ef4444',borderWidth:1.5,pointRadius:0,tension:0.05,order:1});
    if (activeIndicators.has('ema9')) datasets.push({label:'EMA 9',data:calcEMA(prices, 9),borderColor:'#a855f7',borderWidth:1.5,pointRadius:0,tension:0.05,order:1});
    
    // Trade annotations
    const annotations = {};
    trades.forEach((t,i) => {
        const isBuy = t.type === 'buy';
        annotations[`t${i}`] = {
            type:'point', xValue:t.idx, yValue:t.close,
            backgroundColor: isBuy?'#10b981':'#ef4444',
            borderColor: isBuy?'#34d399':'#f87171', borderWidth:2, radius:7,
            label:{ display:true, content:`${isBuy?'B':'S'}${i+1}`, position:isBuy?'start':'end',
                    font:{weight:'700',size:11}, color:isBuy?'#10b981':'#ef4444' }
        };
    });
    
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type:'line',
        data:{labels, datasets},
        options:{
            responsive:true, maintainAspectRatio:false,
            interaction:{intersect:false,mode:'nearest'},
            plugins:{
                legend:{display:true,position:'top',labels:{color:cols.text,boxWidth:12,padding:12,font:{size:11}}},
                tooltip:{callbacks:{label:ctx=>'$'+ctx.parsed.y.toFixed(2),title:items=>items[0].label}},
                annotation:{annotations}
            },
            onClick:(evt,elements) => {
                if(!elements.length) return;
                const idx = elements[0].index;
                const type = trades.length % 2 === 0 ? 'buy' : 'sell';
                addTradeUI(type, idx, data[idx].date, data[idx].close, 1);
                renderTradesList(); buildChart(); updateResults();
            },
            scales:{
                x:{display:true,grid:{color:cols.grid},ticks:{color:cols.text,maxRotation:0,autoSkip:true,maxTicksLimit:14,font:{size:10}}},
                y:{display:true,grid:{color:cols.grid},ticks:{color:cols.text,font:{size:10},callback:v=>'$'+v}}
            }
        },
        plugins:[window['chartjs-plugin-annotation'] || null]
    });
}

// ── Indicator Toggles ────────────────────────────────
document.querySelectorAll('.ind-btn').forEach(b => {
    b.addEventListener('click', () => {
        if (activeIndicators.has(b.dataset.ind)) activeIndicators.delete(b.dataset.ind);
        else activeIndicators.add(b.dataset.ind);
        buildChart();
    });
});

// ── Save / Load / Share ──────────────────────────────
function getStrategyPayload() {
    return {
        data: data.map(d => ({d:d.date, c:d.close})),
        trades: trades.map(t => ({t:t.type, i:t.idx, d:t.date, p:t.close, q:t.qty}))
    };
}

function loadStrategy(payload) {
    data = payload.data.map(d => ({date:d.d, close:d.c}));
    trades = payload.trades.map(t => ({type:t.t, idx:t.i, date:t.d, close:t.p, qty:t.q}));
    dataLoaded = true;
    $('stepData').classList.add('hidden');
    ['stepTrades','stepChart','stepResults'].forEach(id => $(id).classList.remove('hidden'));
    renderTradesList(); buildChart(); updateResults();
}

$('saveLocalBtn').addEventListener('click', () => {
    try {
        const saved = JSON.parse(localStorage.getItem('stockviz_strategies') || '{}');
        const name = prompt('Strategy name:') || 'Strategy ' + Object.keys(saved).length;
        saved[name] = getStrategyPayload();
        localStorage.setItem('stockviz_strategies', JSON.stringify(saved));
        alert('Strategy saved: ' + name);
    } catch(e) { alert('Error saving: '+e.message); }
});

$('loadLocalBtn').addEventListener('click', () => {
    try {
        const saved = JSON.parse(localStorage.getItem('stockviz_strategies') || '{}');
        const names = Object.keys(saved);
        if (!names.length) { alert('No saved strategies.'); return; }
        const choice = prompt('Load which strategy?\n\n'+names.join(', '));
        if (saved[choice]) { loadStrategy(saved[choice]); }
    } catch(e) { alert('Error loading: '+e.message); }
});

$('shareBtn').addEventListener('click', () => {
    try {
        const json = JSON.stringify(getStrategyPayload());
        const b64 = btoa(json);
        const url = window.location.origin + window.location.pathname + '#strategy=' + b64.substring(0, 4000);
        if (typeof navigator.share === 'function' && b64.length < 4000) {
            navigator.share({title:'StockViz Strategy', text:'Check out this trade strategy', url});
        } else {
            navigator.clipboard.writeText(url).then(() => alert('URL copied to clipboard!')).catch(() => prompt('Copy this URL:', url));
        }
    } catch(e) { alert('Error: '+e.message); }
});

$('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(getStrategyPayload(),null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'stockviz-strategy.json'; a.click(); URL.revokeObjectURL(a.href);
});

$('importBtn').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.onchange = () => {
        const r = new FileReader();
        r.onload = () => { try { loadStrategy(JSON.parse(r.result)); } catch(e){alert('Invalid file');} };
        r.readAsText(inp.files[0]);
    };
    inp.click();
});

// ── Reset ─────────────────────────────────────────────
$('resetBtn').addEventListener('click', () => {
    data = []; trades = []; dataLoaded = false;
    $('stepData').classList.remove('hidden');
    ['stepTrades','stepChart','stepResults'].forEach(id => $(id).classList.add('hidden'));
    if (chart) { chart.destroy(); chart = null; }
    $('pasteArea').value = ''; $('fileName').classList.add('hidden');
});
