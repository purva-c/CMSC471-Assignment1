const margin = { top: 80, right: 60, bottom: 60, left: 100 };
const width = 800 - margin.left - margin.right;
const height = 600 - margin.top - margin.bottom;
const t = 800;

const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

// Numeric variables available for axes
const options = ['TMAX', 'TMIN', 'TAVG', 'PRCP', 'SNOW', 'SNWD', 'AWND', 'WSF5', 'elevation'];

const labelMap = {
    TMAX:      'Maximum Temperature (°F)',
    TMIN:      'Minimum Temperature (°F)',
    TAVG:      'Average Temperature (°F)',
    PRCP:      'Precipitation (in)',
    SNOW:      'Snowfall (in)',
    SNWD:      'Snow Depth (in)',
    AWND:      'Avg Wind Speed (mph)',
    WSF5:      'Fastest 5s Wind Speed (mph)',
    elevation: 'Elevation (ft)'
};

let allData = [];
let xVar = 'TMIN', yVar = 'TMAX', sizeVar = 'PRCP';
let targetMonth = 1; // January
let colorByState = false;
let groupByState = false;
let xScale, yScale, sizeScale, colorScale, stateColorScale;

// Create SVG
const svg = d3.select('#vis')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

function init() {
    d3.csv("./data/weather.csv", d => ({
        station:   d.station,
        state:     d.state,
        latitude:  +d.latitude,
        longitude: +d.longitude,
        elevation: +d.elevation,
        date:      d.date,
        month:     +d.date.toString().slice(4, 6), // extract month from YYYYMMDD
        TMIN:      d.TMIN !== '' ? +d.TMIN : null,
        TMAX:      d.TMAX !== '' ? +d.TMAX : null,
        TAVG:      d.TAVG !== '' ? +d.TAVG : null,
        AWND:      d.AWND !== '' ? +d.AWND : null,
        WSF5:      d.WSF5 !== '' ? +d.WSF5 : null,
        SNOW:      d.SNOW !== '' ? +d.SNOW : null,
        SNWD:      d.SNWD !== '' ? +d.SNWD : null,
        PRCP:      d.PRCP !== '' ? +d.PRCP : null,
    }))
    .then(data => {
        allData = data;
        console.log('Loaded rows:', allData.length);

        // Build state color scale with enough colors for all states
        const states = [...new Set(allData.map(d => d.state))].sort();
        const stateColors = d3.quantize(d3.interpolateRainbow, states.length + 1);
        stateColorScale = d3.scaleOrdinal(stateColors).domain(states);

        // Temperature color scale (blue = cold, red = hot)
        colorScale = d3.scaleSequential()
            .domain([d3.min(allData, d => d.TMAX || 0), d3.max(allData, d => d.TMAX || 100)])
            .interpolator(d3.interpolateRdYlBu)
            .unknown('#aaa');

        setupSelector();
        updateAxes();
        updateVis();
        addLegend();
    })
    .catch(error => console.error('Error loading data:', error));
}

window.addEventListener('load', init);

function setupSelector() {
    // Month slider
    const slider = d3.sliderHorizontal()
        .min(1).max(9)
        .step(1)
        .width(width - 60)
        .displayValue(false)
        .on('onchange', val => {
            targetMonth = +val;
            d3.select('#monthLabel').text(monthNames[targetMonth - 1]);
            updateAxes();
            updateVis();
        })
        .value(targetMonth);

    d3.select('#slider')
        .append('svg')
        .attr('width', width)
        .attr('height', 60)
        .append('g')
        .attr('transform', 'translate(30,20)')
        .call(slider);

    // Axis dropdowns
    d3.selectAll('.variable')
        .each(function () {
            d3.select(this).selectAll('option')
                .data(options)
                .enter()
                .append('option')
                .text(d => labelMap[d] || d)
                .attr('value', d => d);
        })
        .on('change', function () {
            const id  = d3.select(this).property('id');
            const val = d3.select(this).property('value');
            if (id === 'xVariable')    xVar = val;
            else if (id === 'yVariable')    yVar = val;
            else if (id === 'sizeVariable') sizeVar = val;
            updateAxes();
            updateVis();
        });

    d3.select('#xVariable').property('value', xVar);
    d3.select('#yVariable').property('value', yVar);
    d3.select('#sizeVariable').property('value', sizeVar);

    // Color by state toggle
    d3.select('#colorByState').on('change', function () {
        colorByState = this.checked;
        updateVis();
        addLegend();
    });

    // Group by state toggle
    d3.select('#groupByState').on('change', function () {
        groupByState = this.checked;
        updateAxes();
        updateVis();
    });
}

