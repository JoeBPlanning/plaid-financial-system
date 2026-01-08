/**
 * Chart Renderer Service
 * Renders Chart.js charts as PNG buffers using chartjs-node-canvas
 */

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Standard chart dimensions
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 400;
const PIE_SIZE = 600;

// Color palette matching frontend purple theme
const COLORS = {
  primary: '#667eea',
  secondary: '#764ba2',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
  orange: '#ff6b35',
  gray: '#6c757d',

  // Category colors for stacked charts
  categoryColors: [
    '#667eea', // Primary purple
    '#764ba2', // Secondary purple
    '#ff6b35', // Orange
    '#28a745', // Green
    '#ffc107', // Yellow
    '#17a2b8', // Blue
    '#dc3545', // Red
    '#6c757d', // Gray
    '#e83e8c', // Pink
    '#20c997', // Teal
    '#6610f2', // Indigo
    '#fd7e14', // Orange variant
    '#e83e8c', // Magenta
    '#20c997', // Cyan
    '#6f42c1', // Purple variant
  ]
};

/**
 * Render expenses by category as a stacked bar chart
 *
 * @param {Object} chartData - Data from chartDataService.getExpensesByCategoryChart
 * @param {number} width - Chart width in pixels
 * @param {number} height - Chart height in pixels
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderExpensesByCategoryChart(chartData, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const configuration = {
    type: 'bar',
    data: {
      labels: chartData.months,
      datasets: chartData.categories.map((cat, idx) => ({
        label: cat.name,
        data: cat.data,
        backgroundColor: COLORS.categoryColors[idx % COLORS.categoryColors.length],
        stack: 'expenses',
        barPercentage: 0.9,
        categoryPercentage: 0.8
      }))
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Expenses by Category (12 Months)',
          font: { size: 16, weight: 'bold' },
          color: '#333'
        },
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: 10 }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y || 0;
              return `${label}: $${value.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 10 } }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#e1e5e9' },
          ticks: {
            font: { size: 10 },
            callback: (value) => '$' + value.toLocaleString()
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

/**
 * Render income vs expenses as a bar chart with line overlays
 *
 * @param {Object} chartData - Data from chartDataService.getIncomeVsExpensesChart
 * @param {number} width - Chart width in pixels
 * @param {number} height - Chart height in pixels
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderIncomeVsExpensesChart(chartData, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const configuration = {
    type: 'bar',
    data: {
      labels: chartData.months,
      datasets: [
        {
          type: 'bar',
          label: 'Income',
          data: chartData.income,
          backgroundColor: COLORS.info + 'CC', // Semi-transparent blue
          borderColor: COLORS.info,
          borderWidth: 1,
          order: 2
        },
        {
          type: 'bar',
          label: 'Expenses',
          data: chartData.totalExpenses,
          backgroundColor: COLORS.danger + 'CC', // Semi-transparent red
          borderColor: COLORS.danger,
          borderWidth: 1,
          order: 2
        },
        {
          type: 'bar',
          label: 'Difference',
          data: chartData.difference,
          backgroundColor: COLORS.orange + 'CC', // Semi-transparent orange
          borderColor: COLORS.orange,
          borderWidth: 1,
          order: 2
        },
        {
          type: 'line',
          label: 'Avg Income',
          data: Array(chartData.months.length).fill(chartData.averageIncome),
          borderColor: COLORS.success,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          order: 1
        },
        {
          type: 'line',
          label: 'Avg Expenses',
          data: Array(chartData.months.length).fill(chartData.averageExpenses),
          borderColor: COLORS.danger,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          order: 1
        }
      ]
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Income vs Expenses (12 Months)',
          font: { size: 16, weight: 'bold' },
          color: '#333'
        },
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: 10 }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y || 0;
              return `${label}: $${value.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e1e5e9' },
          ticks: {
            font: { size: 10 },
            callback: (value) => '$' + value.toLocaleString()
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

/**
 * Render expense breakdown as a doughnut chart
 *
 * @param {Object} chartData - Data from chartDataService.getExpenseBreakdownChart
 * @param {number} width - Chart width in pixels
 * @param {number} height - Chart height in pixels
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderExpenseBreakdownChart(chartData, width = PIE_SIZE, height = PIE_SIZE) {
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const labels = chartData.categories.map(cat => cat.name);
  const data = chartData.categories.map(cat => cat.amount);
  const percentages = chartData.categories.map(cat => cat.percentage);

  const configuration = {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: COLORS.categoryColors.slice(0, labels.length),
        borderColor: 'white',
        borderWidth: 2
      }]
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: `Expense Breakdown - ${chartData.period}`,
          font: { size: 16, weight: 'bold' },
          color: '#333',
          padding: { bottom: 20 }
        },
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: 10 },
            generateLabels: (chart) => {
              const data = chart.data;
              if (data.labels.length && data.datasets.length) {
                return data.labels.map((label, i) => {
                  const value = data.datasets[0].data[i];
                  const percentage = percentages[i];
                  return {
                    text: `${label}: $${value.toLocaleString()} (${percentage}%)`,
                    fillStyle: data.datasets[0].backgroundColor[i],
                    hidden: false,
                    index: i
                  };
                });
              }
              return [];
            }
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.label || '';
              const value = context.parsed || 0;
              const percentage = percentages[context.dataIndex];
              return `${label}: $${value.toLocaleString()} (${percentage}%)`;
            }
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

/**
 * Render net worth history as a line chart with area fill
 *
 * @param {Object} chartData - Data from chartDataService.getNetWorthHistoryChart
 * @param {number} width - Chart width in pixels
 * @param {number} height - Chart height in pixels
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderNetWorthHistoryChart(chartData, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const datasets = [
    {
      label: 'Assets',
      data: chartData.assets,
      borderColor: COLORS.success,
      backgroundColor: COLORS.success + '33', // Very transparent
      fill: true,
      tension: 0.4,
      borderWidth: 2
    },
    {
      label: 'Liabilities',
      data: chartData.liabilities,
      borderColor: COLORS.danger,
      backgroundColor: COLORS.danger + '33',
      fill: true,
      tension: 0.4,
      borderWidth: 2
    },
    {
      label: 'Net Worth',
      data: chartData.netWorth,
      borderColor: COLORS.primary,
      backgroundColor: COLORS.primary + '55',
      fill: true,
      tension: 0.4,
      borderWidth: 3
    }
  ];

  // Add Social Security PV if included
  if (chartData.socialSecurityPV !== undefined) {
    datasets.push({
      type: 'bar',
      label: 'Social Security PV',
      data: chartData.years.map((_, idx) =>
        idx === chartData.years.length - 1 ? chartData.socialSecurityPV : null
      ),
      backgroundColor: COLORS.warning + 'CC',
      borderColor: COLORS.warning,
      borderWidth: 1
    });
  }

  const configuration = {
    type: 'line',
    data: {
      labels: chartData.years,
      datasets: datasets
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Net Worth History',
          font: { size: 16, weight: 'bold' },
          color: '#333'
        },
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: 10 }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y || 0;
              return `${label}: $${value.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#e1e5e9', display: true },
          ticks: { font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e1e5e9' },
          ticks: {
            font: { size: 10 },
            callback: (value) => '$' + value.toLocaleString()
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

module.exports = {
  renderExpensesByCategoryChart,
  renderIncomeVsExpensesChart,
  renderExpenseBreakdownChart,
  renderNetWorthHistoryChart
};