function updateAxes() {
    svg.selectAll('.axis').remove();
    svg.selectAll('.labels').remove();

    // Scale to current month's data (and grouped averages if active)
    const monthFiltered = allData.filter(d => d.month === targetMonth);
    const displayData = groupByState ? avgByState(monthFiltered) : monthFiltered;
    const validData = displayData.filter(d => d[xVar] !== null && d[yVar] !== null);

    xScale = d3.scaleLinear()
        .domain(d3.extent(validData, d => d[xVar]))
        .nice()
        .range([0, width]);

    yScale = d3.scaleLinear()
        .domain(d3.extent(validData, d => d[yVar]))
        .nice()
        .range([height, 0]);

    const validSize = displayData.filter(d => d[sizeVar] !== null);
    sizeScale = d3.scaleSqrt()
        .domain([0, d3.max(validSize, d => d[sizeVar]) || 1])
        .range([3, 16]);

    const fmt = d => {
        if (Math.abs(d) >= 1e6) return (d / 1e6).toFixed(1) + 'M';
        if (Math.abs(d) >= 1e3) return (d / 1e3).toFixed(0) + 'K';
        return d;
    };

    // Read current theme colors from CSS variables
    const style = getComputedStyle(document.body);
    const axisColor  = style.getPropertyValue('--border').trim();
    const tickColor  = style.getPropertyValue('--muted').trim();
    const labelColor = style.getPropertyValue('--text').trim();

    const xAxisG = svg.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(6).tickFormat(fmt));

    svg.append('g')
        .attr('class', 'axis y-axis')
        .call(d3.axisLeft(yScale).ticks(6).tickFormat(fmt));

    // Apply theme-aware colors to axis lines and ticks
    svg.selectAll('.x-axis path, .y-axis path, .x-axis line, .y-axis line')
        .style('stroke', axisColor);
    svg.selectAll('.x-axis text, .y-axis text')
        .style('fill', tickColor);

    xAxisG.selectAll('text')
        .style('text-anchor', 'end')
        .attr('dx', '-0.6em').attr('dy', '0.15em')
        .attr('transform', 'rotate(-35)');

    // Axis labels
    svg.append('text')
        .attr('class', 'labels')
        .attr('x', width / 2)
        .attr('y', height + margin.bottom - 5)
        .attr('text-anchor', 'middle')
        .style('fill', labelColor)
        .text(labelMap[xVar] || xVar);

    svg.append('text')
        .attr('class', 'labels')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -margin.left + 40)
        .attr('text-anchor', 'middle')
        .style('fill', labelColor)
        .text(labelMap[yVar] || yVar);
}

function getColor(d) {
    if (colorByState) return stateColorScale(d.state);
    // Default: color by TMAX (temperature)
    return colorScale(d.TMAX);
}

function avgByState(data) {
    const numericVars = ['TMAX','TMIN','TAVG','PRCP','SNOW','SNWD','AWND','WSF5','elevation'];
    const grouped = d3.group(data, d => d.state);
    return Array.from(grouped, ([state, rows]) => {
        const avg = {};
        numericVars.forEach(v => {
            const vals = rows.map(d => d[v]).filter(x => x !== null && !isNaN(x));
            avg[v] = vals.length ? d3.mean(vals) : null;
        });
        return { state, station: state + ' (avg)', date: 'avg', ...avg };
    });
}

function updateVis() {
    const filtered = allData.filter(d =>
        d.month === targetMonth &&
        d[xVar] !== null &&
        d[yVar] !== null
    );

    const currentData = groupByState ? avgByState(filtered) : filtered;
    const keyFn = d => groupByState ? d.state : d.station + d.date;

    svg.selectAll('.points')
        .data(currentData, keyFn)
        .join(
            enter => enter
                .append('circle')
                .attr('class', 'points')
                .attr('cx', d => xScale(d[xVar]))
                .attr('cy', d => yScale(d[yVar]))
                .attr('r', 0)
                .style('fill', d => getColor(d))
                .style('opacity', 0.75)
                .on('mouseover', function (event, d) {
                    const isGrouped = groupByState;
                    d3.select('#tooltip')
                        .style('display', 'block')
                        .html(isGrouped
                            ? `<strong>${d.state} (State Average)</strong><br/>
                               TMIN: ${d.TMIN !== null ? d.TMIN.toFixed(1) : '&mdash;'} &deg;F &nbsp; TMAX: ${d.TMAX !== null ? d.TMAX.toFixed(1) : '&mdash;'} &deg;F<br/>
                               Precip: ${d.PRCP !== null ? d.PRCP.toFixed(3) : '&mdash;'} &nbsp; Snow: ${d.SNOW !== null ? d.SNOW.toFixed(2) : '&mdash;'}<br/>
                               Wind: ${d.AWND !== null ? d.AWND.toFixed(1) : '&mdash;'} mph`
                            : `<strong>${d.station}</strong><br/>
                               State: ${d.state}<br/>
                               Date: ${d.date}<br/>
                               TMIN: ${d.TMIN ?? '&mdash;'} &deg;F &nbsp; TMAX: ${d.TMAX ?? '&mdash;'} &deg;F<br/>
                               Precip: ${d.PRCP ?? '&mdash;'} &nbsp; Snow: ${d.SNOW ?? '&mdash;'}<br/>
                               Wind: ${d.AWND ?? '&mdash;'} mph`)
                        .style('left', (event.pageX + 18) + 'px')
                        .style('top',  (event.pageY - 30) + 'px');
                    d3.select(this)
                        .style('stroke', '#fff')
                        .style('stroke-width', '2px')
                        .style('opacity', 1);
                })
                .on('mouseout', function () {
                    d3.select('#tooltip').style('display', 'none');
                    d3.select(this)
                        .style('stroke', 'none')
                        .style('stroke-width', 0)
                        .style('opacity', 0.75);
                })
                .transition(t)
                .attr('r', d => d[sizeVar] !== null ? sizeScale(d[sizeVar]) : 6),

            update => update
                .style('fill', d => getColor(d))
                .transition(t)
                .attr('cx', d => xScale(d[xVar]))
                .attr('cy', d => yScale(d[yVar]))
                .attr('r',  d => d[sizeVar] !== null ? sizeScale(d[sizeVar]) : 6),

            exit => exit.transition(t).attr('r', 0).remove()
        );
}

function addLegend() {
    // Remove any old SVG legend remnants
    svg.selectAll('.legend').remove();

    const panel = document.getElementById('legend-items');
    panel.innerHTML = '';

    if (colorByState) {
        // One colored swatch per state
        const states = [...new Set(allData.map(d => d.state))].sort();
        states.forEach(s => {
            const item = document.createElement('div');
            item.className = 'legend-item';

            const swatch = document.createElement('div');
            swatch.className = 'legend-swatch';
            swatch.style.background = stateColorScale(s);

            const label = document.createElement('span');
            label.className = 'legend-label';
            label.textContent = s;

            item.appendChild(swatch);
            item.appendChild(label);
            panel.appendChild(item);
        });
    } else {
        // Temperature gradient bar
        const wrap = document.createElement('div');
        wrap.className = 'legend-grad-wrap';
        wrap.innerHTML = `
            <div class="legend-grad-bar"></div>
            <div class="legend-grad-labels">
                <span>Cold</span>
                <span>TMAX</span>
                <span>Hot</span>
            </div>`;
        panel.appendChild(wrap);
    }
}

// ── Theme Toggle ──────────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', function () {
    const isLight = document.body.classList.toggle('light');
    this.textContent = isLight ? '☾ Dark Mode' : '☀ Light Mode';
    // Redraw axes so SVG text/line colors update
    updateAxes();
    updateVis();
});